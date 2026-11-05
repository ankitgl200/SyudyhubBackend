/**
 * =========================================================================
 * StudyMyte — MYTEE RAG Pipeline & Semantic Search Test Suite
 * =========================================================================
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const config = require('./config');
const { Document, DocumentChunk } = require('./db/models');
const ragService = require('./services/mytee/ragService');
const { executeTool } = require('./services/mytee/myteeTools');

test('RAG Pipeline — Math & Vector Cosine Similarity', () => {
  const vec1 = [1, 0, 0];
  const vec2 = [1, 0, 0];
  const vec3 = [0, 1, 0];
  const vec4 = [-1, 0, 0];

  assert.strictEqual(Math.round(ragService.cosineSimilarity(vec1, vec2)), 1, 'Identical vectors must have similarity 1.0');
  assert.strictEqual(Math.round(ragService.cosineSimilarity(vec1, vec3)), 0, 'Orthogonal vectors must have similarity 0.0');
  assert.strictEqual(Math.round(ragService.cosineSimilarity(vec1, vec4)), -1, 'Opposite vectors must have similarity -1.0');
  assert.strictEqual(ragService.cosineSimilarity([], []), 0, 'Empty vectors should return 0');
});

test('RAG Pipeline — Smart Text Chunker', () => {
  const sampleText = 'Data Structures and Algorithms is essential for software engineering. Arrays provide O(1) index-based access to elements. Linked lists provide dynamic size with O(1) insertions at the head. Trees and graphs represent hierarchical and network relations respectively. Binary Search Trees maintain sorted ordering with average O(log n) lookups.';

  const chunks = ragService.splitTextIntoChunks(sampleText, { maxChunkChars: 120, overlap: 20 });
  assert.ok(chunks.length >= 2, 'Should divide text into multiple chunks');
  chunks.forEach(chunk => {
    assert.ok(chunk.length <= 150, 'Chunk length should stay within reasonable boundary');
    assert.ok(chunk.length > 20, 'Chunk should not be trivial');
  });
});

test('RAG Pipeline — Local Deterministic Embedding Fallback', () => {
  const text = 'Operating Systems Virtual Memory and Paging';
  const emb1 = ragService.generateLocalFallbackEmbedding(text, 64);
  const emb2 = ragService.generateLocalFallbackEmbedding(text, 64);

  assert.strictEqual(emb1.length, 64, 'Fallback vector should have exact dimension specified');
  assert.deepStrictEqual(emb1, emb2, 'Deterministic embedding should produce identical results for identical text');
});

test('RAG Pipeline — Live Gemini / Hybrid Embedding Generation', async () => {
  const text = 'What is dynamic programming in computer science?';
  const embedding = await ragService.generateEmbedding(text);

  assert.ok(Array.isArray(embedding), 'Embedding must be an array of numbers');
  assert.ok(embedding.length > 0, 'Embedding must not be empty');
  assert.strictEqual(typeof embedding[0], 'number', 'Elements must be floats');
});

test('RAG Pipeline — End-to-End Document Indexing & Semantic Search', async () => {
  await mongoose.connect(config.MONGODB_URI);

  let testDocId = null;

  try {
    // 1. Create a mock document in DB with academic notes content
    const testDoc = new Document({
      title: 'Operating Systems Deadlock & Banker Algorithm Lecture Notes',
      subject: 'Operating Systems',
      branch: 'CSE',
      year: '3rd Year',
      type: 'notes',
      status: 'approved',
      fileUrl: '/uploads/mock-os-deadlock.pdf',
      fileName: 'os-deadlock-notes.pdf'
    });
    await testDoc.save();
    testDocId = testDoc._id;

    // 2. Index the document using RAG service (will use smart metadata fallback for non-existent mock PDF)
    const indexResult = await ragService.indexDocument(testDocId, { force: true });
    assert.strictEqual(indexResult.skipped, undefined, 'Should index rather than skip');
    assert.ok(indexResult.chunkCount >= 1, 'Must create at least 1 indexed chunk');

    // Verify DB state
    const savedChunks = await DocumentChunk.find({ documentId: testDocId });
    assert.strictEqual(savedChunks.length, indexResult.chunkCount, 'Saved chunk count must match indexed result');
    assert.ok(savedChunks[0].embedding.length > 0, 'Saved chunk must contain vector embedding');

    // 3. Search vector chunks by semantic meaning
    const searchResults = await ragService.searchVectorChunks('Deadlock Banker Algorithm Operating Systems CSE', {
      subject: 'Operating Systems',
      limit: 3,
      minSimilarity: 0.30
    });

    assert.ok(searchResults.length > 0, 'Must retrieve matching vector chunk');
    assert.strictEqual(searchResults[0].documentId.toString(), testDocId.toString(), 'Top result must be our indexed test doc');
    assert.ok(searchResults[0].score > 0.40, 'Similarity score must be reasonably high');

    // 4. Test RAG Context Prompt Injection Builder
    const promptContext = await ragService.buildRagContextPrompt('Deadlock prevention in OS', {
      limit: 2,
      minSimilarity: 0.30
    });
    assert.strictEqual(promptContext.hasContext, true, 'Must have context block');
    assert.ok(promptContext.contextBlock.includes('VERIFIED STUDYMYTE COURSE EXCERPTS'), 'Context block must include header');
    assert.ok(promptContext.sources.length >= 1, 'Sources array must contain at least 1 source');

    // 5. Test Function Tool Execution: search_document_contents
    const toolResult = await executeTool('search_document_contents', {
      query: 'Banker Algorithm',
      subject: 'Operating Systems'
    });
    assert.strictEqual(toolResult.success, true, 'Tool execution must succeed');
    assert.ok(toolResult.count >= 1, 'Tool must find relevant chunks');
    assert.ok(toolResult.chunks[0].title.includes('Deadlock'), 'Chunk metadata must include title');

  } finally {
    // Cleanup test data
    if (testDocId) {
      await Document.findByIdAndDelete(testDocId);
      await DocumentChunk.deleteMany({ documentId: testDocId });
    }
    await mongoose.disconnect();
  }
});


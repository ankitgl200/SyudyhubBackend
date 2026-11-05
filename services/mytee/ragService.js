/**
 * =========================================================================
 * MYTEE RAG Vector Search & Auto-Chunking Service
 * =========================================================================
 * High-performance, 100% free vector indexing and semantic retrieval engine.
 * Powered by Google Gemini `gemini-embedding-001`, `pdf-parse`, and MongoDB.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const pdfParse = require('pdf-parse');
const { GoogleGenAI } = require('@google/genai');
const config = require('../../config');
const { Document, DocumentChunk } = require('../../db/models');

let aiClient = null;

function getAiClient() {
  if (!aiClient) {
    const apiKey = config.GEMINI && config.GEMINI.API_KEY ? config.GEMINI.API_KEY : process.env.GEMINI_API_KEY;
    if (apiKey) {
      aiClient = new GoogleGenAI({ apiKey });
    }
  }
  return aiClient;
}

/**
 * Calculates Cosine Similarity between two numerical vectors
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Generates vector embedding for a given text snippet using Gemini Embeddings
 */
async function generateEmbedding(text, retries = 2) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }

  const cleanText = text.trim().slice(0, 2048);
  const client = getAiClient();

  if (!client) {
    console.warn('[RAG Service] Gemini API client not configured for embeddings.');
    return generateLocalFallbackEmbedding(cleanText);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await client.models.embedContent({
        model: 'gemini-embedding-001',
        contents: cleanText
      });

      if (res && res.embeddings && res.embeddings[0] && Array.isArray(res.embeddings[0].values)) {
        return res.embeddings[0].values;
      }
      throw new Error('Unexpected embedding format from Gemini API');
    } catch (err) {
      if (attempt === retries) {
        console.warn(`[RAG Service] Embedding failed after ${retries + 1} attempts (${err.message}). Using local fallback.`);
        return generateLocalFallbackEmbedding(cleanText);
      }
      // Wait before retry
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  return generateLocalFallbackEmbedding(cleanText);
}

/**
 * High-dimensional deterministic local fallback embedding (for offline/test environments)
 */
function generateLocalFallbackEmbedding(text, dimension = 128) {
  const vector = new Array(dimension).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let hash = 0;
    for (let j = 0; j < word.length; j++) {
      hash = (hash << 5) - hash + word.charCodeAt(j);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimension;
    vector[idx] += 1;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < dimension; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimension; i++) vector[i] /= norm;
  }
  return vector;
}

/**
 * Splits document raw text into semantic chunks with overlapping window
 */
function splitTextIntoChunks(fullText, options = {}) {
  const maxChunkChars = options.maxChunkChars || 900;
  const overlap = options.overlap || 150;

  if (!fullText || typeof fullText !== 'string') return [];

  // Clean extra blank lines and normalize whitespace
  const normalized = fullText.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= maxChunkChars) {
    return [normalized];
  }

  // Split on paragraphs or section breaks
  const paragraphs = normalized.split(/\n\s*\n/);
  const chunks = [];
  let currentChunk = '';

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();
    if (!para) continue;

    if ((currentChunk.length + para.length) < maxChunkChars) {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
        // Retain overlapping tail
        const tail = currentChunk.slice(-overlap);
        currentChunk = tail + '\n\n' + para;
      } else {
        // Single paragraph larger than maxChunkChars -> split on sentences
        const sentences = para.split(/(?<=[.?!])\s+/);
        for (const sentence of sentences) {
          if ((currentChunk.length + sentence.length) < maxChunkChars) {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
          } else {
            if (currentChunk) chunks.push(currentChunk);
            currentChunk = sentence;
          }
        }
      }
    }
  }

  if (currentChunk.trim().length > 30) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Downloads or loads a buffer from URL or local file path
 */
async function fetchPdfBuffer(fileSource) {
  if (!fileSource || typeof fileSource !== 'string') {
    throw new Error('Invalid fileSource path or URL');
  }

  // If local file path
  if (!fileSource.startsWith('http://') && !fileSource.startsWith('https://')) {
    let localPath = fileSource;
    if (localPath.startsWith('/uploads/') || localPath.startsWith('\\uploads\\')) {
      localPath = path.join(config.UPLOADS_DIR, localPath.replace(/^[\\\/]uploads[\\\/]/, ''));
    } else if (localPath.startsWith('uploads/') || localPath.startsWith('uploads\\')) {
      localPath = path.join(config.UPLOADS_DIR, localPath.replace(/^uploads[\\\/]/, ''));
    } else if (!path.isAbsolute(localPath)) {
      localPath = path.join(__dirname, '../../', localPath);
    }
    return await fs.promises.readFile(localPath);
  }

  // If remote URL (e.g. Cloudinary)
  return new Promise((resolve, reject) => {
    const client = fileSource.startsWith('https://') ? https : http;
    const req = client.get(fileSource, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return resolve(fetchPdfBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download PDF (HTTP ${res.statusCode})`));
      }
      const data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve(Buffer.concat(data)));
      res.on('error', err => reject(err));
    });
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('PDF download timed out after 8s'));
    });
    req.on('error', err => reject(err));
  });
}

/**
 * Extracts text from PDF buffer using pdf-parse (supporting both v1 function and v2 class formats)
 */
async function extractTextFromPdf(buffer) {
  try {
    const PDFParseClass = pdfParse.PDFParse || (typeof pdfParse === 'function' ? null : null);
    if (PDFParseClass) {
      const parser = new PDFParseClass({ data: buffer });
      await parser.load();
      const textRes = await parser.getText();
      const cleanText = (textRes?.text || (typeof textRes === 'string' ? textRes : '')).replace(/\s+/g, ' ').trim();
      const info = await parser.getInfo().catch(() => ({}));
      const numPages = info?.pages?.length || 1;
      return { text: cleanText, pages: numPages, info: info || {} };
    } else if (typeof pdfParse === 'function') {
      const parsed = await pdfParse(buffer);
      return {
        text: (parsed.text || '').replace(/\s+/g, ' ').trim(),
        pages: parsed.numpages || 1,
        info: parsed.info || {}
      };
    } else if (pdfParse.default && typeof pdfParse.default === 'function') {
      const parsed = await pdfParse.default(buffer);
      return {
        text: (parsed.text || '').replace(/\s+/g, ' ').trim(),
        pages: parsed.numpages || 1,
        info: parsed.info || {}
      };
    }
    return { text: '', pages: 1, info: {} };
  } catch (err) {
    console.warn('[RAG Service] Error parsing PDF text:', err.message);
    return { text: '', pages: 0, info: {} };
  }
}

/**
 * Indexes an individual document into vector chunks in MongoDB
 */
async function indexDocument(documentId, options = {}) {
  const force = options.force || false;

  const doc = await Document.findById(documentId);
  if (!doc) {
    throw new Error(`Document with ID ${documentId} not found`);
  }

  if (doc.isRagIndexed && !force) {
    return {
      documentId: doc._id,
      title: doc.title,
      skipped: true,
      chunkCount: doc.chunkCount || 0
    };
  }

  let rawText = '';
  let pageCount = 1;

  // 1. Try to download & extract PDF text if fileUrl exists
  if (doc.fileUrl) {
    try {
      const pdfBuffer = await fetchPdfBuffer(doc.fileUrl);
      if (pdfBuffer && pdfBuffer.length > 0) {
        const extraction = await extractTextFromPdf(pdfBuffer);
        rawText = extraction.text || '';
        pageCount = extraction.pages || 1;
      }
    } catch (fetchErr) {
      console.warn(`[RAG Service] PDF load failed for "${doc.title}": ${fetchErr.message}`);
    }
  }

  // 2. If PDF is scanned, image-only, missing, or mock seed, build rich descriptive metadata chunk
  if (rawText.trim().length < 50) {
    rawText = `Document: "${doc.title}"\nSubject: ${doc.subject || 'General'}\nBranch: ${doc.branch || 'All Branches'}\nType: ${doc.type}\nYear: ${doc.year || 'All Years'}\nDescription: Official StudyMyte resource for ${doc.subject || doc.title} (${doc.type}). Viewable online on StudyMyte platform.`;
  }

  // 3. Split into smart chunks (capped at 25 chunks max to preserve quota & optimize latency)
  let chunkTexts = splitTextIntoChunks(rawText, { maxChunkChars: 900, overlap: 120 });
  if (chunkTexts.length > 25) {
    chunkTexts = chunkTexts.slice(0, 25);
  }

  if (chunkTexts.length === 0) {
    doc.isRagIndexed = true;
    doc.chunkCount = 0;
    doc.ragIndexedAt = new Date();
    await doc.save();
    return { documentId: doc._id, title: doc.title, chunkCount: 0 };
  }

  // Delete previous chunks if re-indexing
  await DocumentChunk.deleteMany({ documentId: doc._id });

  // 4. Generate embeddings in small batches
  const batchSize = 3;
  const createdChunks = [];

  for (let i = 0; i < chunkTexts.length; i += batchSize) {
    const slice = chunkTexts.slice(i, i + batchSize);
    const promises = slice.map(async (textChunk, subIdx) => {
      const chunkIndex = i + subIdx;
      const embedding = await generateEmbedding(textChunk);
      return {
        documentId: doc._id,
        chunkIndex,
        text: textChunk,
        embedding: embedding || [],
        metadata: {
          title: doc.title || 'Untitled Document',
          subject: doc.subject || '',
          branch: doc.branch || '',
          year: doc.year || '',
          type: doc.type || 'notes',
          fileUrl: doc.fileUrl,
          pageNumber: Math.max(1, Math.round(((chunkIndex + 1) / chunkTexts.length) * pageCount))
        },
        tokenCount: Math.round(textChunk.length / 4)
      };
    });

    const batchResults = await Promise.all(promises);
    for (const chunkData of batchResults) {
      if (chunkData.embedding && chunkData.embedding.length > 0) {
        const savedChunk = await DocumentChunk.create(chunkData);
        createdChunks.push(savedChunk);
      }
    }

    // Small rate-limit pause between batches
    if (i + batchSize < chunkTexts.length) {
      await new Promise(r => setTimeout(r, 250));
    }
  }

  // 5. Update document status
  doc.isRagIndexed = true;
  doc.chunkCount = createdChunks.length;
  doc.ragIndexedAt = new Date();
  await doc.save();

  return {
    documentId: doc._id,
    title: doc.title,
    chunkCount: createdChunks.length,
    pages: pageCount
  };
}

/**
 * Searches across all indexed document chunks by semantic vector similarity
 */
async function searchVectorChunks(queryText, options = {}) {
  const limit = options.limit || 4;
  const minSimilarity = options.minSimilarity !== undefined ? options.minSimilarity : 0.40;
  const subjectFilter = options.subject;
  const branchFilter = options.branch;
  const documentId = options.documentId;

  if (!queryText || typeof queryText !== 'string') return [];

  // 1. Generate query embedding
  const queryVector = await generateEmbedding(queryText);
  if (!queryVector || queryVector.length === 0) {
    return [];
  }

  // 2. Build filter query
  const filter = {};
  if (documentId) {
    filter.documentId = documentId;
  }
  if (subjectFilter && typeof subjectFilter === 'string') {
    filter['metadata.subject'] = new RegExp(subjectFilter.trim(), 'i');
  }
  if (branchFilter && typeof branchFilter === 'string') {
    filter['metadata.branch'] = new RegExp(branchFilter.trim(), 'i');
  }

  // 3. Query candidate chunks from MongoDB
  const candidates = await DocumentChunk.find(filter)
    .select('documentId chunkIndex text embedding metadata tokenCount')
    .lean()
    .limit(300);

  if (!candidates || candidates.length === 0) {
    // If no filtered candidates, search broadly across all subjects
    if (subjectFilter || branchFilter) {
      const broadCandidates = await DocumentChunk.find({})
        .select('documentId chunkIndex text embedding metadata tokenCount')
        .lean()
        .limit(200);
      return rankAndScoreCandidates(queryVector, broadCandidates, limit, minSimilarity);
    }
    return [];
  }

  return rankAndScoreCandidates(queryVector, candidates, limit, minSimilarity);
}

function rankAndScoreCandidates(queryVector, candidates, limit, minSimilarity) {
  const scored = [];

  for (let i = 0; i < candidates.length; i++) {
    const chunk = candidates[i];
    if (chunk.embedding && chunk.embedding.length === queryVector.length) {
      const score = cosineSimilarity(queryVector, chunk.embedding);
      if (score >= minSimilarity) {
        scored.push({
          score: Math.round(score * 100) / 100,
          text: chunk.text,
          documentId: chunk.documentId,
          chunkIndex: chunk.chunkIndex,
          metadata: chunk.metadata || {}
        });
      }
    }
  }

  // Sort descending by similarity score
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Builds formatted Verified Course Excerpt context block to inject into LLM prompt
 */
async function buildRagContextPrompt(queryText, options = {}) {
  try {
    const chunks = await searchVectorChunks(queryText, options);
    if (!chunks || chunks.length === 0) {
      return {
        contextBlock: '',
        sources: [],
        hasContext: false
      };
    }

    let block = '\n\n=== VERIFIED STUDYMYTE COURSE EXCERPTS (FROM OFFICIAL SYLLABI & NOTES) ===\n';
    const sources = [];

    chunks.forEach((c, idx) => {
      const meta = c.metadata || {};
      const docTitle = meta.title || 'Course Document';
      const pageInfo = meta.pageNumber ? `Page ${meta.pageNumber}` : 'Document Excerpt';
      const subject = meta.subject ? `[${meta.subject}]` : '';

      block += `\n[Excerpt ${idx + 1}] Source: "${docTitle}" ${subject} (${pageInfo}, Match: ${Math.round(c.score * 100)}%):\n`;
      block += `"${c.text}"\n`;

      sources.push({
        documentId: c.documentId,
        title: docTitle,
        subject: meta.subject,
        pageNumber: meta.pageNumber,
        fileUrl: meta.fileUrl,
        similarity: c.score
      });
    });

    block += '========================================================================\n';
    block += 'Instructions for MYTEE: You MUST ground your answer primarily in the verified excerpts above whenever answering academic/syllabus questions. Always cite the Source Title and Page Number naturally so students can verify.\n\n';

    return {
      contextBlock: block,
      sources,
      hasContext: true
    };
  } catch (err) {
    console.error('[RAG Service] Error building RAG prompt context:', err.message);
    return {
      contextBlock: '',
      sources: [],
      hasContext: false
    };
  }
}

module.exports = {
  cosineSimilarity,
  generateEmbedding,
  generateLocalFallbackEmbedding,
  splitTextIntoChunks,
  fetchPdfBuffer,
  extractTextFromPdf,
  indexDocument,
  searchVectorChunks,
  buildRagContextPrompt
};

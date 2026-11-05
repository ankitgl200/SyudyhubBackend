/**
 * =========================================================================
 * StudyMyte — MYTEE RAG Backfill Indexing Script
 * =========================================================================
 * Indexes all historical approved documents (PDFs, notes, syllabus, papers)
 * into vector embeddings in MongoDB for instant semantic retrieval.
 *
 * Usage:
 *   node scripts/backfill_rag_embeddings.js
 *   node scripts/backfill_rag_embeddings.js --force   # Force re-indexing of all docs
 */

const mongoose = require('mongoose');
const config = require('../config');
const { Document, DocumentChunk } = require('../db/models');
const ragService = require('../services/mytee/ragService');

async function runBackfill() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  console.log('\n========================================================');
  console.log('🚀 StudyMyte RAG Historical Document Backfill Service');
  console.log('========================================================');
  console.log(`Mode: ${force ? 'FORCE RE-INDEX ALL' : 'INCREMENTAL (Unindexed only)'}`);
  console.log(`Connecting to MongoDB...`);

  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log('Connected to MongoDB successfully.\n');

    const filter = { status: { $ne: 'pending' } };
    if (!force) {
      filter.isRagIndexed = { $ne: true };
    }

    const docsToIndex = await Document.find(filter).sort({ createdAt: -1 });
    const totalCount = docsToIndex.length;

    if (totalCount === 0) {
      console.log('✅ All approved documents are already indexed in the vector store!');
      console.log('Use "--force" if you want to regenerate all embeddings.');
      await mongoose.disconnect();
      return;
    }

    console.log(`Found ${totalCount} approved document(s) to index into RAG vector store.`);
    console.log('Beginning vector extraction and embedding generation...\n');

    let successCount = 0;
    let failCount = 0;
    let totalChunksCreated = 0;
    const startTime = Date.now();

    for (let i = 0; i < totalCount; i++) {
      const doc = docsToIndex[i];
      const progress = `[${i + 1}/${totalCount}]`;

      try {
        process.stdout.write(`${progress} Indexing "${doc.title}" (${doc.type || 'doc'})... `);
        const result = await ragService.indexDocument(doc._id, { force });

        if (result.skipped) {
          console.log(`SKIPPED (already indexed, ${result.chunkCount} chunks)`);
        } else {
          totalChunksCreated += (result.chunkCount || 0);
          console.log(`DONE (${result.chunkCount} chunks, ${result.pages || 1} pages)`);
        }
        successCount++;
      } catch (docErr) {
        failCount++;
        console.log(`FAILED (${docErr.message})`);
      }

      // Small pause between documents to maintain smooth rate-limits
      if (i < totalCount - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    const finalChunkCount = await DocumentChunk.countDocuments({});

    console.log('\n========================================================');
    console.log('🎉 RAG Backfill Completed!');
    console.log(`Time Taken:         ${elapsedSeconds} seconds`);
    console.log(`Documents Processed: ${totalCount}`);
    console.log(`Successful:         ${successCount}`);
    console.log(`Failed:             ${failCount}`);
    console.log(`Chunks Created:     ${totalChunksCreated}`);
    console.log(`Total DB Chunks:    ${finalChunkCount}`);
    console.log('========================================================\n');

  } catch (err) {
    console.error('\n❌ Fatal error in RAG backfill script:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

runBackfill();


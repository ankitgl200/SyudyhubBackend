/**
 * StudyMyte - Paper Duplicate Backfill & Migration Script
 *
 * Scans existing papers, calculates SHA-256 hashes for files,
 * normalizes exam identities, inspects PDF quality, clusters duplicates,
 * and updates database records safely.
 *
 * Usage:
 *   node scripts/migrate_paper_duplicates.js [--dry-run] [--batch-size=50]
 */

const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { Document, DuplicatePaperGroup, Folder } = require('../db/models');
const {
  computeFileHash,
  normalizeSubject,
  normalizeExamType,
  normalizeYear,
  extractPaperCode,
  resolveFolderHierarchy,
  buildIdentityKey,
  inspectPdfContent
} = require('../services/duplicateEngine');
const { resolveSafeLocalPath } = require('../routes/documents');

const isDryRun = process.argv.includes('--dry-run');
const batchSizeArg = process.argv.find(arg => arg.startsWith('--batch-size='));
const BATCH_SIZE = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 50;
const UPLOADS_DIR = path.join(__dirname, '../uploads');

async function runMigration() {
  console.log('='.repeat(65));
  console.log(`Starting Paper Duplicate Backfill Migration ${isDryRun ? '[DRY RUN MODE - NO WRITES]' : '[LIVE MODE]'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('='.repeat(65));

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studyhub';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB successfully.');

  const stats = {
    totalChecked: 0,
    hashesComputed: 0,
    qualityScored: 0,
    groupsCreated: 0,
    groupsUpdated: 0,
    exactDuplicatesDetected: 0,
    errors: 0
  };

  try {
    const totalPapers = await Document.countDocuments({ type: { $in: ['paper', 'competitive'] } });
    console.log(`Found ${totalPapers} total question papers to inspect.`);

    let skip = 0;
    while (skip < totalPapers) {
      const batch = await Document.find({ type: { $in: ['paper', 'competitive'] } })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(BATCH_SIZE);

      if (!batch || batch.length === 0) break;

      for (const doc of batch) {
        stats.totalChecked++;
        try {
          let updated = false;
          let fileBuffer = null;

          // Attempt to read local file if stored locally
          if (doc.fileUrl && !doc.fileUrl.startsWith('http://') && !doc.fileUrl.startsWith('https://')) {
            const safePath = resolveSafeLocalPath(doc.fileUrl, UPLOADS_DIR);
            if (safePath && fs.existsSync(safePath)) {
              try {
                fileBuffer = fs.readFileSync(safePath);
              } catch (e) {
                console.warn(`Could not read file for doc ${doc._id}: ${e.message}`);
              }
            }
          }

          // 1. File Hash
          if (!doc.fileHash && fileBuffer) {
            doc.fileHash = computeFileHash(fileBuffer);
            doc.fileSizeBytes = fileBuffer.length;
            stats.hashesComputed++;
            updated = true;
          }

          // 2. Exam Identity
          let hierarchy = { branch: '', semester: null };
          if (doc.folderId) {
            hierarchy = await resolveFolderHierarchy(doc.folderId, Folder);
          }

          const rawSubject = doc.subject || doc.title || '';
          const normSubject = normalizeSubject(rawSubject);
          const normYear = normalizeYear(doc.year, doc.title);
          const normExamType = normalizeExamType(doc.type, doc.title);
          const paperCode = extractPaperCode(doc.title);

          const branch = hierarchy.branch || '';
          const semester = hierarchy.semester || null;
          const identityKey = buildIdentityKey({
            normalizedSubject: normSubject,
            branch,
            semester,
            year: normYear,
            examType: normExamType,
            paperCode
          });

          if (!doc.examIdentity || !doc.examIdentity.identityKey || doc.examIdentity.identityKey !== identityKey) {
            doc.examIdentity = {
              normalizedSubject: normSubject,
              branch,
              semester,
              year: normYear,
              examType: normExamType,
              paperCode,
              identityKey
            };
            updated = true;
          }

          // 3. Inspect PDF quality if missing
          if ((doc.qualityScore === undefined || doc.qualityScore === null) && fileBuffer) {
            const pdfInfo = await inspectPdfContent(fileBuffer);
            doc.pageCount = pdfInfo.pageCount;
            doc.hasText = pdfInfo.hasText;
            doc.textLength = pdfInfo.textLength;
            doc.qualityScore = pdfInfo.qualityScore;
            stats.qualityScored++;
            updated = true;
          }

          // Check if exact duplicate already approved
          if (doc.fileHash) {
            const existingApproved = await Document.findOne({
              fileHash: doc.fileHash,
              status: 'approved',
              _id: { $ne: doc._id }
            });
            if (existingApproved) {
              stats.exactDuplicatesDetected++;
              if (doc.status !== 'approved') {
                doc.duplicateStatus = {
                  ...doc.duplicateStatus,
                  isDuplicate: true,
                  isCanonical: false,
                  canonicalDocumentId: existingApproved._id,
                  matchConfidence: 100,
                  matchReason: 'Exact SHA-256 match with approved paper'
                };
                updated = true;
              }
            }
          }

          // 4. Cluster into DuplicatePaperGroup if pending or multiple candidates
          let group = await DuplicatePaperGroup.findOne({ identityKey });
          if (!group) {
            if (!isDryRun) {
              group = await DuplicatePaperGroup.create({
                identityKey,
                normalizedSubject: normSubject,
                branch,
                semester,
                year: normYear,
                examType: normExamType,
                paperCode,
                candidateDocumentIds: [doc._id],
                canonicalDocumentId: doc.status === 'approved' ? doc._id : null,
                status: doc.status === 'approved' ? 'resolved' : 'pending'
              });
            }
            stats.groupsCreated++;
          } else {
            const inGroup = group.candidateDocumentIds.some(id => String(id) === String(doc._id));
            if (!inGroup) {
              if (!isDryRun) {
                group.candidateDocumentIds.push(doc._id);
                if (doc.status === 'approved' && !group.canonicalDocumentId) {
                  group.canonicalDocumentId = doc._id;
                  group.status = 'resolved';
                }
                await group.save();
              }
              stats.groupsUpdated++;
            }
          }

          if (group && !doc.duplicateStatus?.duplicateGroupId) {
            doc.duplicateStatus = {
              ...doc.duplicateStatus,
              duplicateGroupId: group._id
            };
            updated = true;
          }

          if (updated && !isDryRun) {
            await doc.save();
          }
        } catch (itemErr) {
          stats.errors++;
          console.error(`Error processing doc ${doc._id}: ${itemErr.message}`);
        }
      }

      skip += BATCH_SIZE;
      console.log(`Processed ${Math.min(skip, totalPapers)}/${totalPapers} documents...`);
    }

    console.log('='.repeat(65));
    console.log('MIGRATION SUMMARY:');
    console.log(`- Total Papers Checked:       ${stats.totalChecked}`);
    console.log(`- Hashes Computed:            ${stats.hashesComputed}`);
    console.log(`- Quality Scores Calculated:  ${stats.qualityScored}`);
    console.log(`- Groups Created:             ${stats.groupsCreated}`);
    console.log(`- Groups Updated:             ${stats.groupsUpdated}`);
    console.log(`- Exact Duplicates Found:     ${stats.exactDuplicatesDetected}`);
    console.log(`- Errors:                     ${stats.errors}`);
    console.log(`- Mode:                       ${isDryRun ? 'DRY RUN (no database changes committed)' : 'LIVE SUCCESS'}`);
    console.log('='.repeat(65));

  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

if (require.main === module) {
  runMigration().catch(err => {
    console.error('Fatal migration error:', err);
    process.exit(1);
  });
}

module.exports = { runMigration };

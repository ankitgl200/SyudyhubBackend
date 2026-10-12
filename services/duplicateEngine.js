const crypto = require('crypto');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const { Folder, Document, DuplicatePaperGroup } = require('../db/models');

/**
 * Computes SHA-256 hash of a file buffer or local disk path.
 *
 * @param {Buffer|string} input - Buffer of bytes or absolute filepath string
 * @returns {string} Hex-encoded SHA-256 hash
 */
function computeFileHash(input) {
  if (Buffer.isBuffer(input)) {
    return crypto.createHash('sha256').update(input).digest('hex');
  } else if (typeof input === 'string') {
    const fileBuffer = fs.readFileSync(input);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }
  throw new Error('computeFileHash expects a Buffer or valid file path string');
}

/**
 * Normalizes subject string: trims, lowercases, removes extraneous punctuation
 * and standardizes acronyms/spaces.
 */
function normalizeSubject(rawSubject) {
  if (!rawSubject || typeof rawSubject !== 'string') return 'general';
  let clean = rawSubject
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([A-Za-z]{2,4}[-\s]?\d{3,4}\)/g, '') // remove code in parens e.g. (CS-401)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || 'general';
}

/**
 * Normalizes exam type from paper title, subject, or explicit metadata.
 * Detects: mid_term, end_term, practical, supplementary, competitive, other.
 */
function normalizeExamType(rawText = '', secondaryText = '') {
  const text = `${String(rawText || '')} ${String(secondaryText || '')}`.toLowerCase();
  if (/notes|lecture|handwritten|study[-_\s]?material/i.test(text)) {
    return 'notes';
  }
  if (/practical/i.test(text)) {
    return 'practical';
  }
  if (/lab[-_\s]?manual|experiment|viva/i.test(text)) {
    return 'lab_manual';
  }
  if (/book|textbook|reference[-_\s]?book/i.test(text)) {
    return 'book';
  }
  if (/roadmap|learning[-_\s]?path|guide/i.test(text)) {
    return 'roadmap';
  }
  if (/simulation/i.test(text)) {
    return 'simulation';
  }
  if (/syllabus|curriculum/i.test(text)) {
    return 'syllabus';
  }
  if (/mid[-_\s]?sem|mid[-_\s]?term|sessional|internal|first[-_\s]?cycle|second[-_\s]?cycle/i.test(text)) {
    return 'mid_term';
  }
  if (/end[-_\s]?sem|end[-_\s]?term|final|annual|main[-_\s]?exam/i.test(text)) {
    return 'end_term';
  }
  if (/supplementary|back[-_\s]?paper|back[-_\s]?exam|re[-_\s]?appear|improvement/i.test(text)) {
    return 'supplementary';
  }
  if (/gate|cat|jee|competitive/i.test(text)) {
    return 'competitive';
  }
  if (/paper|pyq|question[-_\s]?paper/i.test(text)) {
    return 'paper';
  }
  return 'general';
}

/**
 * Normalizes year / academic session.
 * Extracts 4-digit year like '2023' or '2023-24' -> '2023'.
 */
function normalizeYear(rawYear = '', secondaryText = '') {
  const combined = `${String(rawYear || '')} ${String(secondaryText || '')}`.trim();
  if (!combined) return 'current';
  const match = combined.match(/\b(20\d{2}|19\d{2})\b/);
  if (match) return match[1];
  return rawYear ? String(rawYear).trim().toLowerCase() : 'current';
}

/**
 * Normalizes paper code if present in title or code (e.g. "TCS-401", "ECS-302", "BAS-101").
 */
function extractPaperCode(text = '') {
  if (!text) return null;
  const match = String(text).toUpperCase().match(/\b([A-Z]{2,4}[-\s]?\d{3,4})\b/);
  return match ? match[1].replace(/\s+/g, '-').toLowerCase() : null;
}

/**
 * Resolves folder hierarchy (Year -> Branch -> Subject) to extract branch & semester.
 */
async function resolveFolderHierarchy(folderId, FolderModel = null) {
  if (!folderId) return { branch: 'All Branches', semester: null, subjectName: null };

  const Model = FolderModel || Folder;

  try {
    const ancestors = [];
    let currentId = folderId;

    while (currentId) {
      let f = null;
      if (typeof Model.findById === 'function') {
        const queryRes = Model.findById(currentId);
        f = queryRes && typeof queryRes.lean === 'function' ? await queryRes.lean() : await queryRes;
      }
      if (!f) break;
      ancestors.unshift(f.name); // Push to front: [Root, Branch, Subject]
      currentId = f.parentId;
    }

    let branch = 'All Branches';
    let semester = null;
    let subjectName = null;

    if (ancestors.length >= 1) {
      // Check if root or child designates year / semester
      ancestors.forEach(name => {
        const semMatch = name.match(/(\d+)(?:st|nd|rd|th)?\s*(?:sem|semester)/i) || name.match(/semester\s*(\d+)/i);
        if (semMatch) semester = semMatch[1];
        const yrMatch = name.match(/(\d+)(?:st|nd|rd|th)?\s*year/i);
        if (yrMatch && !semester) semester = String(parseInt(yrMatch[1]) * 2); // e.g. 2nd year ~ 3rd/4th sem

        if (/computer science|\bcse\b|\bit\b|information tech/i.test(name)) branch = 'CSE';
        else if (/mechanical|\bme\b/i.test(name)) branch = 'ME';
        else if (/electrical|\bee\b/i.test(name)) branch = 'EE';
        else if (/electronics|\bece\b/i.test(name)) branch = 'ECE';
        else if (/civil|\bce\b/i.test(name)) branch = 'CE';
        else if (/chemical|\bche\b/i.test(name)) branch = 'CHE';
      });

      subjectName = ancestors[ancestors.length - 1];
    }

    return { branch, semester, subjectName };
  } catch (err) {
    console.error('Error resolving folder hierarchy:', err);
    return { branch: 'All Branches', semester: null, subjectName: null };
  }
}

/**
 * Derives a stable composite exam identity key.
 * Format: `<normSubject>:<branch>:<year>:<examType>[:<paperCode>]`
 */
function buildIdentityKey({ normalizedSubject, branch, semester, year, examType, paperCode }) {
  const normSubj = normalizedSubject || 'general';
  const normBranch = (branch || 'all').toLowerCase().replace(/\s+/g, '-');
  const semToken = semester ? `:sem${semester}` : '';
  const normYear = (year || 'unknown').toLowerCase();
  const normExam = (examType || 'unknown').toLowerCase();
  const normCode = paperCode ? `:${paperCode.toLowerCase()}` : '';

  return `${normSubj}:${normBranch}${semToken}:${normYear}:${normExam}${normCode}`;
}

/**
 * Inspects PDF buffer using pure local parsing (pdf-parse).
 * Zero external network calls, zero paid API dependencies.
 *
 * Computes:
 * - pageCount
 * - hasText
 * - textLength
 * - qualityScore (0-100 composite based on text extractability, length, page count)
 */
async function inspectPdfContent(fileBuffer) {
  try {
    let cleanText = '';
    let numPages = 1;

    // Check if pdf-parse export is the class-based or function-based
    const PDFParseClass = pdfParse.PDFParse || (typeof pdfParse === 'function' ? null : null);
    if (PDFParseClass) {
      const parser = new PDFParseClass({ data: fileBuffer });
      await parser.load();
      const textRes = await parser.getText();
      cleanText = (textRes?.text || (typeof textRes === 'string' ? textRes : '')).replace(/\s+/g, ' ').trim();
      const info = await parser.getInfo().catch(() => ({}));
      numPages = info?.pages?.length || 1;
      await parser.destroy().catch(() => {});
    } else if (typeof pdfParse === 'function') {
      const data = await pdfParse(fileBuffer, { max: 10 });
      numPages = data.numpages || 1;
      cleanText = (data.text || '').replace(/\s+/g, ' ').trim();
    } else {
      // Fallback byte inspection for page count (/Type /Page markers)
      const bufferStr = fileBuffer.toString('binary', 0, Math.min(fileBuffer.length, 100000));
      const pageMatches = bufferStr.match(/\/Type\s*\/Page\b/g);
      numPages = pageMatches ? pageMatches.length : 1;
    }

    const textLength = cleanText.length;
    const hasText = textLength > 40; // digital text threshold

    // Quality Score calculation (0 - 100)
    // 1. Digital text score: up to 50 pts (OCR/text presence means high readability & searchability)
    // 2. Page count sanity: up to 25 pts (question papers typically 1-6 pages)
    // 3. File density balance: up to 25 pts (adequate bytes per page without being 0 or bloated)
    let score = 20; // baseline for valid parseable PDF

    if (hasText) {
      if (textLength > 500) score += 45;
      else if (textLength > 150) score += 30;
      else score += 15;
    }

    if (numPages >= 1 && numPages <= 8) {
      score += 25;
    } else if (numPages > 8) {
      score += 10;
    }

    const bytesPerPage = fileBuffer.length / Math.max(1, numPages);
    if (bytesPerPage >= 50000 && bytesPerPage <= 3000000) {
      score += 10; // good resolution balance
    }

    const finalScore = Math.min(100, Math.max(0, score));

    return {
      pageCount: numPages,
      hasText,
      textLength,
      qualityScore: finalScore,
      extractedSample: cleanText.slice(0, 300)
    };
  } catch (err) {
    console.warn('[PDF Inspection Warning] Could not parse PDF text:', err.message);
    return {
      pageCount: 1,
      hasText: false,
      textLength: 0,
      qualityScore: 30, // fallback baseline
      extractedSample: ''
    };
  }
}

/**
 * Checks for duplicate paper and assigns / updates DuplicatePaperGroup.
 */
async function processDuplicateDetection({
  fileHash,
  examIdentity,
  qualityScore,
  currentDocId = null,
  DocumentModel = null,
  DuplicateGroupModel = null
}) {
  const DocModel = DocumentModel || Document;
  const GroupModel = DuplicateGroupModel || DuplicatePaperGroup;

  // 1. Check EXACT FILE MATCH against already APPROVED documents
  let exactApprovedQuery = DocModel.findOne({
    fileHash: fileHash,
    status: 'approved',
    _id: { $ne: currentDocId }
  });
  const exactApprovedMatch = (exactApprovedQuery && typeof exactApprovedQuery.lean === 'function') 
    ? await exactApprovedQuery.lean() 
    : await exactApprovedQuery;

  if (exactApprovedMatch) {
    return {
      isExactDuplicate: true,
      isProbableDuplicate: false,
      isApprovedCanonicalMatch: true,
      isDuplicateApproved: true,
      existingApproved: exactApprovedMatch,
      existingApprovedDoc: {
        id: exactApprovedMatch._id,
        title: exactApprovedMatch.title,
        status: exactApprovedMatch.status,
        fileUrl: exactApprovedMatch.fileUrl,
        year: exactApprovedMatch.year,
        subject: exactApprovedMatch.subject
      }
    };
  }

  // 2. Check EXACT FILE MATCH against PENDING submissions
  let exactPendingQuery = DocModel.findOne({
    fileHash: fileHash,
    status: 'pending',
    _id: { $ne: currentDocId }
  });
  const exactPendingMatch = (exactPendingQuery && typeof exactPendingQuery.lean === 'function')
    ? await exactPendingQuery.lean()
    : await exactPendingQuery;

  // 3. Find or Create DuplicatePaperGroup for this identityKey
  const { identityKey, normalizedSubject, branch, semester, year, examType, paperCode } = examIdentity || {};
  let group = GroupModel.findOne ? await GroupModel.findOne({ identityKey }) : null;

  if (!group && GroupModel) {
    if (typeof GroupModel === 'function') {
      group = new GroupModel({
        identityKey,
        subject: normalizedSubject,
        branch: branch || 'All Branches',
        semester: semester || null,
        year: year || null,
        examType: examType || 'unknown',
        paperCode: paperCode || null,
        status: 'needs_review'
      });
      if (typeof group.save === 'function') await group.save();
    } else if (typeof GroupModel.create === 'function') {
      group = await GroupModel.create({
        identityKey,
        subject: normalizedSubject,
        branch: branch || 'All Branches',
        semester: semester || null,
        year: year || null,
        examType: examType || 'unknown',
        paperCode: paperCode || null,
        status: 'needs_review'
      });
    }
  }

  // Check if there are other candidates in this group
  let existingCandidatesCount = 0;
  if (typeof DocModel.countDocuments === 'function') {
    existingCandidatesCount = await DocModel.countDocuments({
      'examIdentity.identityKey': identityKey,
      _id: { $ne: currentDocId }
    });
  }

  const isProbable = existingCandidatesCount > 0;
  const isExactPending = !!exactPendingMatch;

  return {
    isExactDuplicate: isExactPending,
    isProbableDuplicate: isProbable,
    isApprovedCanonicalMatch: false,
    group,
    matchConfidence: isExactPending ? 'exact' : (isProbable ? 'strong' : 'none'),
    matchReason: isExactPending 
      ? 'Identical SHA-256 file checksum matches another pending submission'
      : (isProbable ? 'Matches existing exam identity (subject, branch, exam session & year)' : '')
  };
}

module.exports = {
  computeFileHash,
  normalizeSubject,
  normalizeExamType,
  normalizeYear,
  extractPaperCode,
  resolveFolderHierarchy,
  buildIdentityKey,
  inspectPdfContent,
  processDuplicateDetection
};

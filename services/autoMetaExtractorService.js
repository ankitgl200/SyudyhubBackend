/**
 * Smart AI Document Auto-Fill & Metadata Extractor Service
 * Automatically extracts document title, category, subject, academic year, and target folder
 * using client-extracted PDF text, heuristic pattern recognition, and Google Gemini AI.
 */

const { GoogleGenAI } = require('@google/genai');
const config = require('../config');
const { Folder } = require('../db/models');

let genAiClient = null;
function getGenAiClient() {
  if (!genAiClient && config.GEMINI && config.GEMINI.API_KEY) {
    try {
      genAiClient = new GoogleGenAI({ apiKey: config.GEMINI.API_KEY });
    } catch (err) {
      console.warn('[AutoMetaExtractor] Failed to initialize GoogleGenAI client:', err.message);
    }
  }
  return genAiClient;
}

// 1. Fast Heuristic & Regex Parser (Always reliable, 0 latency)
function extractHeuristicMetadata(fileName = '', text = '') {
  const cleanName = fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
  const combined = (cleanName + ' ' + text).toLowerCase();

  // Category detection
  let category = 'notes';
  if (/question\s*paper|previous\s*year|pyq|mid\s*sem|end\s*sem|sessional|exam\s*paper|back\s*paper/i.test(combined)) {
    category = 'papers';
  } else if (/lab\s*manual|practical\s*file|experiment\s*manual|observation\s*book|lab\s*work/i.test(combined)) {
    category = 'lab_manuals';
  } else if (/syllabus|curriculum|course\s*structure|course\s*outline/i.test(combined)) {
    category = 'syllabus';
  } else if (/textbook|reference\s*book|author:|edition|isbn/i.test(combined) && combined.length > 500) {
    category = 'books';
  }

  // Subject code detection (e.g., KCS-301, BCS-402, TCS-501, BAS-103)
  const codeMatch = (cleanName + ' ' + text.slice(0, 1500)).match(/\b([A-Z]{2,4}[-\s]?[0-9]{3}[A-Z]?)\b/i);
  const subjectCode = codeMatch ? codeMatch[1].toUpperCase().replace(/\s+/, '-') : null;

  // Unit / Chapter detection
  const unitMatch = (cleanName + ' ' + text.slice(0, 1500)).match(/\b(Unit|Module|Chapter)[-\s:]*([0-9IVX]+)(?:\s*[:\-]\s*([a-zA-Z0-9\s]{3,35}))?/i);
  let unitPart = '';
  if (unitMatch) {
    unitPart = `Unit ${unitMatch[2].toUpperCase()}${unitMatch[3] ? ': ' + unitMatch[3].trim() : ''}`;
  }

  // Year detection (e.g. 2024-25, 2023, 2022)
  const currentYear = new Date().getFullYear();
  const yearMatch = (cleanName + ' ' + text.slice(0, 1500)).match(/\b(20[12][0-9](?:-[12][0-9])?)\b/);
  let academicYear = yearMatch ? yearMatch[1] : `${currentYear}-${(currentYear + 1).toString().slice(-2)}`;
  if (academicYear.length === 4) {
    const yrNum = parseInt(academicYear, 10);
    academicYear = `${yrNum}-${(yrNum + 1).toString().slice(-2)}`;
  }

  // Generate clean title without duplicates
  let generatedTitle = cleanName;
  if (subjectCode && unitPart) {
    generatedTitle = `${subjectCode} ${unitPart}`;
  } else if (unitPart) {
    const stripped = cleanName.replace(/\b(unit|module|chapter)[-\s:]*[0-9ivx]+\b/i, '').trim();
    generatedTitle = stripped ? `${stripped} ${unitPart}` : `${unitPart} Notes`;
  } else if (category === 'papers') {
    if (!/pyq|paper|examination/i.test(cleanName)) {
      generatedTitle = `${cleanName} PYQ (${academicYear})`;
    }
  } else if (category === 'lab_manuals') {
    if (!/lab\s*manual|practical/i.test(cleanName)) {
      generatedTitle = `${cleanName} Lab Manual`;
    }
  }

  return {
    title: generatedTitle.slice(0, 80).trim(),
    category,
    subjectCode,
    academicYear,
    confidence: 'heuristic'
  };
}

// 2. Folder Matching Helper
function findBestMatchingFolder(subjectNameOrCode, folders) {
  if (!subjectNameOrCode || !folders || folders.length === 0) return null;
  const needle = subjectNameOrCode.toLowerCase().replace(/[^a-z0-9]/g, '');

  let bestMatch = null;
  let maxScore = 0;

  for (const f of folders) {
    const haystack = (f.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (haystack === needle) {
      return f; // Exact match
    }
    if (haystack.includes(needle) || needle.includes(haystack)) {
      const score = Math.min(haystack.length, needle.length) / Math.max(haystack.length, needle.length);
      if (score > maxScore && score > 0.4) {
        maxScore = score;
        bestMatch = f;
      }
    }
  }

  return bestMatch;
}

// 3. Main Extraction Pipeline
async function extractMetadata({ fileName = '', extractedText = '', currentCategory = null, currentFolderId = null, currentFolderName = null }) {
  // Always run heuristic first as baseline
  const heuristic = extractHeuristicMetadata(fileName, extractedText);

  // Fetch available folders from DB for accurate matching
  let dbFolders = [];
  try {
    const query = {};
    if (currentCategory) {
      query.type = currentCategory;
    }
    dbFolders = await Folder.find(query).select('_id name type parentId').lean();
  } catch (err) {
    console.warn('[AutoMetaExtractor] Failed to query folders:', err.message);
  }

  const folderNamesList = dbFolders.map(f => f.name).slice(0, 50);

  // Attempt Gemini AI extraction if client is available
  const client = getGenAiClient();
  if (client && (extractedText.length > 20 || fileName.length > 3)) {
    try {
      const prompt = `You are an expert university academic assistant and document librarian for StudyMyte (BTKIT Dwarahat / UTU Uttarakhand Technical University).
Analyze the uploaded document's file name and the extracted text from its first few pages:

File Name: "${fileName}"
Available Subject Folders in Portal: ${JSON.stringify(folderNamesList)}

Text Content from Document (first 2-3 pages):
"""
${(extractedText || '').slice(0, 2500)}
"""

Determine the exact academic metadata and return ONLY a valid JSON object with these exact keys:
{
  "title": "A clean, concise, student-friendly title (e.g., 'Unit 1: Introduction to Trees & Binary Search', 'Mid-Semester PYQ 2023', 'Operating Systems Lab Manual')",
  "category": "notes" OR "papers" OR "lab_manuals" OR "books" OR "syllabus" OR "competitive",
  "subject": "The academic subject name (e.g., 'Data Structures', 'Operating Systems', 'Mathematics-II')",
  "subjectCode": "Subject code like 'KCS-301' or 'BCS-201' if present, otherwise null",
  "matchedFolderName": "The EXACT folder name from Available Subject Folders that matches this document, or null if no exact folder matches",
  "academicYear": "Academic session e.g. '2024-25' or '2023-24'",
  "semester": "Semester number like '3' or '4' if identified, otherwise null",
  "confidence": "high" OR "medium"
}`;

      const modelName = config.GEMINI && config.GEMINI.MODEL ? config.GEMINI.MODEL : 'gemini-2.5-flash';
      const aiResponse = await client.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const responseText = aiResponse.text ? aiResponse.text.trim() : '';
      if (responseText) {
        const parsed = JSON.parse(responseText);
        
        // Find matching folder id if matchedFolderName is returned
        let matchedFolderId = null;
        if (parsed.matchedFolderName) {
          const match = dbFolders.find(f => f.name.toLowerCase() === parsed.matchedFolderName.toLowerCase());
          if (match) matchedFolderId = match._id.toString();
        }

        // If no match by exact name, try fuzzy search with subject
        if (!matchedFolderId && parsed.subject) {
          const fuzzy = findBestMatchingFolder(parsed.subject, dbFolders);
          if (fuzzy) {
            matchedFolderId = fuzzy._id.toString();
            parsed.matchedFolderName = fuzzy.name;
          }
        }

        return {
          title: (parsed.title || heuristic.title).trim(),
          category: parsed.category || heuristic.category,
          subject: parsed.subject || null,
          subjectCode: parsed.subjectCode || heuristic.subjectCode,
          academicYear: parsed.academicYear || heuristic.academicYear,
          semester: parsed.semester || null,
          matchedFolderName: parsed.matchedFolderName || null,
          matchedFolderId: matchedFolderId || null,
          confidence: parsed.confidence || 'high'
        };
      }
    } catch (aiErr) {
      console.warn('[AutoMetaExtractor] Gemini extraction fallback to heuristic:', aiErr.message);
    }
  }

  // Fallback to Heuristic Match
  let heuristicFolderMatch = null;
  if (heuristic.subjectCode) {
    heuristicFolderMatch = findBestMatchingFolder(heuristic.subjectCode, dbFolders);
  }
  if (!heuristicFolderMatch) {
    heuristicFolderMatch = findBestMatchingFolder(heuristic.title, dbFolders);
  }

  return {
    title: heuristic.title,
    category: currentCategory || heuristic.category,
    subject: heuristic.subjectCode || null,
    subjectCode: heuristic.subjectCode,
    academicYear: heuristic.academicYear,
    semester: null,
    matchedFolderName: heuristicFolderMatch ? heuristicFolderMatch.name : (currentFolderName || null),
    matchedFolderId: heuristicFolderMatch ? heuristicFolderMatch._id.toString() : (currentFolderId || null),
    confidence: 'heuristic'
  };
}

module.exports = {
  extractMetadata,
  extractHeuristicMetadata
};

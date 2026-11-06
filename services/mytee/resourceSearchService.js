/**
 * =========================================================================
 * StudyMyte — Hierarchical Resource Search Engine
 * =========================================================================
 * Translates natural-language student requests into precise database queries
 * that strictly respect StudyMyte's Folder Hierarchy:
 * Section (Notes/Papers) -> Year Level -> Branch Level -> Subject Level -> Documents.
 *
 * Strict Rules:
 * 1. Zero Cross-Year Mix-ups: NEVER return 1st year docs when user asks for Final Year.
 * 2. Zero Branch Mix-ups: NEVER return Mechanical docs when user asks for CSE.
 * 3. Honest Missing Detection: If requested content is not in DB, report 0 results
 *    with clear instructions on the 2 upload/contribution methods.
 */

const { Document, Folder } = require('../../db/models');

const SUBJECT_ALIASES = {
  'oops': 'OOPs',
  'oop': 'OOPs',
  'object oriented programming': 'OOPs',
  'java': 'Java Programming',
  'dsa': 'DSA',
  'data structures': 'DSA',
  'data structure': 'DSA',
  'discrete structure': 'Discrete structure',
  'discrete structures': 'Discrete structure',
  'discrete mathematics': 'Discrete structure',
  'discrete maths': 'Discrete structure',
  'dbms': 'Database Management System',
  'database': 'Database Management System',
  'os': 'Operating Systems',
  'operating systems': 'Operating Systems',
  'operating system': 'Operating Systems',
  'cn': 'Computer Networks',
  'computer networks': 'Computer Networks',
  'maths': 'Engineering Mathematics',
  'math': 'Engineering Mathematics',
  'mathematics': 'Engineering Mathematics',
  'm1': 'Engineering Mathematics',
  'm2': 'Engineering Mathematics',
  'm3': 'Engineering Mathematics',
  'physics': 'Engineering Physics',
  'chemistry': 'Engineering Chemistry',
  'engineering chemistry': 'Engineering Chemistry',
  'c programming': 'Computer Programming',
  'python': 'Python',
  'python programming': 'Python',
  'ai': 'Artificial Intelligence',
  'ml': 'Machine Learning',
  'daa': 'Design and Analysis of Algorithms',
  'toc': 'Theory of Computation',
  'se': 'Software Engineering',
  'bee': 'Basic Electrical Engineering',
  'de': 'DE',
  'digital electronics': 'DE'
};

const YEAR_MAPPINGS = {
  '1st year': 'First Year',
  'first year': 'First Year',
  '1st': 'First Year',
  'first': 'First Year',
  'sem 1': 'First Year',
  'sem 2': 'First Year',
  'semester 1': 'First Year',
  'semester 2': 'First Year',

  '2nd year': 'Second Year',
  'second year': 'Second Year',
  '2nd': 'Second Year',
  'second': 'Second Year',
  'sem 3': 'Second Year',
  'sem 4': 'Second Year',
  'semester 3': 'Second Year',
  'semester 4': 'Second Year',

  '3rd year': 'Third Year',
  'third year': 'Third Year',
  '3rd': 'Third Year',
  'third': 'Third Year',
  'sem 5': 'Third Year',
  'sem 6': 'Third Year',
  'semester 5': 'Third Year',
  'semester 6': 'Third Year',

  '4th year': 'Final Year',
  'fourth year': 'Final Year',
  '4th': 'Final Year',
  'fourth': 'Final Year',
  'final year': 'Final Year',
  'final': 'Final Year',
  'sem 7': 'Final Year',
  'sem 8': 'Final Year',
  'semester 7': 'Final Year',
  'semester 8': 'Final Year'
};

const BRANCH_MAPPINGS = {
  'cse': 'Computer Science Engineering',
  'cs': 'Computer Science Engineering',
  'computer science': 'Computer Science Engineering',
  'it': 'Information Technology',
  'ece': 'Electronics & Communication Engineering',
  'electronics': 'Electronics & Communication Engineering',
  'me': 'Mechanical Engineering',
  'mech': 'Mechanical Engineering',
  'mechanical': 'Mechanical Engineering',
  'ce': 'Civil Engineering',
  'civil': 'Civil Engineering',
  'bt': 'Biotechnology',
  'biotech': 'Biotechnology',
  'biotechnology': 'Biotechnology',
  'ee': 'Electrical Engineering',
  'electrical': 'Electrical Engineering'
};

const TYPE_MAPPINGS = {
  'pyq': 'paper',
  'pyqs': 'paper',
  'paper': 'paper',
  'papers': 'paper',
  'question paper': 'paper',
  'question papers': 'paper',
  'previous year': 'paper',
  'exam': 'paper',
  'midterm': 'paper',
  'endterm': 'paper',
  'sessional': 'paper',
  'note': 'notes',
  'notes': 'notes',
  'handwritten': 'notes',
  'lecture': 'notes',
  'manual': 'lab_manual',
  'manuals': 'lab_manual',
  'lab manual': 'lab_manual',
  'lab': 'lab_manual',
  'book': 'book',
  'books': 'book',
  'textbook': 'book',
  'syllabus': 'syllabus'
};

/**
 * Parses natural-language search queries into structured attributes.
 */
function parseResourceQuery(queryString) {
  if (!queryString || typeof queryString !== 'string') return {};

  const clean = queryString.toLowerCase().replace(/[?,.]/g, ' ');
  const tokens = clean.split(/\s+/).filter(Boolean);

  let detectedType = null;
  let detectedSubject = null;
  let detectedYear = null;
  let detectedBranch = null;
  let detectedCalendarYear = null;

  // 1. Detect Resource Type
  for (const [key, val] of Object.entries(TYPE_MAPPINGS)) {
    if (new RegExp(`(^|\\W)${key}($|\\W)`, 'i').test(clean)) {
      detectedType = val;
      break;
    }
  }

  // 2. Detect Calendar Year (e.g. 2024, 2023, 2022)
  const calMatch = clean.match(/\b(201\d|202\d)\b/);
  if (calMatch) {
    detectedCalendarYear = calMatch[1];
  }

  // 3. Detect Academic Year (First Year, Second Year, Third Year, Final Year)
  for (const [key, val] of Object.entries(YEAR_MAPPINGS)) {
    if (new RegExp(`(^|\\W)${key}($|\\W)`, 'i').test(clean)) {
      detectedYear = val;
      break;
    }
  }

  // 4. Detect Branch
  for (const [key, val] of Object.entries(BRANCH_MAPPINGS)) {
    if (new RegExp(`(^|\\W)${key}($|\\W)`, 'i').test(clean)) {
      detectedBranch = val;
      break;
    }
  }

  // 5. Detect Subject
  for (const [alias, canonicalName] of Object.entries(SUBJECT_ALIASES)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|\\W)${escaped}($|\\W)`, 'i').test(clean)) {
      detectedSubject = canonicalName;
      break;
    }
  }

  return {
    raw: queryString,
    type: detectedType,
    subject: detectedSubject,
    academicYear: detectedYear,
    branch: detectedBranch,
    calendarYear: detectedCalendarYear,
    tokens
  };
}

/**
 * Recursively retrieves all descendant folder IDs for a given folder.
 */
async function getFolderDescendantIds(folderId, allFolders) {
  const result = [folderId.toString()];
  const children = allFolders.filter(f => f.parentId && f.parentId.toString() === folderId.toString());
  for (const child of children) {
    const subIds = await getFolderDescendantIds(child._id, allFolders);
    result.push(...subIds);
  }
  return [...new Set(result)];
}

/**
 * Searches documents in MongoDB strictly respecting StudyMyte's hierarchical folder tree.
 */
async function searchResources(params = {}, userContext = null) {
  const queryStr = params.query || '';
  const parsed = parseResourceQuery(queryStr);

  const targetType = params.type || parsed.type;
  const targetSubject = params.subject || parsed.subject;
  const targetYear = params.year || parsed.academicYear;
  const targetBranch = params.branch || parsed.branch;
  const limit = Math.min(Math.max(parseInt(params.limit, 10) || 5, 1), 10);

  // If query is too vague, prompt the user for clarification rather than returning random stuff
  if (!targetSubject && !targetType && !targetYear && !targetBranch) {
    const rawTerms = queryStr.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const contentTerms = rawTerms.filter(t => t.length > 2 && !['show', 'give', 'get', 'need', 'want', 'find', 'paper', 'notes', 'questions'].includes(t));
    if (contentTerms.length === 0) {
      return {
        query: queryStr,
        count: 0,
        resources: [],
        needsClarification: true,
        message: 'Please specify the **Year/Semester** and **Subject or Branch** you are looking for (e.g. "Second Year CSE DSA Notes" or "First Year Chemistry PYQs").'
      };
    }
  }

  try {
    const allFolders = await Folder.find().lean();

    // Map all folders by ID for path resolution
    const folderMap = new Map();
    allFolders.forEach(f => folderMap.set(f._id.toString(), f));

    // Helper to get full breadcrumb path of a folder
    function getFolderPath(folderId) {
      if (!folderId) return '';
      const names = [];
      let current = folderMap.get(folderId.toString());
      while (current) {
        names.unshift(current.name);
        current = current.parentId ? folderMap.get(current.parentId.toString()) : null;
      }
      return names.join(' > ');
    }

    // Step 1: Resolve Target Folders if Year or Branch is requested
    let matchedFolderIds = null;

    if (targetYear) {
      // Find root year folder matching targetYear (e.g., 'First Year', 'Second Year', 'Final Year')
      const yearFolders = allFolders.filter(f => {
        const fName = f.name.toLowerCase();
        const yLow = targetYear.toLowerCase();
        return fName === yLow || (yLow === 'final year' && (fName.includes('final') || fName.includes('4th')));
      });

      if (yearFolders.length === 0) {
        // Year folder does not exist at all (e.g. Final Year in notes currently has no folder)
        return {
          query: queryStr,
          count: 0,
          resources: [],
          notFound: true,
          details: { requestedYear: targetYear, requestedBranch: targetBranch, requestedSubject: targetSubject },
          message: `Currently, no folders or materials exist for **${targetYear}** on StudyMyte.`,
          contributionGuide: {
            method1: "Click the '+' floating blue button at the bottom-left of your screen, enter title, choose the category, and upload the file.",
            method2: "Navigate to the specific section (/notes or /papers), enter the desired folder, and click the '+ Contribute' button on the top-right."
          }
        };
      }

      // Collect all descendants of the year folder
      let candidateFolderIds = [];
      for (const yf of yearFolders) {
        const descIds = await getFolderDescendantIds(yf._id, allFolders);
        candidateFolderIds.push(...descIds);
      }

      // If user also specified a branch (e.g. CSE), filter only to branch subfolder branch
      if (targetBranch) {
        const branchFolders = allFolders.filter(f => {
          return candidateFolderIds.includes(f._id.toString()) &&
            (f.name.toLowerCase().includes(targetBranch.toLowerCase()) || targetBranch.toLowerCase().includes(f.name.toLowerCase()));
        });

        if (branchFolders.length > 0) {
          let branchDescIds = [];
          for (const bf of branchFolders) {
            const descIds = await getFolderDescendantIds(bf._id, allFolders);
            branchDescIds.push(...descIds);
          }
          candidateFolderIds = branchDescIds;
        } else {
          // Branch folder under this year doesn't exist
          return {
            query: queryStr,
            count: 0,
            resources: [],
            notFound: true,
            details: { requestedYear: targetYear, requestedBranch: targetBranch, requestedSubject: targetSubject },
            message: `Currently, no materials exist for **${targetYear} ${targetBranch}** on StudyMyte.`,
            contributionGuide: {
              method1: "Click the '+' floating blue button at the bottom-left of your screen to contribute files.",
              method2: "Go to the relevant section and click '+ Contribute' on the top-right."
            }
          };
        }
      }

      matchedFolderIds = candidateFolderIds;
    }

    // Step 2: Build MongoDB Filter
    const filter = {
      status: 'approved'
    };

    if (userContext && (userContext.role === 'admin' || userContext.role === 'superadmin')) {
      delete filter.status;
    }

    // Apply Type Filter
    if (targetType) {
      if (targetType === 'paper' || targetType === 'papers') filter.type = 'paper';
      else if (targetType === 'notes') filter.type = 'notes';
      else if (targetType === 'lab_manual') filter.type = { $in: ['lab_manual', 'simulation'] };
      else if (targetType === 'book') filter.type = 'book';
      else filter.type = targetType;
    }

    // Apply Folder Scope Filter if resolved
    if (matchedFolderIds && matchedFolderIds.length > 0) {
      filter.folderId = { $in: matchedFolderIds };
    }

    // Apply Subject Filter
    if (targetSubject) {
      const escaped = targetSubject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // If folder filter was not already locked, also match by subject name in Folder titles
      const subjectFolders = allFolders.filter(f => f.name.toLowerCase().includes(targetSubject.toLowerCase()));
      const subjectFolderIds = subjectFolders.map(f => f._id);

      const subjectConditions = [
        { subject: { $regex: escaped, $options: 'i' } },
        { title: { $regex: escaped, $options: 'i' } }
      ];

      if (subjectFolderIds.length > 0) {
        subjectConditions.push({ folderId: { $in: subjectFolderIds } });
      }

      if (filter.folderId) {
        filter.$or = subjectConditions;
      } else {
        filter.$or = subjectConditions;
      }
    }

    // Step 3: Execute Database Query
    const documents = await Document.find(filter)
      .sort({ isPinned: -1, likes: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    // Step 4: Strict Post-Filter Verification
    // Ensure that if user asked for a specific year (e.g. Final Year),
    // no document from First Year or Second Year is ever leaked!
    const verifiedDocuments = [];
    for (const doc of documents) {
      const folderPath = getFolderPath(doc.folderId).toLowerCase();
      const docYear = (doc.year || '').toLowerCase();

      if (targetYear) {
        const yCheck = targetYear.toLowerCase();
        if (yCheck.includes('final') || yCheck.includes('4th')) {
          if (folderPath.includes('first') || folderPath.includes('1st') || folderPath.includes('second') || folderPath.includes('2nd') || docYear.includes('1st') || docYear.includes('2nd')) {
            continue; // Reject leaked document!
          }
        } else if (yCheck.includes('first') || yCheck.includes('1st')) {
          if (folderPath.includes('second') || folderPath.includes('2nd') || folderPath.includes('third') || folderPath.includes('final') || folderPath.includes('4th')) {
            continue; // Reject leaked document!
          }
        }
      }

      verifiedDocuments.push(doc);
    }

    // Step 5: Format Verified Results
    const results = verifiedDocuments.map(doc => {
      let routePath = '/notes';
      if (doc.type === 'paper') routePath = '/papers';
      else if (doc.type === 'book' || doc.type === 'lab_manual' || doc.type === 'simulation') routePath = '/resources';

      const fullFolderBreadcrumb = getFolderPath(doc.folderId);

      return {
        id: doc._id.toString(),
        title: doc.title,
        type: doc.type,
        subject: doc.subject || (doc.folderId ? folderMap.get(doc.folderId.toString())?.name : 'General'),
        folderPath: fullFolderBreadcrumb || 'Study Repository',
        year: doc.year || 'All Years',
        branch: doc.examIdentity?.branch || 'Engineering',
        viewUrl: `/api/documents/download/${doc._id}`,
        downloadUrl: `/api/documents/download/${doc._id}`,
        navigationUrl: routePath,
        createdAt: doc.createdAt
      };
    });

    if (results.length === 0) {
      return {
        query: queryStr,
        count: 0,
        resources: [],
        notFound: true,
        details: { requestedYear: targetYear, requestedBranch: targetBranch, requestedSubject: targetSubject },
        message: `No documents currently found in our verified folder records for ${targetYear ? `**${targetYear}** ` : ''}${targetBranch ? `**${targetBranch}** ` : ''}${targetSubject ? `**${targetSubject}**` : 'your query'}.`,
        contributionGuide: {
          method1: "Click the '+' floating blue button at the bottom-left of your screen to upload file details directly.",
          method2: "Navigate directly to that folder in /notes or /papers and click '+ Contribute' on the top-right."
        }
      };
    }

    return {
      query: queryStr,
      filtersApplied: {
        type: targetType,
        subject: targetSubject,
        year: targetYear,
        branch: targetBranch
      },
      count: results.length,
      resources: results
    };

  } catch (err) {
    console.error('[ResourceSearch] Error searching documents:', err.message);
    return {
      query: queryStr,
      error: 'Failed to search database',
      resources: []
    };
  }
}

module.exports = {
  searchResources,
  parseResourceQuery,
  SUBJECT_ALIASES,
  TYPE_MAPPINGS,
  YEAR_MAPPINGS,
  BRANCH_MAPPINGS
};

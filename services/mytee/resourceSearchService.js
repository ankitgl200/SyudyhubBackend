/**
 * Resource Search Service
 * Translates natural-language educational queries into precise MongoDB queries.
 * Normalizes subject names, academic years, semesters, and resource categories.
 */

const { Document, Folder } = require('../../db/models');

const SUBJECT_ALIASES = {
  'oops': 'Object Oriented Programming',
  'oop': 'Object Oriented Programming',
  'java': 'Java Programming',
  'dsa': 'Data Structures',
  'data structures': 'Data Structures',
  'dbms': 'Database Management System',
  'os': 'Operating Systems',
  'operating systems': 'Operating Systems',
  'cn': 'Computer Networks',
  'computer networks': 'Computer Networks',
  'maths': 'Engineering Mathematics',
  'math': 'Engineering Mathematics',
  'm1': 'Engineering Mathematics',
  'm2': 'Engineering Mathematics',
  'm3': 'Engineering Mathematics',
  'physics': 'Engineering Physics',
  'chemistry': 'Engineering Chemistry',
  'c programming': 'Computer Programming',
  'c++': 'Object Oriented Programming with C++',
  'python': 'Python Programming',
  'ai': 'Artificial Intelligence',
  'ml': 'Machine Learning',
  'daa': 'Design and Analysis of Algorithms',
  'toc': 'Theory of Computation',
  'se': 'Software Engineering'
};

const YEAR_MAPPINGS = {
  '1st year': '1st Year',
  'first year': '1st Year',
  '1st': '1st Year',
  '2nd year': '2nd Year',
  'second year': '2nd Year',
  '2nd': '2nd Year',
  '3rd year': '3rd Year',
  'third year': '3rd Year',
  '3rd': '3rd Year',
  '4th year': '4th Year',
  'fourth year': '4th Year',
  '4th': '4th Year'
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
  'note': 'notes',
  'notes': 'notes',
  'handwritten': 'notes',
  'lecture': 'notes',
  'manual': 'lab_manual',
  'manuals': 'lab_manual',
  'lab manual': 'lab_manual',
  'lab': 'lab_manual',
  'practical': 'lab_manual',
  'book': 'book',
  'books': 'book',
  'textbook': 'book',
  'roadmap': 'simulation',
  'simulation': 'simulation',
  'syllabus': 'syllabus'
};

/**
 * Parses user natural language query to extract search parameters.
 */
function parseResourceQuery(queryString) {
  if (!queryString || typeof queryString !== 'string') {
    return {};
  }

  const clean = queryString.toLowerCase().replace(/[?,.]/g, ' ');
  const tokens = clean.split(/\s+/).filter(Boolean);

  let detectedType = null;
  let detectedSubject = null;
  let detectedYear = null;
  let detectedCalendarYear = null;

  // 1. Detect Resource Type
  for (const [key, val] of Object.entries(TYPE_MAPPINGS)) {
    if (clean.includes(key)) {
      detectedType = val;
      break;
    }
  }

  // 2. Detect Calendar Year (e.g. 2024, 2023, 2022)
  const calYearMatch = clean.match(/\b(201\d|202\d)\b/);
  if (calYearMatch) {
    detectedCalendarYear = calYearMatch[1];
  }

  // 3. Detect Academic Year (1st year, 2nd year, etc.)
  for (const [key, val] of Object.entries(YEAR_MAPPINGS)) {
    if (clean.includes(key)) {
      detectedYear = val;
      break;
    }
  }

  // 4. Detect Subject
  for (const [alias, fullName] of Object.entries(SUBJECT_ALIASES)) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\W)${escapedAlias}($|\\W)`, 'i');
    if (regex.test(clean)) {
      detectedSubject = fullName;
      break;
    }
  }

  return {
    raw: queryString,
    type: detectedType,
    subject: detectedSubject,
    academicYear: detectedYear,
    calendarYear: detectedCalendarYear,
    tokens
  };
}

const STOPWORDS = new Set([
  'hi', 'hello', 'hey', 'what', 'who', 'where', 'when', 'why', 'how', 'is', 'are', 'am',
  'can', 'you', 'tell', 'me', 'give', 'the', 'a', 'an', 'and', 'or', 'for', 'with', 'about',
  'this', 'that', 'site', 'website', 'please', 'help', 'some', 'any', 'all', 'do', 'does',
  'show', 'find', 'get', 'want', 'need', 'view', 'read'
]);

/**
 * Searches documents in MongoDB with multi-attribute filtering.
 * 
 * @param {Object} params
 * @param {string} [params.query] - Natural language or direct query
 * @param {string} [params.type] - Resource type (notes, paper, lab_manual, book)
 * @param {string} [params.subject] - Subject name
 * @param {string} [params.year] - Academic or calendar year
 * @param {number} [params.limit=5] - Maximum documents to return
 * @param {Object} [userContext] - Logged in user info
 */
async function searchResources(params = {}, userContext = null) {
  const queryStr = params.query || '';
  const parsed = parseResourceQuery(queryStr);

  const targetType = params.type || parsed.type;
  const targetSubject = params.subject || parsed.subject;
  const targetYear = params.year || parsed.calendarYear || parsed.academicYear;
  const limit = Math.min(Math.max(parseInt(params.limit, 10) || 5, 1), 10);

  // Filter query tokens by removing stopwords and small noise
  const rawTerms = queryStr.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const contentTerms = rawTerms.filter(t => t.length > 2 && !STOPWORDS.has(t));

  // If no subject, no type, no year, and no valid content terms were found, do not return random records
  if (!targetSubject && !targetType && !targetYear && contentTerms.length === 0) {
    return {
      query: queryStr,
      filtersApplied: {},
      count: 0,
      resources: []
    };
  }

  // Construct MongoDB filter
  const filter = {
    status: 'approved'
  };

  // If user is admin, allow querying all approved or pending
  if (userContext && (userContext.role === 'admin' || userContext.role === 'superadmin')) {
    delete filter.status;
  }

  // Type filter
  if (targetType) {
    if (targetType === 'paper' || targetType === 'papers') {
      filter.type = 'paper';
    } else if (targetType === 'notes') {
      filter.type = 'notes';
    } else if (targetType === 'lab_manual' || targetType === 'lab_manuals') {
      filter.type = { $in: ['lab_manual', 'simulation'] };
    } else if (targetType === 'book' || targetType === 'books') {
      filter.type = 'book';
    } else {
      filter.type = targetType;
    }
  }

  // Subject filter: match subject or examIdentity.normalizedSubject
  if (targetSubject) {
    const escaped = targetSubject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { subject: { $regex: escaped, $options: 'i' } },
      { 'examIdentity.normalizedSubject': { $regex: escaped, $options: 'i' } },
      { title: { $regex: escaped, $options: 'i' } }
    ];
  } else if (contentTerms.length > 0) {
    // If no specific subject was identified, use valid content terms across title and subject
    const regexTerms = contentTerms.map(t => ({
      $or: [
        { title: { $regex: t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { subject: { $regex: t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
      ]
    }));
    filter.$and = regexTerms;
  }

  // Year filter
  if (targetYear) {
    const escapedYear = targetYear.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const yearCondition = [
      { year: { $regex: escapedYear, $options: 'i' } },
      { 'examIdentity.year': { $regex: escapedYear, $options: 'i' } },
      { title: { $regex: escapedYear, $options: 'i' } }
    ];
    if (filter.$or) {
      filter.$and = filter.$and || [];
      filter.$and.push({ $or: yearCondition });
    } else {
      filter.$or = yearCondition;
    }
  }

  try {
    const documents = await Document.find(filter)
      .sort({
        isPinned: -1,
        'duplicateStatus.isCanonical': -1,
        likes: -1,
        createdAt: -1
      })
      .limit(limit)
      .lean();

    // Map into clean, verified resource cards
    const results = documents.map(doc => {
      let routePath = '/notes';
      if (doc.type === 'paper') routePath = '/papers';
      else if (doc.type === 'book' || doc.type === 'lab_manual' || doc.type === 'simulation') routePath = '/resources';

      return {
        id: doc._id.toString(),
        title: doc.title,
        type: doc.type,
        subject: doc.subject || 'General Engineering',
        year: doc.year || doc.examIdentity?.year || 'All Years',
        branch: doc.examIdentity?.branch || 'General',
        semester: doc.examIdentity?.semester || null,
        likesCount: Array.isArray(doc.likes) ? doc.likes.length : 0,
        isPinned: !!doc.isPinned,
        isCanonical: !!doc.duplicateStatus?.isCanonical,
        viewUrl: doc.fileUrl,
        downloadUrl: `/api/documents/download/${doc._id}`,
        navigationUrl: routePath,
        createdAt: doc.createdAt
      };
    });

    return {
      query: queryStr,
      filtersApplied: {
        type: targetType,
        subject: targetSubject,
        year: targetYear
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
  YEAR_MAPPINGS
};

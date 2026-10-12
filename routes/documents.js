const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const { Document, Announcement, Notification, User, DuplicatePaperGroup } = require('../db/models');
const config = require('../config');
const { auth, isStaff, isAdmin } = require('../middleware/auth');
const admin = require('../services/firebaseAdmin');
const {
  computeFileHash,
  normalizeSubject,
  normalizeExamType,
  normalizeYear,
  extractPaperCode,
  resolveFolderHierarchy,
  buildIdentityKey,
  inspectPdfContent,
  processDuplicateDetection
} = require('../services/duplicateEngine');

async function sendMulticastPushNotification(title, body, url) {
  try {
    const users = await User.find({ fcmTokens: { $exists: true, $not: { $size: 0 } } });
    const tokens = [];
    users.forEach(u => tokens.push(...u.fcmTokens));
    if (tokens.length === 0) return;

    const message = {
      notification: { title, body },
      data: { url: url || '/' },
      tokens: [...new Set(tokens)]
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(response.successCount + ' messages were sent successfully');
  } catch (err) {
    console.error('Error sending multicast push notification:', err);
  }
}

const getAbsoluteUrl = (req, url) => {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}${url}`;
};

// Setup temp directory
const TEMP_DIR = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Setup local uploads directory
const UPLOADS_DIR = config.UPLOADS_DIR;
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure Multer with cryptographically random server-generated filenames
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, TEMP_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(8).toString('hex');
    cb(null, 'doc-' + uniqueSuffix + '.pdf');
  }
});

const fileFilter = (req, file, cb) => {
  const fileExt = path.extname(file.originalname).toLowerCase();
  if (file.mimetype === 'application/pdf' || fileExt === '.pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF documents are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB Max
});

// Configure Cloudinary if credentials exist
let isCloudinaryConfigured = false;
if (config.CLOUDINARY.cloud_name && config.CLOUDINARY.api_key && config.CLOUDINARY.api_secret) {
  cloudinary.config({
    cloud_name: config.CLOUDINARY.cloud_name,
    api_key: config.CLOUDINARY.api_key,
    api_secret: config.CLOUDINARY.api_secret
  });
  isCloudinaryConfigured = true;
  console.log('Cloudinary successfully configured.');
} else {
  console.log('Cloudinary credentials missing. Falling back to local filesystem storage.');
}

/**
 * Sanitize client-provided display file name.
 * Strips path separators, directory traversal sequences, quotes, and control characters.
 */
function sanitizeFileName(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'document.pdf';
  const base = path.basename(rawName.trim());
  const clean = base.replace(/[\x00-\x1f\x7f"\\/]/g, '_').replace(/\s+/g, ' ').trim();
  return clean || 'document.pdf';
}

/**
 * Validate that an external URL is a well-formed HTTP/HTTPS URL and
 * does not point to internal, private, loopback, or cloud metadata endpoints.
 */
function validateExternalUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;
  try {
    const parsed = new URL(urlString.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    // Block loopback, private ranges, link-local, cloud metadata
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local')
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Robustly resolve and verify that a stored fileUrl corresponds to a legitimate file
 * strictly contained within the intended uploads directory.
 * Accounts for Windows/POSIX path separators, traversal sequences, absolute paths, and symlinks.
 * Never throws path errors; returns absolute realpath string on success, or null on any anomaly.
 */
function resolveSafeLocalPath(fileUrl, uploadsDir) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;

  // Reject null bytes and ASCII control characters immediately
  if (/[\x00-\x1f\x7f]/.test(fileUrl)) return null;

  // Local files are stored under the /uploads/ prefix
  let relativeName = fileUrl.trim();
  if (relativeName.startsWith('/uploads/')) {
    relativeName = relativeName.slice('/uploads/'.length);
  } else if (relativeName.startsWith('uploads/')) {
    relativeName = relativeName.slice('uploads/'.length);
  } else if (relativeName.startsWith('/uploads\\')) {
    relativeName = relativeName.slice('/uploads\\'.length);
  } else if (relativeName.startsWith('uploads\\')) {
    relativeName = relativeName.slice('uploads\\'.length);
  } else {
    return null;
  }

  // Defend against path separators and traversal tokens in relativeName
  // The filename must be strictly a single file component (no subdirectories or parent traversal)
  if (relativeName.includes('/') || relativeName.includes('\\')) {
    return null;
  }

  const baseName = path.basename(relativeName);
  if (!baseName || baseName === '.' || baseName === '..' || baseName !== relativeName) {
    return null;
  }

  // Windows drive letters (e.g. C:) or UNC prefixes
  if (/^[a-zA-Z]:/.test(relativeName) || relativeName.startsWith('\\\\')) {
    return null;
  }

  const rootDir = path.resolve(uploadsDir);
  const targetPath = path.resolve(rootDir, baseName);

  // 1. Lexical boundary check
  const rel = path.relative(rootDir, targetPath);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
    return null;
  }

  // 2. Existence check
  if (!fs.existsSync(targetPath)) {
    return null;
  }

  // 3. Realpath canonical resolution (symlink escape defense)
  try {
    const realRoot = fs.realpathSync(rootDir);
    const realTarget = fs.realpathSync(targetPath);

    const realRel = path.relative(realRoot, realTarget);
    if (realRel.startsWith('..') || path.isAbsolute(realRel) || realRel === '') {
      return null;
    }

    const stat = fs.statSync(realTarget);
    if (!stat.isFile()) {
      return null;
    }

    return realTarget;
  } catch {
    return null;
  }
}

// Helper to delete local file safely (only allows deletion within UPLOADS_DIR or TEMP_DIR)
function deleteLocalFile(filePath) {
  try {
    if (!filePath || typeof filePath !== 'string') return;
    const resolved = path.resolve(filePath);
    const resolvedUploads = path.resolve(UPLOADS_DIR);
    const resolvedTemp = path.resolve(TEMP_DIR);

    const relUploads = path.relative(resolvedUploads, resolved);
    const relTemp = path.relative(resolvedTemp, resolved);
    const isInsideUploads = !relUploads.startsWith('..') && !path.isAbsolute(relUploads) && relUploads !== '';
    const isInsideTemp = !relTemp.startsWith('..') && !path.isAbsolute(relTemp) && relTemp !== '';

    if ((isInsideUploads || isInsideTemp) && fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
    }
  } catch (err) {
    console.error('Error deleting file safely:', err.message);
  }
}

// @route   GET api/documents/public-stats
// @desc    Get public stats of all resources (count of approved documents and average rating of reviews) (Public)
router.get('/public-stats', async (req, res) => {
  try {
    const { Review } = require('../db/models');
    
    // Count of all approved documents
    const totalCount = await Document.countDocuments({ status: { $ne: 'pending' } });
    
    // Calculate average review score
    const reviews = await Review.find({});
    let averageRating = 4.8; // Default fallback
    if (reviews.length > 0) {
      const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
      averageRating = Number((sum / reviews.length).toFixed(1));
    }
    
    res.json({
      totalResources: totalCount,
      averageRating: averageRating
    });
  } catch (err) {
    console.error('Error fetching public stats:', err);
    res.status(500).json({ message: 'Server error fetching public stats' });
  }
});

// @route   GET api/documents
// @desc    Get documents, optional filters by type, folderId, subject, year (requires auth)
router.get('/', auth, async (req, res) => {
  const { type, folderId, subject, year } = req.query;
  const query = { status: { $ne: 'pending' } };

  if (type) query.type = type;
  if (folderId) {
    query.folderId = folderId === 'null' ? null : folderId;
  }
  if (subject) query.subject = subject;
  if (year) query.year = year;

  try {
    const documents = await Document.find(query).populate('uploadedByUserId', 'role').sort({ createdAt: -1 });
    const mapped = documents.map(d => {
      const isTeacher = d.uploadedByUserId && d.uploadedByUserId.role === 'educator';
      return {
        id: d._id,
        title: d.title,
        type: d.type,
        folderId: d.folderId,
        subject: d.subject,
        year: d.year,
        fileUrl: getAbsoluteUrl(req, d.fileUrl),
        fileName: d.fileName,
        uploadedBy: d.uploadedBy,
        uploadedByUserId: d.uploadedByUserId ? d.uploadedByUserId._id : null,
        isUploadedByTeacher: !!isTeacher,
        uploadedByRole: d.uploadedByUserId ? d.uploadedByUserId.role : null,
        likesCount: d.likes ? d.likes.length : 0,
        hasLiked: d.likes ? d.likes.includes(req.user.id) : false,
        isPinned: d.isPinned || false,
        createdAt: d.createdAt
      };
    });

    mapped.sort((a, b) => {
      // 0. Sort by pinned descending (pinned documents go on top)
      const pinA = a.isPinned ? 1 : 0;
      const pinB = b.isPinned ? 1 : 0;
      if (pinA !== pinB) {
        return pinB - pinA; // Pinned (1) comes before unpinned (0)
      }

      const likesA = a.likesCount || 0;
      const likesB = b.likesCount || 0;

      // 1. Sort by likes descending if either has likes
      if (likesA > 0 || likesB > 0) {
        if (likesA !== likesB) {
          return likesB - likesA; // Higher likes first
        }
      }

      // 2. Sort by uploader role: Educator (Teacher) > Admin/Superadmin > Student
      const rolePriority = (role) => {
        if (role === 'educator') return 3;
        if (role === 'admin' || role === 'superadmin') return 2;
        return 1; // Student / other
      };

      const priorityA = rolePriority(a.uploadedByRole);
      const priorityB = rolePriority(b.uploadedByRole);

      if (priorityA !== priorityB) {
        return priorityB - priorityA; // Higher priority role first
      }

      // 3. Sort by date descending (latest first)
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ message: 'Server error loading documents' });
  }
});

// @route   POST api/documents/upload
// @desc    Upload a PDF note/paper/resource (Teacher/Admin only)
router.post('/upload', isStaff, (req, res) => {
  upload.single('pdf')(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: `Multer Error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }

    // Support either direct file URL from frontend OR local file upload
    const { title, type, folderId, subject, year, fileUrl: directFileUrl, fileName: directFileName } = req.body;

    if (!req.file && !directFileUrl) {
      return res.status(400).json({ message: 'Please upload a PDF file or provide a file URL' });
    }

    if (!title || !type) {
      if (req.file) deleteLocalFile(req.file.path);
      return res.status(400).json({ message: 'Title and document type are required' });
    }

    // Validate type
    if (!['notes', 'paper', 'lab_manual', 'book', 'syllabus', 'roadmap', 'competitive'].includes(type)) {
      if (req.file) deleteLocalFile(req.file.path);
      return res.status(400).json({ message: 'Invalid document type' });
    }

    try {
      let fileUrl = '';
      let filePublicId = '';
      let fileHash = null;
      let fileBuffer = null;
      let fileSizeBytes = 0;
      let pdfQuality = { pageCount: 1, hasText: false, textLength: 0, qualityScore: 50 };

      // Read buffer if file uploaded directly
      if (req.file) {
        fileBuffer = fs.readFileSync(req.file.path);
        fileSizeBytes = fileBuffer.length;
        fileHash = computeFileHash(fileBuffer);
        pdfQuality = await inspectPdfContent(fileBuffer);
      }

      // Resolve Exam Identity
      const targetFolderId = (folderId && folderId !== 'null' && folderId !== 'general' && folderId !== 'undefined') ? folderId : null;
      const hierarchy = await resolveFolderHierarchy(targetFolderId);
      const effectiveSubject = subject || hierarchy.subjectName || title;
      const normSubject = normalizeSubject(effectiveSubject);
      const normExamType = normalizeExamType(`${title} ${type}`);
      const normYear = normalizeYear(year);
      const paperCode = extractPaperCode(`${title} ${effectiveSubject}`);

      const examIdentity = {
        normalizedSubject: normSubject,
        branch: hierarchy.branch,
        semester: hierarchy.semester,
        year: normYear,
        examType: normExamType,
        paperCode,
        identityKey: buildIdentityKey({
          normalizedSubject: normSubject,
          branch: hierarchy.branch,
          semester: hierarchy.semester,
          year: normYear,
          examType: normExamType,
          paperCode
        })
      };

      // Check for exact duplicate of approved document (applies to all document types)
      if (fileHash) {
        const approvedMatch = await Document.findOne({ fileHash, status: 'approved' }).lean();
        if (approvedMatch) {
          if (req.file) deleteLocalFile(req.file.path);
          return res.status(409).json({
            success: false,
            code: 'DUPLICATE_PUBLISHED',
            message: 'This document already exists and is published on StudyMyte.',
            existingDocument: {
              id: approvedMatch._id,
              title: approvedMatch.title,
              status: approvedMatch.status
            }
          });
        }
      }

      if (directFileUrl) {
        const validatedUrl = validateExternalUrl(directFileUrl);
        if (!validatedUrl) {
          if (req.file) deleteLocalFile(req.file.path);
          return res.status(400).json({ message: 'Invalid or restricted external file URL' });
        }
        fileUrl = validatedUrl;
        filePublicId = typeof req.body.filePublicId === 'string' ? req.body.filePublicId.trim() : '';
      } else if (req.file) {
        if (isCloudinaryConfigured) {
          // Upload to Cloudinary
          const uploadResult = await cloudinary.uploader.upload(req.file.path, {
            folder: 'studymyte',
            resource_type: 'raw',
            access_mode: 'public'
          });

          fileUrl = uploadResult.secure_url;
          filePublicId = uploadResult.public_id;
          deleteLocalFile(req.file.path); // Delete local temp file
        } else {
          // Secure server-generated storage filename
          const safeStorageName = 'doc-' + Date.now() + '-' + crypto.randomBytes(8).toString('hex') + '.pdf';
          const targetPath = path.join(UPLOADS_DIR, safeStorageName);
          fs.renameSync(req.file.path, targetPath);
          fileUrl = `/uploads/${safeStorageName}`;
        }
      }

      const safeDisplayName = sanitizeFileName(req.file ? req.file.originalname : (directFileName || 'document.pdf'));

      // Process group association for all document types
      let duplicateGroupId = null;
      let duplicateStatus = {
        isCanonical: true, // Direct staff/admin upload is approved & canonical by default
        isDuplicate: false,
        matchConfidence: 'none'
      };

      if (fileHash) {
        const dupResult = await processDuplicateDetection({
          fileHash,
          examIdentity,
          qualityScore: pdfQuality.qualityScore
        });
        if (dupResult.group) {
          duplicateGroupId = dupResult.group._id;
          if (!dupResult.group.canonicalDocumentId) {
            dupResult.group.canonicalDocumentId = null; // will be set once doc is saved
          }
        }
      }

      // Save record to MongoDB
      const newDoc = new Document({
        title,
        type,
        folderId: targetFolderId,
        subject: subject || null,
        year: year || null,
        fileUrl,
        filePublicId,
        fileName: safeDisplayName,
        fileHash,
        fileSizeBytes,
        pageCount: pdfQuality.pageCount,
        hasText: pdfQuality.hasText,
        textLength: pdfQuality.textLength,
        qualityScore: pdfQuality.qualityScore,
        examIdentity,
        duplicateStatus: {
          ...duplicateStatus,
          duplicateGroupId
        },
        uploadedBy: (req.user.role === 'admin' || req.user.role === 'superadmin')
          ? 'Admin'
          : (req.user.role === 'educator'
            ? (req.user.name.toLowerCase().startsWith('teacher') ? `${req.user.name} (Educator)` : `Teacher ${req.user.name} (Educator)`)
            : (req.user.name || 'Staff Member')),
        uploadedByUserId: req.user.id
      });
      
      await newDoc.save();

      // If group had no canonical, set this new approved doc as canonical
      if (duplicateGroupId) {
        await DuplicatePaperGroup.findByIdAndUpdate(duplicateGroupId, {
          $addToSet: { candidateDocumentIds: newDoc._id },
          $set: { canonicalDocumentId: newDoc._id, status: 'resolved' }
        });
      }

      // Automatically create an announcement
      try {
        const displayType = type === 'notes' ? 'Notes' : (type === 'paper' ? 'PYQ/Paper' : (type === 'lab_manual' ? 'Lab Manual' : (type === 'book' ? 'Book' : (type === 'roadmap' ? 'Roadmap' : (type === 'competitive' ? 'Competitive Exam PYQ' : 'Syllabus')))));
        const uploaderName = (req.user.role === 'admin' || req.user.role === 'superadmin')
          ? 'Admin'
          : (req.user.role === 'educator'
            ? (req.user.name.toLowerCase().startsWith('teacher') ? `${req.user.name} (Educator)` : `Teacher ${req.user.name} (Educator)`)
            : (req.user.name || 'Staff Member'));
        const annTitle = `New ${displayType} Uploaded`;
        const annContent = `"${title}" has been uploaded by ${uploaderName}. Click here to open and view the document.`;
        
        const announcement = new Announcement({
          title: annTitle,
          content: annContent,
          docUrl: fileUrl
        });

        await announcement.save();

        // Limit announcements to 10 max
        const count = await Announcement.countDocuments();
        if (count > 10) {
          const oldest = await Announcement.find().sort({ createdAt: 1 }).limit(count - 10);
          const idsToDelete = oldest.map(a => a._id);
          await Announcement.deleteMany({ _id: { $in: idsToDelete } });
        }
        
        // Send Firebase Push Notification
        const pushTitle = `New ${displayType} Uploaded`;
        const pushBody = `"${title}" has been uploaded by ${uploaderName}.`;
        await sendMulticastPushNotification(pushTitle, pushBody, fileUrl);
      } catch (annErr) {
        console.error('Failed to create automatic announcement:', annErr);
      }

      res.status(201).json({
        id: newDoc._id,
        title: newDoc.title,
        type: newDoc.type,
        folderId: newDoc.folderId,
        subject: newDoc.subject,
        year: newDoc.year,
        fileUrl: getAbsoluteUrl(req, newDoc.fileUrl),
        fileName: newDoc.fileName,
        uploadedBy: newDoc.uploadedBy,
        uploadedByUserId: newDoc.uploadedByUserId,
        uploadedByRole: req.user.role,
        createdAt: newDoc.createdAt
      });
    } catch (uploadErr) {
      console.error('File storage/upload error:', uploadErr);
      deleteLocalFile(req.file.path);
      res.status(500).json({ message: uploadErr.message || 'Failed to process and store file' });
    }
  });
});

// @route   GET api/documents/my-uploads
// @desc    Get all documents uploaded by the authenticated user (Educator/Admin only)
router.get('/my-uploads', isStaff, async (req, res) => {
  try {
    const documents = await Document.find({ uploadedByUserId: req.user.id }).populate('uploadedByUserId', 'role').sort({ createdAt: -1 });
    res.json(documents.map(d => {
      const isTeacher = d.uploadedByUserId && d.uploadedByUserId.role === 'educator';
      return {
        id: d._id,
        title: d.title,
        type: d.type,
        folderId: d.folderId,
        subject: d.subject,
        year: d.year,
        fileUrl: getAbsoluteUrl(req, d.fileUrl),
        fileName: d.fileName,
        uploadedBy: d.uploadedBy,
        uploadedByUserId: d.uploadedByUserId ? d.uploadedByUserId._id : null,
        isUploadedByTeacher: !!isTeacher,
        uploadedByRole: d.uploadedByUserId ? d.uploadedByUserId.role : null,
        likesCount: d.likes ? d.likes.length : 0,
        hasLiked: d.likes ? d.likes.includes(req.user.id) : false,
        createdAt: d.createdAt
      };
    }));
  } catch (err) {
    res.status(500).json({ message: 'Server error loading your documents' });
  }
});

// @route   GET api/documents/download/:id
// @desc    Download a document directly (forces attachment headers)
router.get('/download/:id', auth, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Authorization & Status verification:
    // Approved documents can be downloaded by any authenticated user.
    // Non-approved documents (pending or rejected) may only be accessed by
    // Admins/Superadmins (for review workflow) or the original contributor/uploader.
    const isStaffOrAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'superadmin');
    const isOwner = req.user && doc.uploadedByUserId && doc.uploadedByUserId.toString() === req.user.id;

    if (doc.status !== 'approved' && !isStaffOrAdmin && !isOwner) {
      return res.status(403).json({ message: 'Access denied: Document is not approved' });
    }

    const fileUrl = doc.fileUrl;
    const fileName = sanitizeFileName(doc.fileName || 'document.pdf');

    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      const validatedExternal = validateExternalUrl(fileUrl);
      if (!validatedExternal) {
        return res.status(400).json({ message: 'Restricted external document source' });
      }

      const fetchOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/pdf,application/octet-stream,*/*'
        },
        redirect: 'error'
      };
      
      let response;
      try {
        response = await fetch(validatedExternal, fetchOptions);
      } catch (fetchErr) {
        return res.status(502).json({ message: 'Server failed to connect to external PDF link' });
      }

      if (!response.ok) {
        return res.status(502).json({ message: 'External storage returned error status: ' + response.status });
      }
      
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Content-Type', response.headers.get('content-type') || 'application/pdf');
      
      try {
        if (response.body && typeof response.body.pipe === 'function') {
          return response.body.pipe(res);
        } else if (response.body) {
          const { Readable } = require('stream');
          return Readable.fromWeb(response.body).pipe(res);
        } else {
          const arrayBuffer = await response.arrayBuffer();
          return res.send(Buffer.from(arrayBuffer));
        }
      } catch (streamErr) {
        return res.status(500).json({ message: 'Stream error: ' + streamErr.message });
      }
    } else {
      // Local file resolution and boundary validation
      const safePath = resolveSafeLocalPath(fileUrl, UPLOADS_DIR);
      if (!safePath) {
        // Generic message without revealing filesystem details
        return res.status(404).json({ message: 'File not found on local disk' });
      }

      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Content-Type', 'application/pdf');
      return res.sendFile(safePath);
    }
  } catch (err) {
    console.error('Download error:', err.message);
    res.status(500).json({ message: 'Server error downloading document' });
  }
});

// @route   PUT api/documents/:id
// @desc    Update a document's metadata (Uploader or Admin only)
router.put('/:id', isStaff, async (req, res) => {
  const { title, subject, year } = req.body;
  
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    
    // Check permissions: Educators can only edit their own uploaded documents. Admins/Superadmins can edit any document.
    if (req.user.role === 'educator' && (!document.uploadedByUserId || document.uploadedByUserId.toString() !== req.user.id)) {
      return res.status(403).json({ message: 'Access denied: You can only edit documents that you uploaded' });
    }
    
    if (title) document.title = title;
    if (subject !== undefined) document.subject = subject;
    if (year !== undefined) document.year = year;
    
    await document.save();
    
    res.json({
      id: document._id,
      title: document.title,
      type: document.type,
      folderId: document.folderId,
      subject: document.subject,
      year: document.year,
      fileUrl: document.fileUrl,
      fileName: document.fileName,
      uploadedBy: document.uploadedBy,
      uploadedByUserId: document.uploadedByUserId,
      createdAt: document.createdAt
    });
  } catch (err) {
    console.error('Update document error:', err);
    res.status(500).json({ message: 'Server error updating document' });
  }
});

// @route   DELETE api/documents/:id
// @desc    Delete a document (Uploader or Admin only)
router.delete('/:id', isStaff, async (req, res) => {
  const docId = req.params.id;

  try {
    const document = await Document.findById(docId);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Check permissions: Educators can only delete their own uploaded documents. Admins/Superadmins can delete any document.
    if (req.user.role === 'educator' && (!document.uploadedByUserId || document.uploadedByUserId.toString() !== req.user.id)) {
      return res.status(403).json({ message: 'Access denied: You can only delete documents that you uploaded' });
    }

    // Delete file from Cloudinary if applicable
    if (isCloudinaryConfigured && document.filePublicId) {
      const resourceType = document.fileUrl.includes('/raw/') ? 'raw' : 'image';
      await cloudinary.uploader.destroy(document.filePublicId, { resource_type: resourceType });
    } else if (!isCloudinaryConfigured && document.fileUrl) {
      // Delete local file safely within uploads directory
      const safePath = resolveSafeLocalPath(document.fileUrl, UPLOADS_DIR);
      if (safePath) {
        deleteLocalFile(safePath);
      }
    }

    await Document.findByIdAndDelete(docId);
    res.json({ message: 'Document deleted successfully', docId });
  } catch (err) {
    console.error('Delete document error:', err);
    res.status(500).json({ message: 'Server error deleting document' });
  }
});

// @route   POST api/documents/:id/like
// @desc    Toggle user like on a document (requires auth)
router.post('/:id/like', auth, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    if (!doc.likes) {
      doc.likes = [];
    }

    const userId = req.user.id;
    const index = doc.likes.indexOf(userId);
    let liked = false;

    if (index === -1) {
      doc.likes.push(userId);
      liked = true;
    } else {
      doc.likes.splice(index, 1);
      liked = false;
    }

    await doc.save();
    res.json({ liked, likesCount: doc.likes.length });
  } catch (err) {
    console.error('Like toggle error:', err);
    res.status(500).json({ message: 'Server error toggling like' });
  }
});

// @route   POST api/documents/:id/pin
// @desc    Toggle pin on a document (Admin/Teacher only)
router.post('/:id/pin', isStaff, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    doc.isPinned = !doc.isPinned;
    await doc.save();

    res.json({ message: doc.isPinned ? 'Document pinned successfully' : 'Document unpinned successfully', isPinned: doc.isPinned });
  } catch (err) {
    console.error('Pin toggle error:', err);
    res.status(500).json({ message: 'Server error toggling pin' });
  }
});

// @route   POST api/documents/contribute
// @desc    Contribute a PDF note/paper/lab manual (any authenticated user)
router.post('/contribute', auth, (req, res) => {
  upload.single('pdf')(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: `Multer Error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }

    const { title, type, folderId, subject, year, fileUrl: directFileUrl, fileName: directFileName } = req.body;

    if (!req.file && !directFileUrl) {
      return res.status(400).json({ message: 'Please upload a PDF file or provide a file URL' });
    }

    if (!title || !type) {
      if (req.file) deleteLocalFile(req.file.path);
      return res.status(400).json({ message: 'Title and document type are required' });
    }

    // Validate type: allow all document types across all sections and folders
    const allowedTypes = ['notes', 'paper', 'lab_manual', 'book', 'syllabus', 'roadmap', 'simulation', 'competitive'];
    if (!allowedTypes.includes(type)) {
      if (req.file) deleteLocalFile(req.file.path);
      return res.status(400).json({ message: 'Invalid document type for contribution.' });
    }

    try {
      let fileUrl = '';
      let filePublicId = '';
      let fileHash = null;
      let fileBuffer = null;
      let fileSizeBytes = 0;
      let pdfQuality = { pageCount: 1, hasText: false, textLength: 0, qualityScore: 50 };

      // Read buffer if file uploaded directly
      if (req.file) {
        fileBuffer = fs.readFileSync(req.file.path);
        fileSizeBytes = fileBuffer.length;
        fileHash = computeFileHash(fileBuffer);
        pdfQuality = await inspectPdfContent(fileBuffer);
      }

      const targetFolderId = (folderId && folderId !== 'null' && folderId !== 'general' && folderId !== 'undefined') ? folderId : null;
      const hierarchy = await resolveFolderHierarchy(targetFolderId);
      const effectiveSubject = subject || hierarchy.subjectName || title;
      const normSubject = normalizeSubject(effectiveSubject);
      const normExamType = normalizeExamType(`${title} ${type}`);
      const normYear = normalizeYear(year);
      const paperCode = extractPaperCode(`${title} ${effectiveSubject}`);

      const examIdentity = {
        normalizedSubject: normSubject,
        branch: hierarchy.branch,
        semester: hierarchy.semester,
        year: normYear,
        examType: normExamType,
        paperCode,
        identityKey: buildIdentityKey({
          normalizedSubject: normSubject,
          branch: hierarchy.branch,
          semester: hierarchy.semester,
          year: normYear,
          examType: normExamType,
          paperCode
        })
      };

      // Check duplicate status for any contributed document type
      let duplicateGroupId = null;
      let duplicateStatus = {
        isCanonical: false,
        isDuplicate: false,
        matchConfidence: 'none',
        matchReason: ''
      };

      if (fileHash) {
        const dupResult = await processDuplicateDetection({
          fileHash,
          examIdentity,
          qualityScore: pdfQuality.qualityScore
        });

        // Exact match with already approved published document -> BLOCK upload
        if (dupResult.isApprovedCanonicalMatch && dupResult.existingApprovedDoc) {
          if (req.file) deleteLocalFile(req.file.path);
          return res.status(409).json({
            success: false,
            code: 'DUPLICATE_PUBLISHED',
            message: 'This document already appears to be available on StudyMyte. Please check the existing document before submitting another copy.',
            existingDocument: {
              id: dupResult.existingApprovedDoc.id,
              title: dupResult.existingApprovedDoc.title,
              status: dupResult.existingApprovedDoc.status,
              year: dupResult.existingApprovedDoc.year,
              subject: dupResult.existingApprovedDoc.subject
            }
          });
        }

        if (dupResult.group) {
          duplicateGroupId = dupResult.group._id;
          duplicateStatus.matchConfidence = dupResult.matchConfidence;
          duplicateStatus.matchReason = dupResult.matchReason;
        }
      }

      if (directFileUrl) {
        const validatedUrl = validateExternalUrl(directFileUrl);
        if (!validatedUrl) {
          if (req.file) deleteLocalFile(req.file.path);
          return res.status(400).json({ message: 'Invalid or restricted external file URL' });
        }
        fileUrl = validatedUrl;
        filePublicId = typeof req.body.filePublicId === 'string' ? req.body.filePublicId.trim() : '';
      } else if (req.file) {
        if (isCloudinaryConfigured) {
          // Upload to Cloudinary
          const uploadResult = await cloudinary.uploader.upload(req.file.path, {
            folder: 'studymyte',
            resource_type: 'raw',
            access_mode: 'public'
          });

          fileUrl = uploadResult.secure_url;
          filePublicId = uploadResult.public_id;
          deleteLocalFile(req.file.path); // Delete local temp file
        } else {
          // Secure server-generated storage filename
          const safeStorageName = 'doc-' + Date.now() + '-' + crypto.randomBytes(8).toString('hex') + '.pdf';
          const targetPath = path.join(UPLOADS_DIR, safeStorageName);
          fs.renameSync(req.file.path, targetPath);
          fileUrl = `/uploads/${safeStorageName}`;
        }
      }

      const safeDisplayName = sanitizeFileName(req.file ? req.file.originalname : (directFileName || 'document.pdf'));

      // Save record to MongoDB as pending
      const newDoc = new Document({
        title,
        type,
        folderId: targetFolderId,
        subject: subject || null,
        year: year || null,
        fileUrl,
        filePublicId,
        fileName: safeDisplayName,
        fileHash,
        fileSizeBytes,
        pageCount: pdfQuality.pageCount,
        hasText: pdfQuality.hasText,
        textLength: pdfQuality.textLength,
        qualityScore: pdfQuality.qualityScore,
        examIdentity,
        duplicateStatus: {
          ...duplicateStatus,
          duplicateGroupId
        },
        uploadedBy: req.user.name || 'Student Contributor',
        uploadedByUserId: req.user.id,
        status: 'pending'
      });
      
      await newDoc.save();

      // Add to duplicate paper group candidate list
      if (duplicateGroupId) {
        await DuplicatePaperGroup.findByIdAndUpdate(duplicateGroupId, {
          $addToSet: { candidateDocumentIds: newDoc._id },
          $set: { updatedAt: new Date() }
        });
      }

      res.status(201).json({
        message: 'Contribution uploaded successfully and is pending admin approval.',
        id: newDoc._id,
        title: newDoc.title,
        status: newDoc.status
      });
    } catch (uploadErr) {
      console.error('Contribution file storage/upload error:', uploadErr);
      if (req.file) deleteLocalFile(req.file.path);
      res.status(500).json({ message: uploadErr.message || 'Failed to process and store file' });
    }
  });
});

// @route   GET api/documents/pending
// @desc    Get all pending contributions (Admin only)
router.get('/pending', isAdmin, async (req, res) => {
  try {
    const documents = await Document.find({ status: 'pending' })
      .populate('uploadedByUserId', 'name phone role')
      .sort({ createdAt: -1 });

    res.json(documents.map(d => ({
      id: d._id,
      title: d.title,
      type: d.type,
      folderId: d.folderId,
      subject: d.subject,
      year: d.year,
      fileUrl: getAbsoluteUrl(req, d.fileUrl),
      fileName: d.fileName,
      fileHash: d.fileHash || null,
      fileSizeBytes: d.fileSizeBytes || 0,
      pageCount: d.pageCount || 1,
      hasText: !!d.hasText,
      qualityScore: typeof d.qualityScore === 'number' ? d.qualityScore : null,
      examIdentity: d.examIdentity || null,
      duplicateStatus: d.duplicateStatus || null,
      uploadedBy: d.uploadedBy,
      uploadedByUserId: d.uploadedByUserId ? d.uploadedByUserId._id : null,
      contributorName: d.uploadedByUserId ? d.uploadedByUserId.name : d.uploadedBy,
      contributorPhone: d.uploadedByUserId ? d.uploadedByUserId.phone : 'N/A',
      createdAt: d.createdAt
    })));
  } catch (err) {
    console.error('Fetch pending documents error:', err);
    res.status(500).json({ message: 'Server error loading pending documents' });
  }
});

// @route   POST api/documents/approve/:id
// @desc    Approve a pending document (Admin only)
router.post('/approve/:id', isAdmin, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    if (doc.status !== 'pending') {
      return res.status(400).json({ message: 'Document is not pending approval' });
    }

    doc.status = 'approved';
    await doc.save();

    // Create a Notification for the contributor
    if (doc.uploadedByUserId) {
      const successMessage = `Dear User, \nYour File "${doc.title}" was Accepted by the admins and it is listed on the Platform.\nthank you for your Contribution`;
      
      const newNotification = new Notification({
        recipientId: doc.uploadedByUserId,
        message: successMessage,
        rawMessage: successMessage
      });
      await newNotification.save();
    }

    // Automatically create a public Announcement
    try {
      const displayType = doc.type === 'notes' ? 'Notes' : (doc.type === 'paper' ? 'PYQ/Paper' : (doc.type === 'lab_manual' ? 'Lab Manual' : (doc.type === 'book' ? 'Book' : (doc.type === 'roadmap' ? 'Roadmap' : (doc.type === 'competitive' ? 'Competitive Exam PYQ' : 'Syllabus')))));
      const annTitle = `New ${displayType} Uploaded`;
      const annContent = `"${doc.title}" has been uploaded by ${doc.uploadedBy}. Click here to open and view the document.`;
      
      const announcement = new Announcement({
        title: annTitle,
        content: annContent,
        docUrl: doc.fileUrl
      });
      await announcement.save();

      // Limit announcements to 10 max
      const count = await Announcement.countDocuments();
      if (count > 10) {
        const oldest = await Announcement.find().sort({ createdAt: 1 }).limit(count - 10);
        const idsToDelete = oldest.map(a => a._id);
        await Announcement.deleteMany({ _id: { $in: idsToDelete } });
      }

      // Send Firebase Push Notification
      const pushTitle = `New ${displayType} Uploaded`;
      const pushBody = `"${doc.title}" has been uploaded by ${doc.uploadedBy}.`;
      await sendMulticastPushNotification(pushTitle, pushBody, doc.fileUrl);
    } catch (annErr) {
      console.error('Failed to create automatic announcement on approval:', annErr);
    }

    res.json({ message: 'Document approved successfully', docId: doc._id });
  } catch (err) {
    console.error('Approve document error:', err);
    res.status(500).json({ message: 'Server error approving document' });
  }
});

// @route   POST api/documents/reject/:id
// @desc    Reject and delete a pending document (Admin only)
router.post('/reject/:id', isAdmin, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Delete file from Cloudinary/filesystem
    if (isCloudinaryConfigured && doc.filePublicId) {
      const resourceType = doc.fileUrl.includes('/raw/') ? 'raw' : 'image';
      await cloudinary.uploader.destroy(doc.filePublicId, { resource_type: resourceType });
    } else if (!isCloudinaryConfigured && doc.fileUrl) {
      const safePath = resolveSafeLocalPath(doc.fileUrl, UPLOADS_DIR);
      if (safePath) {
        deleteLocalFile(safePath);
      }
    }

    // Create a Notification for the contributor BEFORE deleting the document record
    if (doc.uploadedByUserId) {
      const rejectMessage = `Dear User,\nYour file "${doc.title}" was Rejected by the admins.\nPlease check the file and retry.`;
      
      const newNotification = new Notification({
        recipientId: doc.uploadedByUserId,
        message: rejectMessage,
        rawMessage: rejectMessage
      });
      await newNotification.save();
    }

    // Delete document record
    await Document.findByIdAndDelete(req.params.id);

    res.json({ message: 'Document rejected and deleted successfully', docId: req.params.id });
  } catch (err) {
    console.error('Reject document error:', err);
    res.status(500).json({ message: 'Server error rejecting document' });
  }
});

// @route   GET api/documents/my-contributions
// @desc    Get all documents contributed by the authenticated user
router.get('/my-contributions', auth, async (req, res) => {
  try {
    const documents = await Document.find({ uploadedByUserId: req.user.id }).sort({ createdAt: -1 });
    res.json(documents.map(d => ({
      id: d._id,
      title: d.title,
      type: d.type,
      folderId: d.folderId,
      subject: d.subject,
      year: d.year,
      fileUrl: getAbsoluteUrl(req, d.fileUrl),
      fileName: d.fileName,
      uploadedBy: d.uploadedBy,
      uploadedByUserId: d.uploadedByUserId,
      status: d.status || 'approved',
      likesCount: d.likes ? d.likes.length : 0,
      createdAt: d.createdAt
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error loading your contributions' });
  }
});

// @route   PUT api/documents/:id/move
// @desc    Move/shift document to a different section and folder (Admin only)
router.put('/:id/move', isAdmin, async (req, res) => {
  const { targetType, targetFolderId } = req.body;

  if (!targetType) {
    return res.status(400).json({ message: 'Target section type is required' });
  }

  const validTypes = ['notes', 'paper', 'lab_manual', 'book', 'syllabus', 'roadmap', 'competitive'];
  if (!validTypes.includes(targetType)) {
    return res.status(400).json({ message: 'Invalid target section type' });
  }

  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    if (targetType === 'syllabus') {
      doc.folderId = null;
      doc.type = 'syllabus';
    } else {
      if (!targetFolderId) {
        return res.status(400).json({ message: 'Target folder ID is required for this section' });
      }
      const { Folder } = require('../db/models');
      const folder = await Folder.findById(targetFolderId);
      if (!folder) {
        return res.status(404).json({ message: 'Target folder not found' });
      }

      // Validate mapping folder type to document type
      let mappedType = '';
      if (folder.type === 'notes') mappedType = 'notes';
      else if (folder.type === 'papers') mappedType = 'paper';
      else if (folder.type === 'lab_manuals') mappedType = 'lab_manual';
      else if (folder.type === 'books') mappedType = 'book';
      else if (folder.type === 'roadmaps') mappedType = 'roadmap';
      else if (folder.type === 'competitive') mappedType = 'competitive';
      else {
        return res.status(400).json({ message: 'Target folder type is invalid' });
      }

      // Ensure target folder type matches targetType
      if (mappedType !== targetType) {
        return res.status(400).json({ message: 'Target folder section type mismatch' });
      }

      doc.folderId = targetFolderId;
      doc.type = targetType;
    }

    await doc.save();
    res.json({ message: 'Document moved successfully', document: doc });
  } catch (err) {
    console.error('Error moving document:', err);
    res.status(500).json({ message: 'Server error while moving document' });
  }
});

// ============================================================================
// DUPLICATE PAPER REVIEW & GROUPED APPROVAL ENDPOINTS (Admin Only)
// ============================================================================

// @route   GET api/documents/duplicate-groups
// @desc    List all duplicate paper groups with filters and candidate counts
router.get('/duplicate-groups', isAdmin, async (req, res) => {
  try {
    const { status, subject, year, examType, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status && ['needs_review', 'resolved', 'dismissed'].includes(status)) {
      filter.status = status;
    }
    if (subject) {
      filter.subject = new RegExp(subject.trim(), 'i');
    }
    if (year) {
      filter.year = year.trim();
    }
    if (examType && examType !== 'all') {
      filter.examType = examType.trim();
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const totalGroups = await DuplicatePaperGroup.countDocuments(filter);
    const groups = await DuplicatePaperGroup.find(filter)
      .populate('canonicalDocumentId', 'title fileUrl fileName status uploadedBy createdAt')
      .populate('resolvedBy', 'name role')
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Fetch candidate documents for each group
    const enriched = await Promise.all(groups.map(async (g) => {
      const candidates = await Document.find({
        $or: [
          { 'duplicateStatus.duplicateGroupId': g._id },
          { _id: { $in: g.candidateDocumentIds || [] } }
        ]
      })
        .populate('uploadedByUserId', 'name phone role')
        .sort({ qualityScore: -1, createdAt: -1 })
        .lean();

      const exactCount = candidates.filter(c => c.duplicateStatus && c.duplicateStatus.matchConfidence === 'exact').length;
      const probableCount = candidates.filter(c => c.duplicateStatus && c.duplicateStatus.matchConfidence === 'strong').length;

      return {
        id: g._id,
        identityKey: g.identityKey,
        subject: g.subject,
        branch: g.branch,
        semester: g.semester,
        year: g.year,
        examType: g.examType,
        paperCode: g.paperCode,
        status: g.status,
        resolutionReason: g.resolutionReason,
        resolvedBy: g.resolvedBy ? g.resolvedBy.name : null,
        resolvedAt: g.resolvedAt,
        canonicalDocument: g.canonicalDocumentId ? {
          id: g.canonicalDocumentId._id,
          title: g.canonicalDocumentId.title,
          fileUrl: getAbsoluteUrl(req, g.canonicalDocumentId.fileUrl),
          status: g.canonicalDocumentId.status,
          uploadedBy: g.canonicalDocumentId.uploadedBy
        } : null,
        candidateCount: candidates.length,
        exactDuplicatesCount: exactCount,
        probableDuplicatesCount: probableCount,
        candidates: candidates.map(c => ({
          id: c._id,
          title: c.title,
          fileUrl: getAbsoluteUrl(req, c.fileUrl),
          fileName: c.fileName,
          fileSizeBytes: c.fileSizeBytes || 0,
          pageCount: c.pageCount || 1,
          hasText: c.hasText || false,
          textLength: c.textLength || 0,
          qualityScore: c.qualityScore || 0,
          status: c.status,
          isCanonical: !!(c.duplicateStatus && c.duplicateStatus.isCanonical),
          isDuplicate: !!(c.duplicateStatus && c.duplicateStatus.isDuplicate),
          matchConfidence: c.duplicateStatus ? c.duplicateStatus.matchConfidence : 'none',
          matchReason: c.duplicateStatus ? c.duplicateStatus.matchReason : '',
          uploadedBy: c.uploadedBy,
          contributorName: c.uploadedByUserId ? c.uploadedByUserId.name : c.uploadedBy,
          contributorPhone: c.uploadedByUserId ? c.uploadedByUserId.phone : 'N/A',
          createdAt: c.createdAt
        }))
      };
    }));

    res.json({
      success: true,
      totalGroups,
      page: parseInt(page),
      totalPages: Math.ceil(totalGroups / parseInt(limit)),
      groups: enriched
    });
  } catch (err) {
    console.error('Error fetching duplicate groups:', err);
    res.status(500).json({ success: false, message: 'Server error loading duplicate groups' });
  }
});

// @route   POST api/documents/duplicate-groups/:groupId/select-canonical
// @desc    Atomically approve chosen canonical paper & mark others as duplicates
router.post('/duplicate-groups/:groupId/select-canonical', isAdmin, async (req, res) => {
  const canonicalDocId = req.body.canonicalDocId || req.body.canonicalDocumentId;
  const reason = req.body.reason;
  const { groupId } = req.params;

  if (!canonicalDocId) {
    return res.status(400).json({ success: false, message: 'Canonical document ID is required' });
  }

  try {
    const group = await DuplicatePaperGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: 'Duplicate group not found' });
    }

    const canonicalDoc = await Document.findById(canonicalDocId);
    if (!canonicalDoc) {
      return res.status(404).json({ success: false, message: 'Selected document not found' });
    }

    // Verify document belongs to group
    const isCandidate = (canonicalDoc.duplicateStatus?.duplicateGroupId?.toString() === groupId) ||
      (group.candidateDocumentIds && group.candidateDocumentIds.some(id => id.toString() === canonicalDocId)) ||
      (canonicalDoc.examIdentity?.identityKey === group.identityKey);

    if (!isCandidate) {
      return res.status(400).json({ success: false, message: 'Selected document does not belong to this duplicate group' });
    }

    // 1. Approve & mark winner as canonical
    canonicalDoc.status = 'approved';
    canonicalDoc.duplicateStatus = {
      ...canonicalDoc.duplicateStatus,
      isCanonical: true,
      isDuplicate: false,
      canonicalDocumentId: null,
      duplicateGroupId: group._id,
      reviewedBy: req.user.id,
      reviewedAt: new Date()
    };
    await canonicalDoc.save();

    // 2. Fetch all other candidate documents in group
    const otherCandidates = await Document.find({
      $or: [
        { 'duplicateStatus.duplicateGroupId': group._id },
        { _id: { $in: group.candidateDocumentIds || [] } },
        { 'examIdentity.identityKey': group.identityKey }
      ],
      _id: { $ne: canonicalDoc._id }
    });

    // 3. Mark others as duplicates linked to the canonical paper
    for (const otherDoc of otherCandidates) {
      // Never delete uploader attribution; mark as duplicate of winner
      otherDoc.duplicateStatus = {
        ...otherDoc.duplicateStatus,
        isCanonical: false,
        isDuplicate: true,
        canonicalDocumentId: canonicalDoc._id,
        duplicateGroupId: group._id,
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
        matchReason: reason || 'Marked as duplicate of selected canonical paper by administrator'
      };

      // If pending, mark rejected with duplicate status (so it is not published publicly)
      if (otherDoc.status === 'pending') {
        otherDoc.status = 'rejected';
      }
      await otherDoc.save();

      // Send educational notification to uploader
      if (otherDoc.uploadedByUserId) {
        const notifMsg = `Dear User,\nThank you for contributing "${otherDoc.title}". Another high-quality copy of this question paper was selected as canonical on StudyMyte. Your submission has been archived in our records with attribution.`;
        const notif = new Notification({
          recipientId: otherDoc.uploadedByUserId,
          message: notifMsg,
          rawMessage: notifMsg
        });
        await notif.save();
      }
    }

    // 4. Update group status
    group.canonicalDocumentId = canonicalDoc._id;
    group.status = 'resolved';
    group.resolvedBy = req.user.id;
    group.resolvedAt = new Date();
    group.resolutionReason = reason || 'Canonical paper selected by administrator';
    group.updatedAt = new Date();
    await group.save();

    // Create public announcement for newly approved paper
    try {
      const annTitle = `New Question Paper Published`;
      const annContent = `"${canonicalDoc.title}" has been published. Click here to open and view the verified paper.`;
      const announcement = new Announcement({
        title: annTitle,
        content: annContent,
        docUrl: canonicalDoc.fileUrl
      });
      await announcement.save();
    } catch (annErr) {
      console.warn('Failed to dispatch announcement:', annErr.message);
    }

    res.json({
      success: true,
      message: 'Canonical paper selected and published successfully. Other candidate submissions marked as duplicates.',
      groupId: group._id,
      canonicalDocumentId: canonicalDoc._id
    });
  } catch (err) {
    console.error('Error selecting canonical paper:', err);
    res.status(500).json({ success: false, message: 'Server error while resolving duplicate group' });
  }
});

// @route   POST api/documents/duplicate-groups/:groupId/split-candidate/:docId
// @desc    Separate a misgrouped paper candidate into its own independent record
router.post('/duplicate-groups/:groupId/split-candidate/:docId', isAdmin, async (req, res) => {
  const { groupId, docId } = req.params;

  try {
    const doc = await Document.findById(docId);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    // Detach from group
    doc.duplicateStatus = {
      isCanonical: false,
      isDuplicate: false,
      canonicalDocumentId: null,
      duplicateGroupId: null,
      matchConfidence: 'none',
      matchReason: 'Detached from duplicate group by administrator'
    };
    await doc.save();

    // Remove from group's candidate array
    await DuplicatePaperGroup.findByIdAndUpdate(groupId, {
      $pull: { candidateDocumentIds: doc._id },
      $set: { updatedAt: new Date() }
    });

    res.json({
      success: true,
      message: 'Document separated successfully and retained as an independent paper.',
      docId
    });
  } catch (err) {
    console.error('Error splitting candidate from group:', err);
    res.status(500).json({ success: false, message: 'Server error splitting candidate' });
  }
});

module.exports = router;
module.exports.resolveSafeLocalPath = resolveSafeLocalPath;
module.exports.sanitizeFileName = sanitizeFileName;
module.exports.validateExternalUrl = validateExternalUrl;
module.exports.deleteLocalFile = deleteLocalFile;

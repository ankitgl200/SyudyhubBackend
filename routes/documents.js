const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { Document, Announcement, Notification } = require('../db/models');
const config = require('../config');
const { auth, isStaff, isAdmin } = require('../middleware/auth');

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

// Configure Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, TEMP_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'doc-' + uniqueSuffix + path.extname(file.originalname));
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
  limits: { fileSize: 20 * 1024 * 1024 } // 10 MB Max
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

// Helper to delete local file safely
function deleteLocalFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('Error deleting file:', filePath, err.message);
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

      if (directFileUrl) {
        fileUrl = directFileUrl;
        filePublicId = req.body.filePublicId || '';
      } else if (isCloudinaryConfigured) {
        // Upload to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
          folder: 'studyhub',
          resource_type: 'raw',
          access_mode: 'public'
        });

        fileUrl = uploadResult.secure_url;
        filePublicId = uploadResult.public_id;
        deleteLocalFile(req.file.path); // Delete local temp file
      } else {
        // Move temp file to public/uploads
        const targetPath = path.join(UPLOADS_DIR, req.file.filename);
        fs.renameSync(req.file.path, targetPath);
        fileUrl = `/uploads/${req.file.filename}`;
      }

      // Save record to MongoDB
      const newDoc = new Document({
        title,
        type,
        folderId: folderId && folderId !== 'null' ? folderId : null,
        subject: subject || null,
        year: year || null,
        fileUrl,
        filePublicId,
        fileName: req.file ? req.file.originalname : (directFileName || 'document.pdf'),
        uploadedBy: (req.user.role === 'admin' || req.user.role === 'superadmin')
          ? 'Admin'
          : (req.user.role === 'educator'
            ? (req.user.name.toLowerCase().startsWith('teacher') ? `${req.user.name} (Educator)` : `Teacher ${req.user.name} (Educator)`)
            : (req.user.name || 'Staff Member')),
        uploadedByUserId: req.user.id
      });
      
      await newDoc.save();

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

    const fileUrl = doc.fileUrl;
    const fileName = doc.fileName || 'document.pdf';

    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      // Cloudinary URL or external URL
      // Stream the file to force direct download
      const response = await fetch(fileUrl);
      if (!response.ok) {
        return res.status(500).json({ message: 'Failed to retrieve file from storage provider' });
      }
      
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', response.headers.get('content-type') || 'application/pdf');
      
      const arrayBuffer = await response.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    } else {
      // Local file
      const filePath = path.join(UPLOADS_DIR, fileUrl.replace('/uploads/', ''));
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: 'File not found on local disk' });
      }
      return res.download(filePath, fileName);
    }
  } catch (err) {
    console.error('Download error:', err);
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
    } else if (!isCloudinaryConfigured && document.fileUrl.startsWith('/uploads/')) {
      // Delete local file
      const fileName = path.basename(document.fileUrl);
      const filePath = path.join(UPLOADS_DIR, fileName);
      deleteLocalFile(filePath);
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

    // Validate type: notes, paper, lab_manual (not for books and roadmaps)
    if (!['notes', 'paper', 'lab_manual'].includes(type)) {
      if (req.file) deleteLocalFile(req.file.path);
      return res.status(400).json({ message: 'Invalid document type for contribution. Only notes, papers, and lab manuals are allowed.' });
    }

    try {
      let fileUrl = '';
      let filePublicId = '';

      if (directFileUrl) {
        fileUrl = directFileUrl;
        filePublicId = req.body.filePublicId || '';
      } else if (isCloudinaryConfigured) {
        // Upload to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
          folder: 'studyhub',
          resource_type: 'raw',
          access_mode: 'public'
        });

        fileUrl = uploadResult.secure_url;
        filePublicId = uploadResult.public_id;
        deleteLocalFile(req.file.path); // Delete local temp file
      } else {
        // Move temp file to public/uploads
        const targetPath = path.join(UPLOADS_DIR, req.file.filename);
        fs.renameSync(req.file.path, targetPath);
        fileUrl = `/uploads/${req.file.filename}`;
      }

      // Save record to MongoDB as pending
      const newDoc = new Document({
        title,
        type,
        folderId: folderId && folderId !== 'null' ? folderId : null,
        subject: subject || null,
        year: year || null,
        fileUrl,
        filePublicId,
        fileName: req.file ? req.file.originalname : (directFileName || 'document.pdf'),
        uploadedBy: req.user.name || 'Student Contributor',
        uploadedByUserId: req.user.id,
        status: 'pending'
      });
      
      await newDoc.save();

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
    } else if (!isCloudinaryConfigured && doc.fileUrl.startsWith('/uploads/')) {
      const fileName = path.basename(doc.fileUrl);
      const filePath = path.join(UPLOADS_DIR, fileName);
      deleteLocalFile(filePath);
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
    res.json({ message: 'Document successfully moved', document: doc });
  } catch (err) {
    console.error('Move document error:', err);
    res.status(500).json({ message: 'Server error moving document' });
  }
});

module.exports = router;

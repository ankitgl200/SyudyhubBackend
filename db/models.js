const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// User Schema
const UserSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    required: true,
    enum: ['student', 'educator', 'admin', 'superadmin'],
    default: 'student'
  },
  approved: {
    type: Boolean,
    required: true,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: null
  },
  lastActive: {
    type: Date,
    default: null
  },
  deviceInfo: {
    browser: { type: String, default: 'Unknown' },
    os: { type: String, default: 'Unknown' },
    deviceType: { type: String, default: 'Unknown' },
    deviceModel: { type: String, default: 'Unknown' },
    ip: { type: String, default: 'Unknown' }
  }
});

// Folder Schema
const FolderSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: ['notes', 'papers', 'lab_manuals', 'books', 'roadmaps', 'competitive']
  },
  parentId: {
    type: Schema.Types.ObjectId,
    ref: 'Folder',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Document Schema
const DocumentSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: ['notes', 'paper', 'lab_manual', 'book', 'syllabus', 'roadmap', 'competitive']
  },
  folderId: {
    type: Schema.Types.ObjectId,
    ref: 'Folder',
    default: null
  },
  subject: {
    type: String,
    trim: true
  },
  year: {
    type: String,
    trim: true
  },
  fileUrl: {
    type: String,
    required: true
  },
  filePublicId: {
    type: String,
    default: ''
  },
  fileName: {
    type: String,
    trim: true
  },
  uploadedBy: {
    type: String,
    trim: true
  },
  uploadedByUserId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  likes: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: []
  }],
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'approved'
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Announcement Schema
const AnnouncementSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  docUrl: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Help & Support Request Schema
const HelpRequestSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  role: {
    type: String,
    required: true
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'resolved'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const User = mongoose.model('User', UserSchema);
const Folder = mongoose.model('Folder', FolderSchema);
const Document = mongoose.model('Document', DocumentSchema);
const Announcement = mongoose.model('Announcement', AnnouncementSchema);
const HelpRequest = mongoose.model('HelpRequest', HelpRequestSchema);

// Notification Schema
const NotificationSchema = new Schema({
  recipientId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  message: {
    type: String,
    required: true
  },
  rawMessage: {
    type: String,
    default: ''
  },
  read: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Notification = mongoose.model('Notification', NotificationSchema);

// Message Template Schema
const MessageTemplateSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const MessageTemplate = mongoose.model('MessageTemplate', MessageTemplateSchema);

// Review Schema
const ReviewSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    trim: true,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Review = mongoose.model('Review', ReviewSchema);

module.exports = {
  User,
  Folder,
  Document,
  Announcement,
  HelpRequest,
  Notification,
  MessageTemplate,
  Review
};

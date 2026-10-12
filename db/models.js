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
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: null
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
  },
  fcmTokens: {
    type: [String],
    default: []
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
    enum: ['notes', 'papers', 'lab_manuals', 'books', 'roadmaps', 'simulations', 'competitive']
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
    enum: ['notes', 'paper', 'lab_manual', 'book', 'syllabus', 'roadmap', 'simulation', 'competitive']
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
  // --- Smart Duplicate Paper Detection Fields ---
  fileHash: {
    type: String,
    trim: true,
    index: true,
    default: null
  },
  fileSizeBytes: {
    type: Number,
    default: 0
  },
  pageCount: {
    type: Number,
    default: null
  },
  hasText: {
    type: Boolean,
    default: false
  },
  textLength: {
    type: Number,
    default: 0
  },
  qualityScore: {
    type: Number,
    default: null
  },
  examIdentity: {
    normalizedSubject: { type: String, trim: true, default: null },
    branch: { type: String, trim: true, default: null },
    semester: { type: String, trim: true, default: null },
    year: { type: String, trim: true, default: null },
    examType: { type: String, trim: true, default: 'unknown' },
    paperCode: { type: String, trim: true, default: null },
    identityKey: { type: String, trim: true, index: true, default: null }
  },
  duplicateStatus: {
    isCanonical: { type: Boolean, default: false, index: true },
    isDuplicate: { type: Boolean, default: false, index: true },
    canonicalDocumentId: { type: Schema.Types.ObjectId, ref: 'Document', default: null },
    duplicateGroupId: { type: Schema.Types.ObjectId, ref: 'DuplicatePaperGroup', index: true, default: null },
    matchConfidence: { type: String, enum: ['exact', 'strong', 'possible', 'none'], default: 'none' },
    matchReason: { type: String, trim: true, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for high performance duplicate queries
DocumentSchema.index({ fileHash: 1, status: 1 });
DocumentSchema.index({ 'examIdentity.identityKey': 1, status: 1 });

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
  requestedEmail: {
    type: String,
    default: null,
    trim: true,
    lowercase: true
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
    ref: 'User'
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

// Server-Authoritative OTP Verification Schema
const OtpVerificationSchema = new Schema({
  verificationId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  phone: {
    type: String,
    required: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  purpose: {
    type: String,
    enum: ['password_reset', 'email_verification', 'phone_verification'],
    default: 'password_reset',
    required: true
  },
  otpHash: {
    type: String,
    required: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 5
  },
  used: {
    type: Boolean,
    default: false,
    index: true
  },
  revoked: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  lastSentAt: {
    type: Date,
    default: Date.now
  },
  resendCount: {
    type: Number,
    default: 0
  },
  maxResends: {
    type: Number,
    default: 3
  },
  clientIp: {
    type: String,
    default: 'Unknown'
  },
  userAgent: {
    type: String,
    default: 'Unknown'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 900 // MongoDB TTL 15 minutes to purge completed/expired sessions
  }
});

const OtpVerification = mongoose.model('OtpVerification', OtpVerificationSchema);
const PasswordResetOtp = OtpVerification; // Alias if referenced as PasswordResetOtp

// Duplicate Paper Group Schema (for Grouped Admin Review)
const DuplicatePaperGroupSchema = new Schema({
  identityKey: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  subject: { type: String, trim: true, default: 'General Paper' },
  branch: { type: String, trim: true, default: 'All Branches' },
  semester: { type: String, trim: true, default: null },
  year: { type: String, trim: true, default: null },
  examType: { type: String, trim: true, default: 'unknown' },
  paperCode: { type: String, trim: true, default: null },
  status: {
    type: String,
    enum: ['needs_review', 'resolved', 'dismissed'],
    default: 'needs_review',
    index: true
  },
  canonicalDocumentId: {
    type: Schema.Types.ObjectId,
    ref: 'Document',
    default: null
  },
  resolvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  resolvedAt: {
    type: Date,
    default: null
  },
  resolutionReason: {
    type: String,
    trim: true,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

DuplicatePaperGroupSchema.index({ status: 1, createdAt: -1 });

const DuplicatePaperGroup = mongoose.model('DuplicatePaperGroup', DuplicatePaperGroupSchema);

module.exports = {
  User,
  Folder,
  Document,
  Announcement,
  HelpRequest,
  Notification,
  MessageTemplate,
  Review,
  OtpVerification,
  PasswordResetOtp,
  DuplicatePaperGroup
};

// Team Member Schema
const TeamMemberSchema = new Schema({
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, trim: true },
  bio: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  order: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const TeamMember = mongoose.model('TeamMember', TeamMemberSchema);

const SystemSettingSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true }
});
const SystemSetting = mongoose.model('SystemSetting', SystemSettingSchema);

module.exports.TeamMember = TeamMember;
module.exports.SystemSetting = SystemSetting;

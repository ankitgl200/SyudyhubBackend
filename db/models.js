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
  },
  agreedToTerms: {
    type: Boolean,
    default: true
  },
  termsAgreedAt: {
    type: Date,
    default: Date.now
  },
  isBlocked: {
    type: Boolean,
    default: false,
    index: true
  },
  securityStrikes: {
    type: Number,
    default: 0
  },
  banCount: {
    type: Number,
    default: 0
  },
  currentBanExpiresAt: {
    type: Date,
    default: null
  },
  blockedReason: {
    type: String,
    default: ''
  },
  blockedAt: {
    type: Date,
    default: null
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
  // --- RAG Vector Search Indexing Fields ---
  isRagIndexed: {
    type: Boolean,
    default: false,
    index: true
  },
  ragIndexedAt: {
    type: Date,
    default: null
  },
  chunkCount: {
    type: Number,
    default: 0
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
  verifiedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 900 // MongoDB TTL 15 minutes to purge completed/expired sessions
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

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

// Permanent EmailJS Dispatch Log (Audited Monthly Usage)
const EmailDispatchLogSchema = new Schema({
  purpose: { type: String, default: 'otp' },
  recipientMasked: { type: String, default: '' },
  serviceId: { type: String, default: '' },
  templateId: { type: String, default: '' },
  status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
  sentAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });
const EmailDispatchLog = mongoose.model('EmailDispatchLog', EmailDispatchLogSchema);

module.exports.TeamMember = TeamMember;
module.exports.SystemSetting = SystemSetting;
module.exports.EmailDispatchLog = EmailDispatchLog;

// ==========================================
// MYTEE — Intelligent Assistant Schema Suite
// ==========================================

// MYTEE Conversation Session Schema
const MyteeConversationSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  role: {
    type: String,
    enum: ['student', 'educator', 'admin', 'superadmin', 'guest'],
    default: 'guest'
  },
  personalityMode: {
    type: String,
    enum: ['normal', 'sigma', 'roast', 'beast'],
    default: 'normal'
  },
  messages: [{
    role: { type: String, enum: ['user', 'model', 'system', 'assistant'], required: true },
    content: { type: String, required: true },
    actions: { type: Schema.Types.Mixed, default: [] },
    resources: { type: Schema.Types.Mixed, default: [] },
    ticket: { type: Schema.Types.Mixed, default: null },
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 30 // Retention: 30 days automatic cleanup
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});
MyteeConversationSchema.index({ sessionId: 1, updatedAt: -1 });

// MYTEE User Feedback Schema
const MyteeFeedbackSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  sessionId: {
    type: String,
    default: null
  },
  rating: {
    type: String,
    enum: ['helpful', 'unhelpful'],
    required: true
  },
  comment: {
    type: String,
    trim: true,
    default: ''
  },
  query: {
    type: String,
    trim: true,
    default: ''
  },
  responseSnippet: {
    type: String,
    trim: true,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// MYTEE Usage & Performance Metrics Log
const MyteeUsageLogSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  role: {
    type: String,
    default: 'guest'
  },
  sessionId: {
    type: String,
    default: null
  },
  clientIp: {
    type: String,
    default: 'Unknown'
  },
  endpoint: {
    type: String,
    default: '/api/mytee/chat'
  },
  query: {
    type: String,
    default: ''
  },
  intent: {
    type: String,
    default: 'general'
  },
  toolsUsed: {
    type: [String],
    default: []
  },
  scopePassed: {
    type: Boolean,
    default: true
  },
  success: {
    type: Boolean,
    default: true
  },
  responseTimeMs: {
    type: Number,
    default: 0
  },
  estimatedTokens: {
    type: Number,
    default: 0
  },
  modelUsed: {
    type: String,
    default: 'gemini-1.5-flash'
  },
  errorMessage: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
    expires: 60 * 60 * 24 * 90 // 90 days retention
  }
});
MyteeUsageLogSchema.index({ createdAt: -1 });

// MYTEE Administrative & Security Audit Log
const MyteeAuditLogSchema = new Schema({
  adminUserId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  adminName: {
    type: String,
    required: true
  },
  action: {
    type: String,
    required: true,
    index: true
  },
  target: {
    type: String,
    default: ''
  },
  details: {
    type: Schema.Types.Mixed,
    default: {}
  },
  ip: {
    type: String,
    default: 'Unknown'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});
MyteeAuditLogSchema.index({ createdAt: -1 });

// ==========================================
// RAG Vector Document Chunk Schema
// ==========================================
const DocumentChunkSchema = new Schema({
  documentId: {
    type: Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
    index: true
  },
  chunkIndex: {
    type: Number,
    required: true
  },
  text: {
    type: String,
    required: true
  },
  embedding: {
    type: [Number],
    required: true,
    default: []
  },
  metadata: {
    title: { type: String, default: '', index: true },
    subject: { type: String, default: '', index: true },
    branch: { type: String, default: '', index: true },
    year: { type: String, default: '', index: true },
    type: { type: String, default: 'notes', index: true },
    fileUrl: { type: String, default: '' },
    pageNumber: { type: Number, default: 1 }
  },
  tokenCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

DocumentChunkSchema.index({ documentId: 1, chunkIndex: 1 }, { unique: true });
DocumentChunkSchema.index({ 'metadata.subject': 1, 'metadata.branch': 1 });

const MyteeConversation = mongoose.model('MyteeConversation', MyteeConversationSchema);
const MyteeFeedback = mongoose.model('MyteeFeedback', MyteeFeedbackSchema);
const MyteeUsageLog = mongoose.model('MyteeUsageLog', MyteeUsageLogSchema);
const MyteeAuditLog = mongoose.model('MyteeAuditLog', MyteeAuditLogSchema);
// Security Report Schema (Consolidated 3-Strike Incident Dossier)
const SecurityReportSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  userName: {
    type: String,
    required: true
  },
  userEmail: {
    type: String,
    required: true,
    index: true
  },
  userRole: {
    type: String,
    default: 'student'
  },
  strikes: [
    {
      strikeNumber: { type: Number, required: true },
      severity: { type: String, enum: ['normal', 'high', 'extreme'], required: true },
      threatCategory: { type: String, default: 'suspicious_activity' },
      flaggedMessage: { type: String, required: true },
      aiReason: { type: String, default: '' },
      createdAt: { type: Date, default: Date.now },
      recentChat: [
        {
          role: { type: String },
          content: { type: String },
          timestamp: { type: Date, default: Date.now }
        }
      ]
    }
  ],
  totalStrikes: {
    type: Number,
    default: 1
  },
  currentBanLevel: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'banned', 'unblocked', 'dismissed'],
    default: 'active',
    index: true
  },
  lastReportedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  banExpiresAt: {
    type: Date,
    default: null
  },
  resolvedAt: {
    type: Date,
    default: null
  },
  resolvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, { timestamps: true });

SecurityReportSchema.index({ userId: 1, status: 1 });

const DocumentChunk = mongoose.model('DocumentChunk', DocumentChunkSchema);
const SecurityReport = mongoose.model('SecurityReport', SecurityReportSchema);

module.exports.SecurityReport = SecurityReport;
module.exports.MyteeConversation = MyteeConversation;
module.exports.MyteeFeedback = MyteeFeedback;
module.exports.MyteeUsageLog = MyteeUsageLog;
module.exports.MyteeAuditLog = MyteeAuditLog;
module.exports.DocumentChunk = DocumentChunk;

// Backward-compatible aliases for sonic naming convention
module.exports.SonicConversation = MyteeConversation;
module.exports.SonicFeedback = MyteeFeedback;
module.exports.SonicUsageLog = MyteeUsageLog;
module.exports.SonicAuditLog = MyteeAuditLog;

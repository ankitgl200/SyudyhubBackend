/**
 * Admin Superpowers Service for MYTEE
 * 
 * Empowers Admins & Superadmins with autonomous AI capabilities:
 * - Read & query any user's profile and upload history
 * - View all Help & Support tickets and generate intelligent solutions
 * - Manage site content (Announcements CRUD, Document approval/edit/delete)
 * - Send in-app notifications and direct emails to specific users
 * - Generate comprehensive executive site status & analytics reports
 * 
 * Strict Role-Based Access Control (RBAC):
 * Only users with role 'admin' or 'superadmin' can access these functions.
 */

const { User, Document, Announcement, HelpRequest, Notification } = require('../../db/models');
const { getWebsiteOverview, getUserActivityAnalytics, getAiUsageAnalytics } = require('./adminAnalyticsService');
const { getTroubleshootingGuide } = require('./websiteKnowledgeService');
const { maskEmail } = require('../emailService');
const config = require('../../config');
let firebaseAdmin = null;
try {
  firebaseAdmin = require('../firebaseAdmin');
} catch (e) {
  // Firebase admin optional in offline/test environment
}

/**
 * Validates that the requesting user is an authorized admin or superadmin
 */
function verifyAdmin(userContext) {
  if (!userContext || (userContext.role !== 'admin' && userContext.role !== 'superadmin')) {
    const err = new Error('Access Denied: Administrative privileges required.');
    err.status = 403;
    throw err;
  }
}

/**
 * Validates superadmin privileges for destructive or sensitive operations
 */
function verifySuperAdmin(userContext) {
  verifyAdmin(userContext);
  if (userContext.role !== 'superadmin') {
    const err = new Error('Access Denied: Superadmin privileges required for this specific action.');
    err.status = 403;
    throw err;
  }
}

// ============================================================
// 1. USER DATA & USER MANAGEMENT
// ============================================================

/**
 * Search or list users with flexible filters
 */
async function searchUsers({ query = '', role = '', approved = null, limit = 15 } = {}, userContext) {
  verifyAdmin(userContext);

  const filter = {};
  if (role) {
    filter.role = role.toLowerCase().trim();
  }
  if (approved !== null && approved !== undefined) {
    filter.approved = approved === true || approved === 'true';
  }

  if (query && typeof query === 'string' && query.trim()) {
    const q = query.trim();
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { name: regex },
      { email: regex },
      { phone: regex }
    ];
  }

  const users = await User.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 50))
    .select('name email phone role approved createdAt lastLogin lastActive deviceInfo.deviceType')
    .lean();

  // Attach upload counts for each user in parallel
  const enrichedUsers = await Promise.all(
    users.map(async (u) => {
      const [totalUploads, pendingUploads] = await Promise.all([
        Document.countDocuments({ uploadedByUserId: u._id }),
        Document.countDocuments({ uploadedByUserId: u._id, status: 'pending' })
      ]);
      return {
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        phone: u.phone || 'N/A',
        role: u.role,
        approved: !!u.approved,
        totalUploads,
        pendingUploads,
        createdAt: u.createdAt,
        lastActive: u.lastActive || u.lastLogin || u.createdAt
      };
    })
  );

  return {
    success: true,
    count: enrichedUsers.length,
    users: enrichedUsers
  };
}

/**
 * Get comprehensive profile details of a specific user
 */
async function getUserDetails(identifier, userContext) {
  verifyAdmin(userContext);

  if (!identifier) {
    throw new Error('User ID, email, or name identifier is required.');
  }

  let user = null;
  const cleanId = String(identifier).trim();

  // Try by ObjectId if valid 24 hex chars
  if (/^[0-9a-fA-F]{24}$/.test(cleanId)) {
    user = await User.findById(cleanId).lean();
  }

  // Try by Email
  if (!user && cleanId.includes('@')) {
    user = await User.findOne({ email: cleanId.toLowerCase() }).lean();
  }

  // Try by Name or Phone
  if (!user) {
    user = await User.findOne({
      $or: [
        { name: new RegExp(`^${cleanId}$`, 'i') },
        { phone: cleanId }
      ]
    }).lean();
  }

  if (!user) {
    return { success: false, message: `No user found matching identifier "${cleanId}"` };
  }

  const [documents, totalNotifications, totalHelpRequests] = await Promise.all([
    Document.find({ uploadedByUserId: user._id })
      .sort({ createdAt: -1 })
      .select('title type subject year status likes createdAt')
      .lean(),
    Notification.countDocuments({ recipientId: user._id }),
    HelpRequest.countDocuments({ $or: [{ userId: user._id }, { requestedEmail: user.email }] })
  ]);

  return {
    success: true,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone || 'N/A',
      role: user.role,
      approved: !!user.approved,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      lastActive: user.lastActive,
      deviceInfo: user.deviceInfo || {},
      stats: {
        totalUploads: documents.length,
        approvedUploads: documents.filter(d => d.status === 'approved').length,
        pendingUploads: documents.filter(d => d.status === 'pending').length,
        totalLikesReceived: documents.reduce((sum, d) => sum + (Array.isArray(d.likes) ? d.likes.length : 0), 0),
        totalNotifications,
        totalHelpRequests
      },
      recentUploads: documents.slice(0, 10).map(d => ({
        id: d._id.toString(),
        title: d.title,
        type: d.type,
        subject: d.subject || 'N/A',
        year: d.year || 'N/A',
        status: d.status,
        date: d.createdAt
      }))
    }
  };
}

/**
 * Update user status (approve educator/student, change role, or remove)
 */
async function updateUserStatus({ targetUserId, action, role }, userContext) {
  verifyAdmin(userContext);

  if (!targetUserId) throw new Error('Target user ID is required.');
  const targetUser = await User.findById(targetUserId);
  if (!targetUser) throw new Error('Target user not found.');

  switch (action) {
    case 'approve': {
      targetUser.approved = true;
      await targetUser.save();

      // Send congratulations notification to the approved user
      try {
        await sendUserCommunication({
          targetUserId: targetUser._id.toString(),
          message: `Congratulations ${targetUser.name}! Your StudyMyte ${targetUser.role} account has been reviewed and approved by an administrator. You now have full access to contribute and browse all resources.`,
          channel: 'in_app',
          subject: 'Account Approved!'
        }, userContext);
      } catch (e) {}

      return {
        success: true,
        message: `User ${targetUser.name} (${targetUser.email}) has been approved successfully.`
      };
    }

    case 'disapprove':
    case 'suspend': {
      targetUser.approved = false;
      await targetUser.save();
      return {
        success: true,
        message: `User ${targetUser.name} (${targetUser.email}) approval status set to pending/suspended.`
      };
    }

    case 'change_role': {
      verifySuperAdmin(userContext);
      if (!['student', 'educator', 'admin'].includes(role)) {
        throw new Error('Invalid role specified. Supported: student, educator, admin.');
      }
      targetUser.role = role;
      await targetUser.save();
      return {
        success: true,
        message: `User ${targetUser.name} role changed to "${role}".`
      };
    }

    case 'delete': {
      verifySuperAdmin(userContext);
      if (targetUser.role === 'superadmin') {
        throw new Error('Safety guard: Cannot delete a superadmin account.');
      }
      await User.findByIdAndDelete(targetUserId);
      return {
        success: true,
        message: `User ${targetUser.name} (${targetUser.email}) has been permanently deleted.`
      };
    }

    default:
      throw new Error(`Unknown user update action: ${action}`);
  }
}

// ============================================================
// 2. HELP & SUPPORT TICKETS & INTELLIGENT SOLUTIONS
// ============================================================

/**
 * Generate an intelligent AI suggested solution for a given support ticket
 */
function generateTicketSolution(ticket) {
  const subject = (ticket.subject || '').toLowerCase();
  const message = (ticket.message || '').toLowerCase();
  const text = `${subject} ${message}`;

  if (text.includes('pdf') || text.includes('viewer') || text.includes('download') || text.includes('cannot open')) {
    return {
      category: 'PDF & Document Viewing',
      summary: 'PDF rendering or browser pop-up block issue',
      recommendedSteps: [
        'StudyMyte features an inbuilt PDF viewer. If the document displays a blank screen, recommend disabling third-party ad-blockers or browser extensions for studymyte.tech.',
        'Advise the student to click the direct "View" button from the PYQs/Notes list rather than right-clicking.',
        'If on mobile Chrome or Safari, ensure "Desktop site" is toggled off and browser cache is cleared.'
      ],
      quickReply: `Hello ${ticket.name || 'Student'},\n\nRegarding your issue with viewing PDFs:\n1. StudyMyte documents open directly in our inbuilt web viewer without requiring downloads.\n2. Please disable any active ad-blockers or content filters for studymyte.tech.\n3. Try refreshing the page with Ctrl+F5 (or clearing mobile browser cache).\n\nIf you still face issues, please reply with your device and browser model so we can assist further!`
    };
  }

  if (text.includes('login') || text.includes('password') || text.includes('otp') || text.includes('cannot sign in')) {
    return {
      category: 'Authentication & Login',
      summary: 'Password reset or account verification difficulty',
      recommendedSteps: [
        'Verify if the user account is approved (Educator accounts require manual admin approval before login).',
        'Recommend using the in-chat password reset feature or the Forgot Password portal at https://studymyte.tech/#/forgot-password.',
        'Ensure the student is checking their email Spam/Junk folder for the 6-digit OTP code.'
      ],
      quickReply: `Hello ${ticket.name || 'Student'},\n\nRegarding your login or password issue:\n1. If you are an Educator, your account may be undergoing standard admin verification.\n2. If you forgot your password, you can reset it directly using our AI Assistant MYTEE or at https://studymyte.tech/#/forgot-password.\n3. Check your email Spam folder for OTP verification codes.`
    };
  }

  if (text.includes('upload') || text.includes('contribute') || text.includes('file size') || text.includes('rejected')) {
    return {
      category: 'Resource Upload & Contribution',
      summary: 'Upload limit or format incompatibility',
      recommendedSteps: [
        'Check if file size exceeds the 50MB limit per document.',
        'Confirm file is in supported format (.pdf, .doc, .docx).',
        'Verify document status: Uploaded materials enter a pending verification queue before becoming publicly visible in the PYQ/Notes archive.'
      ],
      quickReply: `Hello ${ticket.name || 'Student'},\n\nThank you for contributing to StudyMyte!\n1. Uploaded notes and PYQs undergo verification before appearing publicly.\n2. Maximum allowed upload file size is 50MB.\n3. You can monitor the approval status of your uploads in your profile section.`
    };
  }

  return {
    category: 'General Support Inquiry',
    summary: 'Standard platform inquiry',
    recommendedSteps: [
      'Review user account history and recent activity logs.',
      'Check if requested resources already exist under alternate subject naming conventions.',
      'Dispatch direct in-app message or email reply to address student inquiry.'
    ],
    quickReply: `Hello ${ticket.name || 'Student'},\n\nThank you for reaching out to StudyMyte Support. We have received your query regarding "${ticket.subject || 'your request'}" and our team is actively reviewing it. We will update you shortly!`
  };
}

/**
 * List all support tickets with filters & auto-generated solutions
 */
async function getAllSupportTickets({ status = 'pending', limit = 15 } = {}, userContext) {
  verifyAdmin(userContext);

  const filter = {};
  if (status && status !== 'all') {
    filter.status = status;
  }

  const tickets = await HelpRequest.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 50))
    .lean();

  const enrichedTickets = tickets.map(t => {
    const solution = generateTicketSolution(t);
    return {
      id: t._id.toString(),
      userName: t.name || 'Anonymous User',
      phone: t.phone || 'N/A',
      email: t.requestedEmail || 'N/A',
      role: t.role || 'student',
      subject: t.subject,
      message: t.message,
      status: t.status || 'pending',
      createdAt: t.createdAt,
      aiAnalysis: {
        category: solution.category,
        summary: solution.summary,
        recommendedSteps: solution.recommendedSteps,
        suggestedReply: solution.quickReply
      }
    };
  });

  return {
    success: true,
    count: enrichedTickets.length,
    statusFilter: status,
    tickets: enrichedTickets
  };
}

/**
 * Resolve a ticket and optionally dispatch resolution notification
 */
async function resolveOrReplySupportTicket({ ticketId, resolutionMessage = '', markResolved = true } = {}, userContext) {
  verifyAdmin(userContext);

  let ticket = null;
  const raw = ticketId ? String(ticketId).replace(/^#/, '').trim() : '';

  // 1. Try matching by 24-character hex ObjectId
  if (raw && /^[0-9a-fA-F]{24}$/.test(raw)) {
    ticket = await HelpRequest.findById(raw);
  }

  // 2. Try matching by partial ID (prefix, suffix, or substring)
  if (!ticket && raw && raw !== 'this' && raw !== 'this ticket' && raw !== 'it') {
    const recent = await HelpRequest.find().sort({ createdAt: -1 }).limit(50);
    ticket = recent.find(t => {
      const idStr = t._id.toString();
      return idStr === raw || idStr.includes(raw) || idStr.startsWith(raw) || idStr.endsWith(raw);
    });
  }

  // 3. Fallback: If "this ticket" or ID omitted, resolve the latest pending ticket
  if (!ticket) {
    ticket = await HelpRequest.findOne({ status: 'pending' }).sort({ createdAt: -1 });
  }

  // 4. Fallback: If no pending ticket, resolve the most recent ticket overall
  if (!ticket) {
    ticket = await HelpRequest.findOne().sort({ createdAt: -1 });
  }

  if (!ticket) throw new Error('Support ticket not found.');

  if (markResolved) {
    ticket.status = 'resolved';
  }
  await ticket.save();

  // If ticket is tied to a registered user or email, send in-app notification
  let notificationSent = false;
  if (ticket.userId || ticket.requestedEmail) {
    try {
      let targetUser = ticket.userId ? await User.findById(ticket.userId) : null;
      if (!targetUser && ticket.requestedEmail) {
        targetUser = await User.findOne({ email: ticket.requestedEmail.toLowerCase() });
      }

      if (targetUser) {
        const body = resolutionMessage || `Your support ticket regarding "${ticket.subject}" has been marked as resolved by our administration team.`;
        await sendUserCommunication({
          targetUserId: targetUser._id.toString(),
          message: body,
          channel: 'in_app',
          subject: `Support Ticket Resolved: ${ticket.subject}`
        }, userContext);
        notificationSent = true;
      }
    } catch (notifyErr) {
      console.warn('[AdminSuperpowers] Failed to send ticket resolution notification:', notifyErr.message);
    }
  }

  const shortId = ticket._id.toString().slice(-6);
  return {
    success: true,
    message: `Support ticket #${shortId} regarding "${ticket.subject}" is now marked as ${ticket.status}.`,
    ticketId: ticket._id.toString(),
    status: ticket.status,
    notificationSent
  };
}

// ============================================================
// 3. CONTENT CRUD (Announcements & Documents)
// ============================================================

/**
 * Full CRUD for Announcements
 */
async function manageAnnouncement({ action, id, title, content, docUrl }, userContext) {
  verifyAdmin(userContext);

  switch (action) {
    case 'create': {
      if (!title || !content) {
        throw new Error('Title and content are required to create an announcement.');
      }
      const newAnn = new Announcement({
        title: title.trim(),
        content: content.trim(),
        docUrl: docUrl ? docUrl.trim() : null
      });
      await newAnn.save();
      return {
        success: true,
        message: `Official Announcement "${newAnn.title}" created successfully!`,
        announcement: {
          id: newAnn._id.toString(),
          title: newAnn.title,
          content: newAnn.content,
          createdAt: newAnn.createdAt
        }
      };
    }

    case 'edit': {
      if (!id) throw new Error('Announcement ID is required to edit.');
      const update = {};
      if (title) update.title = title.trim();
      if (content) update.content = content.trim();
      if (docUrl !== undefined) update.docUrl = docUrl;

      const updated = await Announcement.findByIdAndUpdate(id, update, { new: true });
      if (!updated) throw new Error('Announcement not found.');

      return {
        success: true,
        message: `Announcement "${updated.title}" updated successfully!`,
        announcement: updated
      };
    }

    case 'delete': {
      if (!id) throw new Error('Announcement ID is required to delete.');
      const deleted = await Announcement.findByIdAndDelete(id);
      if (!deleted) throw new Error('Announcement not found.');

      return {
        success: true,
        message: `Announcement "${deleted.title}" deleted successfully.`
      };
    }

    case 'list': {
      const list = await Announcement.find().sort({ createdAt: -1 }).limit(10).lean();
      return {
        success: true,
        count: list.length,
        announcements: list.map(a => ({
          id: a._id.toString(),
          title: a.title,
          content: a.content,
          docUrl: a.docUrl,
          createdAt: a.createdAt
        }))
      };
    }

    default:
      throw new Error(`Unsupported announcement action: ${action}`);
  }
}

/**
 * Full CRUD for Uploaded Documents (Approve, Edit, Delete, List Pending)
 */
async function manageDocument({ action, id, title, subject, year, status }, userContext) {
  verifyAdmin(userContext);

  switch (action) {
    case 'list_pending': {
      const pending = await Document.find({ status: 'pending' })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

      return {
        success: true,
        count: pending.length,
        documents: pending.map(d => ({
          id: d._id.toString(),
          title: d.title,
          type: d.type,
          subject: d.subject || 'N/A',
          year: d.year || 'N/A',
          uploadedBy: d.uploadedBy,
          uploadedByUserId: d.uploadedByUserId,
          createdAt: d.createdAt,
          fileUrl: d.fileUrl
        }))
      };
    }

    case 'approve': {
      if (!id) throw new Error('Document ID is required to approve.');
      const doc = await Document.findById(id);
      if (!doc) throw new Error('Document not found.');

      doc.status = 'approved';
      await doc.save();

      // Notify the uploader
      if (doc.uploadedByUserId) {
        try {
          await sendUserCommunication({
            targetUserId: doc.uploadedByUserId.toString(),
            message: `Great news! Your uploaded material "${doc.title}" has been reviewed and approved by StudyMyte administrators. Thank you for contributing to our student community!`,
            channel: 'in_app',
            subject: 'Notes Approved!'
          }, userContext);
        } catch (e) {}
      }

      return {
        success: true,
        message: `Document "${doc.title}" approved and published to StudyMyte archives.`
      };
    }

    case 'reject': {
      if (!id) throw new Error('Document ID is required to reject.');
      const doc = await Document.findById(id);
      if (!doc) throw new Error('Document not found.');

      doc.status = 'rejected';
      await doc.save();

      return {
        success: true,
        message: `Document "${doc.title}" marked as rejected.`
      };
    }

    case 'edit': {
      if (!id) throw new Error('Document ID is required to edit.');
      const update = {};
      if (title) update.title = title.trim();
      if (subject) update.subject = subject.trim();
      if (year) update.year = year.trim();
      if (status) update.status = status;

      const updated = await Document.findByIdAndUpdate(id, update, { new: true });
      if (!updated) throw new Error('Document not found.');

      return {
        success: true,
        message: `Document "${updated.title}" updated successfully!`,
        document: updated
      };
    }

    case 'delete': {
      if (!id) throw new Error('Document ID is required to delete.');
      const doc = await Document.findByIdAndDelete(id);
      if (!doc) throw new Error('Document not found.');

      return {
        success: true,
        message: `Document "${doc.title}" permanently removed from archives.`
      };
    }

    default:
      throw new Error(`Unsupported document management action: ${action}`);
  }
}

// ============================================================
// 4. USER COMMUNICATION (In-App Message & Push Notifications Only - No AI Email)
// ============================================================

/**
 * Dispatch In-App Notification and FCM Push Notification to a specific user.
 * Note: Mailing by AI is disabled per system policy.
 */
async function sendUserCommunication({ targetUserId, targetEmail, message, channel = 'in_app', subject = 'Message from StudyMyte Admin' }, userContext) {
  verifyAdmin(userContext);

  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new Error('Message content is required.');
  }

  // Resolve target user
  let user = null;
  if (targetUserId) {
    user = await User.findById(targetUserId);
  } else if (targetEmail) {
    user = await User.findOne({ email: targetEmail.trim().toLowerCase() });
  }

  if (!user && !targetEmail) {
    throw new Error('Could not find recipient user. Please provide valid user ID or email.');
  }

  const recipientName = user ? user.name : 'StudyMyte Member';
  const recipientEmail = user ? user.email : targetEmail.trim().toLowerCase();
  const cleanMessage = message.trim();

  const results = {
    inAppSent: false,
    emailSent: false,
    emailDisabledNotice: 'Direct emailing by AI is disabled on StudyMyte. Dispatched via in-app notification.',
    recipient: {
      name: recipientName,
      email: maskEmail(recipientEmail)
    }
  };

  // Dispatch In-App Notification
  if (user) {
    const formattedNotification = `Admin\n${cleanMessage}\n\nThank you,\nStudyMyte Administration.`;
    const notification = new Notification({
      recipientId: user._id,
      message: formattedNotification,
      rawMessage: cleanMessage
    });
    await notification.save();
    results.inAppSent = true;

    // Send Firebase FCM push if user has registered device tokens
    if (firebaseAdmin && user.fcmTokens && user.fcmTokens.length > 0) {
      try {
        const pushMessage = {
          notification: {
            title: subject || 'New Message from Admin',
            body: cleanMessage.length > 100 ? cleanMessage.slice(0, 97) + '...' : cleanMessage
          },
          tokens: [...new Set(user.fcmTokens)]
        };
        await firebaseAdmin.messaging().sendEachForMulticast(pushMessage);
      } catch (fcmErr) {
        console.warn('[AdminSuperpowers] FCM push delivery notice:', fcmErr.message);
      }
    }
  }

  return {
    success: results.inAppSent,
    summary: `In-app message dispatched directly to ${recipientName}'s dashboard and mobile notifications. (Note: AI email dispatch is permanently disabled).`,
    details: results
  };
}

// ============================================================
// 5. EXECUTIVE SITE STATUS & DEEP ANALYTICS REPORT
// ============================================================

/**
 * Generate an executive, deep-dive site status report
 */
async function generateExecutiveSiteStatusReport(userContext) {
  verifyAdmin(userContext);

  const [overview, userStats, aiStats, pendingDocs, pendingTickets] = await Promise.all([
    getWebsiteOverview(userContext),
    getUserActivityAnalytics(userContext),
    getAiUsageAnalytics(userContext),
    Document.countDocuments({ status: 'pending' }),
    HelpRequest.countDocuments({ status: 'pending' })
  ]);

  const uptimeHours = (process.uptime() / 3600).toFixed(1);
  const memoryUsageMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    executiveSummary: {
      platformHealth: pendingTickets > 5 ? 'Attention Needed' : 'Optimal',
      totalRegisteredUsers: overview.users.total,
      activeUsersWeekly: overview.users.active.weekly,
      totalArchivedResources: overview.resources.total,
      pendingReviewItems: {
        documents: pendingDocs,
        tickets: pendingTickets
      },
      aiAssistantHealth: {
        totalQueries30Days: aiStats.summary.totalRequestsLast30Days,
        successRate: `${aiStats.summary.successRatePct}%`,
        avgResponseTime: `${aiStats.summary.averageResponseTimeMs}ms`
      },
      infrastructure: {
        nodeEnv: process.env.NODE_ENV || 'production',
        uptimeHours: `${uptimeHours} hours`,
        memoryRss: `${memoryUsageMb} MB`
      }
    },
    actionableRecommendations: [
      pendingDocs > 0 ? `Review and approve ${pendingDocs} pending academic documents in the moderation queue.` : 'All uploaded notes and PYQs are verified and up to date.',
      pendingTickets > 0 ? `Respond to ${pendingTickets} open student help requests.` : 'Zero open support tickets. Excellent support response time!',
      overview.users.newLast7Days > 0 ? `${overview.users.newLast7Days} new students/educators joined this week. Consider publishing an announcement to welcome them!` : 'Engagement is steady. Publishing fresh semester PYQs can drive new user acquisition.'
    ]
  };
}

module.exports = {
  verifyAdmin,
  verifySuperAdmin,
  searchUsers,
  getUserDetails,
  updateUserStatus,
  getAllSupportTickets,
  resolveOrReplySupportTicket,
  manageAnnouncement,
  manageDocument,
  sendUserCommunication,
  generateExecutiveSiteStatusReport
};


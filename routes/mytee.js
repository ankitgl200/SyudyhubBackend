/**
 * MYTEE API Router
 * Endpoints for chat, conversation history, user feedback,
 * official website information, support escalations, and administrative intelligence.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { auth, isAdmin } = require('../middleware/auth');
const { myteeChatLimiter, myteeTicketLimiter } = require('../middleware/myteeRateLimiter');
const { validateScope, OUT_OF_SCOPE_RESPONSE } = require('../services/mytee/myteeScopeValidator');
const { generateAiResponse } = require('../services/mytee/geminiService');
const { getOfficialWebsiteInfo, updateOfficialWebsiteInfo, VERIFIED_ROUTES } = require('../services/mytee/websiteKnowledgeService');
const { createSupportTicket, getUserTickets } = require('../services/mytee/supportTicketService');
const { getWebsiteOverview, getUserActivityAnalytics, getAiUsageAnalytics, generateAdminReport } = require('../services/mytee/adminAnalyticsService');
const { logAction, getRecentAuditLogs } = require('../services/mytee/myteeAuditLogger');
const { initiatePasswordReset, verifyResetOtp, completePasswordReset, completePasswordResetForUser } = require('../services/mytee/inChatAuthService');
const { handleFunQuery } = require('../services/mytee/funPersonalityService');
const { MyteeConversation, MyteeFeedback, MyteeUsageLog, User, OtpVerification } = require('../db/models');

/**
 * Optional authentication helper:
 * Attaches user to req.user if a valid token is passed; doesn't reject guests if missing.
 */
async function optionalAuth(req, res, next) {
  let token = '';
  const authHeader = req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.replace('Bearer ', '');
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = await User.findById(decoded.id).lean();
    if (user && user.approved) {
      req.user = {
        id: user._id.toString(),
        name: user.name,
        role: user.role,
        phone: user.phone,
        email: user.email
      };
    } else {
      req.user = null;
    }
  } catch (err) {
    req.user = null;
  }

  next();
}

// ==========================================
// 1. Core Chat Endpoint
// ==========================================
router.post('/chat', optionalAuth, myteeChatLimiter, async (req, res) => {
  const startTime = Date.now();
  const { message, sessionId } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ success: false, message: 'A valid message string is required.' });
  }

  const trimmed = message.trim();
  const maxLen = config.MYTEE.MAX_MESSAGE_LENGTH || 1200;
  if (trimmed.length > maxLen) {
    return res.status(400).json({
      success: false,
      message: `Message exceeds maximum allowed length of ${maxLen} characters.`
    });
  }


  const activeSessionId = sessionId || `sess_${crypto.randomBytes(12).toString('hex')}`;
  const clientIp = req.ip || req.socket?.remoteAddress || 'Unknown';
  const userRole = req.user ? req.user.role : 'guest';

  // 1. Retrieve or initialize conversation session
  let conversation = await MyteeConversation.findOne({ sessionId: activeSessionId });
  if (!conversation) {
    conversation = new MyteeConversation({
      sessionId: activeSessionId,
      userId: req.user ? req.user.id : null,
      role: userRole,
      messages: []
    });
  }

  // 1.5. Intercept Direct Password Entry right after OTP verification (Never leaks to logs or LLM)
  if (req.user && req.user.id && trimmed.length >= 6 && !trimmed.includes(' ') && !/^(hi|hello|hey|help|find|give|show|what|where)\b/i.test(trimmed)) {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentVerifiedOtp = await OtpVerification.findOne({
      userId: req.user.id,
      purpose: 'password_reset',
      used: true,
      revoked: false,
      $or: [
        { verifiedAt: { $gte: tenMinutesAgo } },
        { updatedAt: { $gte: tenMinutesAgo } },
        { createdAt: { $gte: tenMinutesAgo } }
      ]
    }).sort({ createdAt: -1 });

    if (recentVerifiedOtp) {
      const resetRes = await completePasswordResetForUser(req.user.id, trimmed, clientIp);
      if (resetRes.success) {
        // Redact plaintext password from conversation history
        conversation.messages.push({
          role: 'user',
          content: '••••••••',
          timestamp: new Date()
        });

        const successReply = `🎉 **Password Changed Successfully!**\n\nYour StudyMyte account password has been updated and secured. You can now use your new password across the platform!`;
        const successActions = [
          { label: 'Open Profile Settings', path: '/profile' },
          { label: 'Browse Notes', path: '/notes' }
        ];

        conversation.messages.push({
          role: 'model',
          content: successReply,
          actions: successActions,
          timestamp: new Date()
        });

        await conversation.save();

        return res.json({
          success: true,
          sessionId: activeSessionId,
          reply: successReply,
          resources: [],
          actions: successActions,
          ticket: null,
          resetAction: { type: 'password_completed' },
          toolsUsed: ['set_new_account_password']
        });
      }
    }
  }

  // 1.8. Fun Personality & Gen-Z Interaction Layer (Hacking jokes, data dump requests, admin/owner bluffs, special modes)
  const currentMode = conversation.personalityMode || 'normal';
  const funResult = handleFunQuery(trimmed, req.user, currentMode);
  if (funResult && funResult.matched) {
    if (funResult.newMode) {
      conversation.personalityMode = funResult.newMode;
    }

    conversation.messages.push({
      role: 'user',
      content: trimmed,
      timestamp: new Date()
    });

    conversation.messages.push({
      role: 'model',
      content: funResult.text,
      actions: funResult.actions || [],
      timestamp: new Date()
    });

    if (conversation.messages.length > 30) {
      conversation.messages = conversation.messages.slice(-30);
    }
    conversation.updatedAt = new Date();
    await conversation.save();

    await MyteeUsageLog.create({
      userId: req.user ? req.user.id : null,
      role: userRole,
      sessionId: activeSessionId,
      clientIp,
      query: trimmed.slice(0, 200),
      scopePassed: true,
      success: true,
      responseTimeMs: Date.now() - startTime
    });

    return res.json({
      success: true,
      sessionId: activeSessionId,
      reply: funResult.text,
      resources: [],
      actions: funResult.actions || [],
      ticket: null,
      personalityMode: conversation.personalityMode,
      toolsUsed: ['fun_personality_engine']
    });
  }

  const hasRecentHistory = conversation.messages.length > 0;

  // 2. Server-side Scope Validation
  const scopeResult = validateScope(trimmed, { hasRecentHistory, role: userRole });
  if (!scopeResult.allowed) {
    const politeReply = scopeResult.reply || OUT_OF_SCOPE_RESPONSE;

    // Log rejected scope event
    await MyteeUsageLog.create({
      userId: req.user ? req.user.id : null,
      role: userRole,
      sessionId: activeSessionId,
      clientIp,
      query: trimmed.slice(0, 200),
      scopePassed: false,
      success: true,
      responseTimeMs: Date.now() - startTime
    });

    return res.json({
      success: true,
      sessionId: activeSessionId,
      reply: politeReply,
      resources: [],
      actions: [
        { label: 'Browse Notes', path: '/notes' },
        { label: 'Browse PYQs', path: '/papers' },
        { label: 'Browse Resources', path: '/resources' }
      ],
      ticket: null,
      scopeRejected: true
    });
  }

  // 3. Process AI Response via Gemini / Fallback Engine
  try {
    const aiResult = await generateAiResponse({
      message: trimmed,
      history: conversation.messages,
      userContext: req.user,
      personalityMode: conversation.personalityMode || 'normal'
    });

    if (aiResult.newMode) {
      conversation.personalityMode = aiResult.newMode;
    }

    const responseTimeMs = Date.now() - startTime;

    // 4. Update Conversation History
    conversation.messages.push({
      role: 'user',
      content: trimmed,
      timestamp: new Date()
    });

    conversation.messages.push({
      role: 'model',
      content: aiResult.text,
      resources: aiResult.resources || [],
      actions: aiResult.actions || [],
      ticket: aiResult.ticket || null,
      timestamp: new Date()
    });

    // Prune excessive history turns
    if (conversation.messages.length > 30) {
      conversation.messages = conversation.messages.slice(-30);
    }
    conversation.updatedAt = new Date();
    await conversation.save();

    // 5. Log Metrics
    await MyteeUsageLog.create({
      userId: req.user ? req.user.id : null,
      role: userRole,
      sessionId: activeSessionId,
      clientIp,
      query: trimmed.slice(0, 300),
      toolsUsed: aiResult.toolsUsed || [],
      scopePassed: true,
      success: true,
      responseTimeMs,
      modelUsed: aiResult.model || 'fallback-local'
    });

    return res.json({
      success: true,
      sessionId: activeSessionId,
      reply: aiResult.text,
      resources: aiResult.resources || [],
      actions: aiResult.actions || [],
      ticket: aiResult.ticket || null,
      resetAction: aiResult.resetAction || null,
      resetTicket: aiResult.resetTicket || null,
      clientAction: aiResult.clientAction || null,
      personalityMode: conversation.personalityMode || 'normal',
      toolsUsed: aiResult.toolsUsed || []
    });

  } catch (err) {
    console.error('[MYTEE Router] Error executing chat turn:', err);

    await MyteeUsageLog.create({
      userId: req.user ? req.user.id : null,
      role: userRole,
      sessionId: activeSessionId,
      clientIp,
      query: trimmed.slice(0, 300),
      scopePassed: true,
      success: false,
      errorMessage: err.message,
      responseTimeMs: Date.now() - startTime
    });

    return res.status(500).json({
      success: false,
      message: 'MYTEE is currently experiencing high load. Please try again or visit our Help & Support page.',
      supportUrl: '/support'
    });
  }
});

// ==========================================
// 1.5. In-Chat Password Reset Endpoints
// ==========================================
router.post('/auth/request-reset-otp', auth, async (req, res) => {
  try {
    const result = await initiatePasswordReset(req.user, req.ip);
    if (!result.success) {
      return res.status(result.rateLimited ? 429 : 400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error requesting verification code.' });
  }
});

router.post('/auth/verify-reset-otp', auth, async (req, res) => {
  try {
    const { verificationId, otp } = req.body;
    const result = await verifyResetOtp(verificationId, otp, req.user, req.ip);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error verifying verification code.' });
  }
});

router.post('/auth/complete-password-reset', auth, async (req, res) => {
  try {
    const { resetTicket, newPassword } = req.body;
    const result = await completePasswordReset(resetTicket, newPassword, req.user, req.ip);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating password.' });
  }
});

// ==========================================
// 2. Conversation History & Reset
// ==========================================
router.get('/history', auth, async (req, res) => {
  try {
    const conversation = await MyteeConversation.findOne({ userId: req.user.id }).sort({ updatedAt: -1 });
    if (!conversation) {
      return res.json({ success: true, messages: [] });
    }
    res.json({
      success: true,
      sessionId: conversation.sessionId,
      messages: conversation.messages
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load conversation history' });
  }
});

router.delete('/history', auth, async (req, res) => {
  try {
    await MyteeConversation.deleteMany({ userId: req.user.id });
    res.json({ success: true, message: 'MYTEE conversation history cleared.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to clear conversation history' });
  }
});

// ==========================================
// 3. User Feedback
// ==========================================
router.post('/feedback', optionalAuth, async (req, res) => {
  try {
    const { sessionId, rating, comment, query, responseSnippet } = req.body;
    if (!rating || (rating !== 'helpful' && rating !== 'unhelpful')) {
      return res.status(400).json({ success: false, message: 'Rating must be "helpful" or "unhelpful"' });
    }

    const feedback = new MyteeFeedback({
      userId: req.user ? req.user.id : null,
      sessionId: sessionId || null,
      rating,
      comment: (comment || '').slice(0, 500),
      query: (query || '').slice(0, 250),
      responseSnippet: (responseSnippet || '').slice(0, 250)
    });

    await feedback.save();
    res.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to submit feedback' });
  }
});

// ==========================================
// 4. Official Website Information
// ==========================================
router.get('/info', async (req, res) => {
  try {
    const info = await getOfficialWebsiteInfo();
    res.json({
      success: true,
      info,
      routes: VERIFIED_ROUTES
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch website info' });
  }
});

router.put('/info', isAdmin, async (req, res) => {
  try {
    const updated = await updateOfficialWebsiteInfo(req.body);
    await logAction({
      adminUser: req.user,
      action: 'UPDATE_WEBSITE_INFO',
      target: 'official_website_info',
      details: req.body,
      ip: req.ip
    });
    res.json({ success: true, message: 'Official website information updated successfully.', info: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 5. Automated Support Escalation
// ==========================================
router.post('/ticket', optionalAuth, myteeTicketLimiter, async (req, res) => {
  try {
    const result = await createSupportTicket(req.body, req.user);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create support ticket' });
  }
});

router.get('/my-tickets', auth, async (req, res) => {
  try {
    const tickets = await getUserTickets(req.user.id);
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch tickets' });
  }
});

// ==========================================
// 6. Admin Intelligence & Natural-Language Reports
// ==========================================
router.post('/admin/chat', isAdmin, async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ success: false, message: 'Question string is required' });
  }

  try {
    const report = await generateAdminReport(question, req.user);

    await logAction({
      adminUser: req.user,
      action: 'ADMIN_INTELLIGENCE_QUERY',
      target: 'analytics_report',
      details: { question: question.slice(0, 150), reportType: report.type },
      ip: req.ip
    });

    res.json({ success: true, report });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/admin/analytics', isAdmin, async (req, res) => {
  try {
    const [overview, userStats, aiStats] = await Promise.all([
      getWebsiteOverview(req.user),
      getUserActivityAnalytics(req.user),
      getAiUsageAnalytics(req.user)
    ]);

    res.json({
      success: true,
      overview,
      userStats,
      aiStats
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/admin/audit-logs', isAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const logs = await getRecentAuditLogs(limit);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to retrieve audit logs' });
  }
});

module.exports = router;


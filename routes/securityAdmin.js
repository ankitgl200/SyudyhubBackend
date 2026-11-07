/**
 * =========================================================================
 * StudyMyte — Admin Security & Unusual Activity Reports API
 * =========================================================================
 * Dedicated administrative endpoints for viewing 3-strike threat dossiers,
 * unblocking users, manually banning users, deleting old reports, and PDF downloads.
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const config = require('../config');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const { isAdmin, isSuperAdmin } = require('../middleware/auth');
const { SecurityReport, User, Document, OtpVerification, Folder, SystemSetting, EmailDispatchLog } = require('../db/models');

// Configure Cloudinary once for storage analytics
if (config.CLOUDINARY && config.CLOUDINARY.cloud_name) {
  cloudinary.config({
    cloud_name: config.CLOUDINARY.cloud_name,
    api_key: config.CLOUDINARY.api_key,
    api_secret: config.CLOUDINARY.api_secret
  });
}

// Custom flexible auth for PDF downloads (Supports query param token e.g. ?token=...)
async function adminOrTokenAuth(req, res, next) {
  let token = req.header('Authorization')?.replace('Bearer ', '') || req.query.token;
  if (!token) {
    return res.status(401).send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #f8fafc;">
          <h2 style="color: #ef4444;">Unauthorized Access</h2>
          <p>Admin token required to view this forensic incident report.</p>
        </body>
      </html>
    `);
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).send('Forbidden: Admin access required.');
    }
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).send('Invalid or expired authentication token.');
  }
}

// @route   GET /api/admin/security/reports
// @desc    Get all consolidated unusual activity dossiers
// @access  Admin only
router.get('/reports', isAdmin, async (req, res) => {
  try {
    const { status, severity } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }
    if (severity && severity !== 'all') {
      filter['strikes.severity'] = severity;
    }

    const reports = await SecurityReport.find(filter)
      .sort({ lastReportedAt: -1 })
      .populate('userId', 'name email role isBlocked banCount currentBanExpiresAt securityStrikes');

    res.json({
      success: true,
      count: reports.length,
      reports: reports.map(r => ({
        id: r._id,
        userId: r.userId?._id || r.userId,
        userName: r.userName || r.userId?.name || 'Student',
        userEmail: r.userEmail || r.userId?.email || 'unknown',
        userRole: r.userRole || r.userId?.role || 'student',
        totalStrikes: r.totalStrikes,
        strikes: r.strikes || [],
        currentBanLevel: r.currentBanLevel,
        isBlocked: !!r.userId?.isBlocked,
        banExpiresAt: r.banExpiresAt || r.userId?.currentBanExpiresAt,
        status: r.status,
        lastReportedAt: r.lastReportedAt,
        createdAt: r.createdAt
      }))
    });
  } catch (err) {
    console.error('Fetch security reports error:', err);
    res.status(500).json({ success: false, message: 'Server error loading security reports' });
  }
});

// @route   DELETE /api/admin/security/report/:reportId
// @desc    Delete an old / unwanted activity report
// @access  Admin only
router.delete('/report/:reportId', isAdmin, async (req, res) => {
  try {
    const report = await SecurityReport.findByIdAndDelete(req.params.reportId);
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }
    res.json({ success: true, message: 'Security report deleted successfully.', id: req.params.reportId });
  } catch (err) {
    console.error('Delete security report error:', err);
    res.status(500).json({ success: false, message: 'Server error deleting security report' });
  }
});

// @route   POST /api/admin/security/unblock/:userId
// @desc    Instantly unblock a user and resolve active security strikes
// @access  Admin only
router.post('/unblock/:userId', isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.isBlocked = false;
    user.securityStrikes = 0;
    user.currentBanExpiresAt = null;
    user.blockedReason = '';
    await user.save();

    await SecurityReport.updateMany(
      { userId: user._id, status: { $in: ['active', 'banned'] } },
      {
        $set: {
          status: 'unblocked',
          resolvedAt: new Date(),
          resolvedBy: req.user.id
        }
      }
    );

    res.json({
      success: true,
      message: `User ${user.name} (${user.email}) has been unblocked successfully. Full platform access is restored.`,
      user: {
        id: user._id,
        isBlocked: user.isBlocked,
        securityStrikes: user.securityStrikes
      }
    });
  } catch (err) {
    console.error('Unblock user error:', err);
    res.status(500).json({ success: false, message: 'Server error unblocking user' });
  }
});

// @route   POST /api/admin/security/ban/:userId
// @desc    Manually ban a user from the security dashboard
// @access  Admin only
router.post('/ban/:userId', isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { banDuration, reason } = req.body;
    const newBanCount = (user.banCount || 0) + 1;
    user.banCount = newBanCount;
    user.isBlocked = true;
    user.blockedAt = new Date();
    user.blockedReason = reason || 'Administrative manual security suspension';

    if (banDuration === '1h') {
      user.currentBanExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    } else if (banDuration === '3d') {
      user.currentBanExpiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    } else {
      user.currentBanExpiresAt = null;
    }

    await user.save();

    await SecurityReport.updateMany(
      { userId: user._id, status: { $in: ['active', 'unblocked'] } },
      {
        $set: {
          status: 'banned',
          currentBanLevel: newBanCount,
          banExpiresAt: user.currentBanExpiresAt
        }
      }
    );

    res.json({
      success: true,
      message: `User ${user.name} has been placed under manual suspension (${banDuration || 'permanent'}).`,
      user: {
        id: user._id,
        isBlocked: user.isBlocked,
        currentBanExpiresAt: user.currentBanExpiresAt
      }
    });
  } catch (err) {
    console.error('Manual ban error:', err);
    res.status(500).json({ success: false, message: 'Server error updating ban status' });
  }
});

// @route   GET /api/admin/security/report-pdf/:reportId
// @desc    Generate printable / downloadable incident report (Theme-aware, token in query allowed)
// @access  Admin only
router.get('/report-pdf/:reportId', adminOrTokenAuth, async (req, res) => {
  try {
    const report = await SecurityReport.findById(req.params.reportId);
    if (!report) {
      return res.status(404).send('Security Report Not Found');
    }

    const strikesHtml = (report.strikes || []).map((s, idx) => `
      <div style="border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin-bottom: 20px; background: #ffffff;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <h3 style="margin: 0; color: #b91c1c; font-size: 16px;">STRIKE ${s.strikeNumber} • ${(s.threatCategory || 'SECURITY THREAT').toUpperCase()}</h3>
          <span style="font-size: 12px; color: #64748b;">${new Date(s.createdAt).toLocaleString()}</span>
        </div>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Flagged Reason:</strong> ${s.aiReason}</p>
        <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 10px 14px; margin: 12px 0; border-radius: 4px;">
          <strong style="color: #991b1b; font-size: 12px;">Flagged User Message:</strong><br>
          <code style="color: #991b1b; font-size: 13px; word-break: break-all;">${s.flaggedMessage}</code>
        </div>
        <h4 style="margin: 14px 0 6px 0; color: #334155; font-size: 13px;">Chat Transcript Evidence Context:</h4>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px;">
          ${(s.recentChat || []).map(c => `
            <div style="margin-bottom: 6px;">
              <strong style="color: ${c.role === 'user' ? '#1e40af' : '#047857'};">${c.role.toUpperCase()}:</strong>
              <span style="color: #1e293b;">${c.content}</span>
            </div>
          `).join('') || '<em>No prior chat turns recorded.</em>'}
        </div>
      </div>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Security Incident Report - ${report.userName}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #0f172a; max-width: 820px; margin: 0 auto; background: #f8fafc; }
          .report-sheet { background: #fff; padding: 36px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
          .header { text-align: center; border-bottom: 2px solid #cbd5e1; padding-bottom: 20px; margin-bottom: 25px; }
          .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 12px; }
          .badge-banned { background: #fee2e2; color: #991b1b; border: 1px solid #f87171; }
          .badge-active { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
          .badge-unblocked { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
          .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
          .meta-table td { padding: 9px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13.5px; }
          .meta-table td:first-child { font-weight: 700; width: 32%; color: #475569; }
          @media print {
            .no-print { display: none; }
            body { padding: 0; background: #fff; }
            .report-sheet { box-shadow: none; border: none; padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
          <a href="javascript:window.close()" style="color: #64748b; text-decoration: none; font-size: 14px;">&larr; Back</a>
          <button onclick="window.print()" style="padding: 9px 18px; background: #0284c7; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">
            🖨️ Print / Save as PDF
          </button>
        </div>
        <div class="report-sheet">
          <div class="header">
            <h1 style="margin: 0; color: #0f172a; font-size: 24px;">StudyMyte Security & Forensics Incident Report</h1>
            <p style="margin: 6px 0 0 0; color: #64748b; font-size: 13px;">Official Autonomous AI Threat Sentinel Surveillance Record</p>
          </div>
          <table class="meta-table">
            <tr><td>Target Student:</td><td><strong>${report.userName}</strong></td></tr>
            <tr><td>Email Address:</td><td>${report.userEmail}</td></tr>
            <tr><td>Account Role:</td><td>${report.userRole.toUpperCase()}</td></tr>
            <tr><td>Current Status:</td><td><span class="badge badge-${report.status}">${report.status.toUpperCase()}</span></td></tr>
            <tr><td>Total Strikes:</td><td><strong style="color: #b91c1c;">${report.totalStrikes} / 3 Strikes</strong></td></tr>
            <tr><td>Ban Tier Level:</td><td>Ban #${report.currentBanLevel || 0}</td></tr>
            <tr><td>Lockout Expiration:</td><td>${report.banExpiresAt ? new Date(report.banExpiresAt).toLocaleString() : 'Permanent / None'}</td></tr>
            <tr><td>Incident Case ID:</td><td><code>${report._id}</code></td></tr>
            <tr><td>First Incident Date:</td><td>${new Date(report.createdAt).toLocaleString()}</td></tr>
            <tr><td>Last Incident Activity:</td><td>${new Date(report.lastReportedAt).toLocaleString()}</td></tr>
          </table>
          <h2 style="border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; color: #1e293b; font-size: 18px; margin-top: 24px;">Incident Forensics Evidence</h2>
          ${strikesHtml}
          <div style="margin-top: 35px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 14px;">
            Generated automatically by StudyMyte AI Threat Sentinel • BTKIT Dwarahat Campus Infrastructure
          </div>
        </div>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('PDF report generation error:', err);
    res.status(500).send('Error generating report document');
  }
});

// @route   POST /api/admin/security/telemetry
// @desc    Ingest client-side security tampering beacons (e.g., DevTools role elevation)
// @access  Authenticated user
router.post('/telemetry', async (req, res) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader) {
      return res.status(401).json({ success: false, message: 'Unauthorized telemetry' });
    }
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    // ADMIN & SUPERADMIN WHITELIST: Completely bypass telemetry strikes for authorized admins
    if (user.role === 'admin' || user.role === 'superadmin') {
      return res.json({ success: true, bypassed: true, message: 'Admin testing mode: Telemetry bypassed' });
    }

    const { type, details, payload } = req.body;
    const threat = {
      score: 9.0,
      category: type || 'CLIENT_CONSOLE_TAMPERING',
      reason: details || 'Attempted client-side parameter or role tampering via browser console / DevTools',
      flaggedPayload: payload || details || 'DevTools variable tampering'
    };

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    const { recordPlatformSecurityStrike } = require('../services/mytee/threatSentinelService');
    const strikeResult = await recordPlatformSecurityStrike(user, threat, {
      endpoint: '/client-telemetry',
      method: 'CONSOLE_TAMPER',
      clientIp
    });

    if (strikeResult.isBlocked) {
      return res.status(403).json({
        success: false,
        blocked: true,
        code: 'ACCOUNT_SECURITY_LOCKDOWN',
        strikeNumber: strikeResult.strikeNumber,
        threatCategory: strikeResult.threatCategory,
        message: `ACCOUNT LOCKED: ${threat.reason}`,
        banCount: strikeResult.banCount || 1,
        banDurationLabel: strikeResult.banDurationLabel,
        currentBanExpiresAt: strikeResult.currentBanExpiresAt,
        isPermanent: !strikeResult.currentBanExpiresAt
      });
    }

    return res.status(403).json({
      success: false,
      blocked: false,
      code: 'SECURITY_VIOLATION',
      strikeNumber: strikeResult.strikeNumber,
      threatCategory: strikeResult.threatCategory,
      threatScore: threat.score,
      message: `⚠️ Security Violation: ${threat.reason}. Strike ${strikeResult.strikeNumber}/3 logged.`,
      details: threat.category
    });
  } catch (err) {
    console.error('Telemetry report error:', err);
    res.status(500).json({ success: false, message: 'Telemetry error' });
  }
});

// @route   GET /api/admin/security/storage-stats
// @desc    Live Storage & Capacity Metrics for Cloudinary, MongoDB, and EmailJS
// @access  Super Admin only
router.get('/storage-stats', isSuperAdmin, async (req, res) => {
  // Prevent any caching on client or reverse proxies
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    // 1. MongoDB Database Metrics (Atlas M0 Free Tier)
    let mongoStats = {
      usedMB: 0,
      limitMB: 512,
      remainingMB: 512,
      usedPercent: 0,
      dataSizeMB: 0,
      indexSizeMB: 0,
      totalDocuments: 0,
      totalUsers: 0,
      totalFolders: 0,
      totalObjects: 0,
      approxUsersLeft: 0,
      approxNotesLeft: 0,
      status: 'operational'
    };

    try {
      const dbStats = await mongoose.connection.db.stats();
      const storageBytes = (dbStats.storageSize || 0) + (dbStats.indexSize || 0);
      const dataBytes = dbStats.dataSize || 0;
      const limitBytes = 512 * 1024 * 1024; // 512 MB Free Tier Atlas limit
      const remainingBytes = Math.max(0, limitBytes - storageBytes);

      const [totalDocs, totalUsers, totalFolders] = await Promise.all([
        Document.countDocuments().catch(() => 0),
        User.countDocuments().catch(() => 0),
        Folder.countDocuments().catch(() => 0)
      ]);

      const avgBytesPerUser = 2048; // ~2 KB per user profile record
      const avgBytesPerDoc = 5120; // ~5 KB per metadata document record

      mongoStats = {
        usedMB: Number((storageBytes / (1024 * 1024)).toFixed(2)),
        limitMB: 512,
        remainingMB: Number((remainingBytes / (1024 * 1024)).toFixed(2)),
        usedPercent: Number(((storageBytes / limitBytes) * 100).toFixed(1)),
        dataSizeMB: Number((dataBytes / (1024 * 1024)).toFixed(2)),
        indexSizeMB: Number(((dbStats.indexSize || 0) / (1024 * 1024)).toFixed(2)),
        totalDocuments: totalDocs,
        totalUsers: totalUsers,
        totalFolders: totalFolders,
        totalObjects: dbStats.objects || (totalDocs + totalUsers + totalFolders),
        approxUsersLeft: Math.floor(remainingBytes / avgBytesPerUser),
        approxNotesLeft: Math.floor(remainingBytes / avgBytesPerDoc),
        status: 'operational'
      };
    } catch (mErr) {
      console.error('[StorageStats] MongoDB stats error:', mErr.message);
      mongoStats.status = 'warning';
      mongoStats.error = mErr.message;
    }

    // 2. Cloudinary Storage Metrics (Live DB Aggregates + Cloudinary API Quota)
    let cloudinaryStats = {
      usedMB: 0,
      limitMB: 25600, // 25 GB = 25,600 MB
      remainingMB: 25600,
      usedPercent: 0,
      totalFiles: 0,
      liveDocCount: 0,
      liveDocStorageMB: 0,
      bandwidthUsedMB: 0,
      creditsUsed: 0,
      creditsLimit: 25,
      approxPdfsLeft: 0,
      avgPdfSizeMB: 2.5,
      status: 'operational'
    };

    try {
      // Query real-time document count and cumulative PDF bytes from MongoDB
      const docAggregate = await Document.aggregate([
        { $group: { _id: null, totalBytes: { $sum: '$fileSizeBytes' }, count: { $sum: 1 } } }
      ]).catch(() => []);
      const liveDocBytes = (docAggregate[0] && docAggregate[0].totalBytes) || 0;
      const liveDocCount = (docAggregate[0] && docAggregate[0].count) || 0;
      const liveDocMB = Number((liveDocBytes / (1024 * 1024)).toFixed(2));

      if (config.CLOUDINARY && config.CLOUDINARY.cloud_name) {
        const usage = await cloudinary.api.usage();
        const usedStorageBytes = (usage.storage && usage.storage.usage) ? usage.storage.usage : liveDocBytes;
        const totalStorageBytes = 25 * 1024 * 1024 * 1024; // 25 GB free tier limit
        const remainingStorageBytes = Math.max(0, totalStorageBytes - usedStorageBytes);

        const avgPdfBytes = 2.5 * 1024 * 1024; // ~2.5 MB average college lecture note PDF
        const approxPdfsLeft = Math.floor(remainingStorageBytes / avgPdfBytes);

        cloudinaryStats = {
          usedMB: Number((usedStorageBytes / (1024 * 1024)).toFixed(2)),
          limitMB: 25600,
          remainingMB: Number((remainingStorageBytes / (1024 * 1024)).toFixed(2)),
          usedPercent: Number(((usedStorageBytes / totalStorageBytes) * 100).toFixed(2)),
          totalFiles: (usage.objects && usage.objects.usage) || liveDocCount || usage.resources || 0,
          liveDocCount: liveDocCount,
          liveDocStorageMB: liveDocMB,
          bandwidthUsedMB: Number((((usage.bandwidth && usage.bandwidth.usage) || 0) / (1024 * 1024)).toFixed(2)),
          creditsUsed: Number(((usage.credits && usage.credits.usage) || 0).toFixed(2)),
          creditsLimit: (usage.credits && usage.credits.limit) || 25,
          approxPdfsLeft: approxPdfsLeft,
          avgPdfSizeMB: 2.5,
          status: 'operational'
        };
      } else {
        cloudinaryStats.status = 'not_configured';
      }
    } catch (cErr) {
      console.error('[StorageStats] Cloudinary error:', cErr.message);
      cloudinaryStats.status = 'error';
      cloudinaryStats.error = cErr.message;
    }

    // 3. EmailJS Delivery Metrics (Accurate Billing Cycle & Real-Time Dispatches)
    let emailStats = {
      monthlyLimit: 200, // EmailJS Free Tier monthly limit
      usedThisMonth: 1, // Default to 1 (verified from user's EmailJS dashboard)
      remainingThisMonth: 199,
      usedPercent: 0.5,
      approxOtpsLeft: 199,
      serviceId: config.EMAILJS && config.EMAILJS.SERVICE_ID ? 'Configured (' + config.EMAILJS.SERVICE_ID + ')' : 'Not Configured',
      resetDate: 'Dec 7, 2026',
      resetDay: 7,
      status: 'operational'
    };

    try {
      const now = new Date();
      // Load quota configuration from SystemSetting if present
      const quotaSetting = await SystemSetting.findOne({ key: 'emailjs_quota_config' }).lean().catch(() => null);
      const resetDay = (quotaSetting && quotaSetting.value && quotaSetting.value.resetDay) ? quotaSetting.value.resetDay : 7;
      const baseCount = (quotaSetting && quotaSetting.value && typeof quotaSetting.value.baseCount === 'number')
        ? quotaSetting.value.baseCount
        : 1; // Default to 1 to match EmailJS dashboard

      // Calculate current cycle start and next reset date
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const currentDay = now.getDate();

      let cycleStart;
      let nextReset;

      if (currentDay >= resetDay) {
        cycleStart = new Date(currentYear, currentMonth, resetDay, 0, 0, 0, 0);
        nextReset = new Date(currentYear, currentMonth + 1, resetDay, 0, 0, 0, 0);
      } else {
        cycleStart = new Date(currentYear, currentMonth - 1, resetDay, 0, 0, 0, 0);
        nextReset = new Date(currentYear, currentMonth, resetDay, 0, 0, 0, 0);
      }

      // Count dispatches recorded in current cycle
      const baseCycleDate = (quotaSetting && quotaSetting.value && quotaSetting.value.lastSyncedAt)
        ? new Date(quotaSetting.value.lastSyncedAt)
        : cycleStart;
      const effectiveSince = baseCycleDate > cycleStart ? baseCycleDate : cycleStart;

      const loggedDispatches = await EmailDispatchLog.countDocuments({
        sentAt: { $gte: effectiveSince },
        status: 'sent'
      }).catch(() => 0);

      const totalUsed = baseCount + loggedDispatches;
      const remainingEmails = Math.max(0, 200 - totalUsed);
      const usedPercent = Number(((totalUsed / 200) * 100).toFixed(1));

      const resetDateFormatted = nextReset.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });

      emailStats = {
        monthlyLimit: 200,
        usedThisMonth: totalUsed,
        remainingThisMonth: remainingEmails,
        usedPercent: usedPercent,
        approxOtpsLeft: remainingEmails,
        serviceId: config.EMAILJS && config.EMAILJS.SERVICE_ID ? 'Configured (' + config.EMAILJS.SERVICE_ID + ')' : 'Not Configured',
        resetDate: resetDateFormatted,
        resetDay: resetDay,
        status: 'operational'
      };
    } catch (eErr) {
      console.error('[StorageStats] EmailJS count error:', eErr.message);
      emailStats.status = 'warning';
      emailStats.error = eErr.message;
    }

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      superAdminAuthorized: true,
      data: {
        mongodb: mongoStats,
        cloudinary: cloudinaryStats,
        emailjs: emailStats
      }
    });
  } catch (err) {
    console.error('Storage stats route error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve storage telemetry: ' + err.message });
  }
});

// @route   POST /api/admin/security/emailjs-sync
// @desc    Sync or set the current EmailJS requests count & billing reset day
// @access  Super Admin only
router.post('/emailjs-sync', isSuperAdmin, async (req, res) => {
  try {
    const { requestsReceived, baseCount, resetDay } = req.body;
    const countToParse = requestsReceived !== undefined ? requestsReceived : baseCount;
    const parsedCount = parseInt(countToParse, 10);
    const parsedDay = parseInt(resetDay, 10);

    if (isNaN(parsedCount) || parsedCount < 0) {
      return res.status(400).json({ success: false, message: 'Invalid requests count' });
    }

    const value = {
      baseCount: parsedCount,
      resetDay: !isNaN(parsedDay) && parsedDay >= 1 && parsedDay <= 28 ? parsedDay : 7,
      lastSyncedAt: new Date()
    };

    await SystemSetting.findOneAndUpdate(
      { key: 'emailjs_quota_config' },
      { key: 'emailjs_quota_config', value },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: 'EmailJS quota synchronized successfully',
      data: value
    });
  } catch (err) {
    console.error('[StorageStats] EmailJS sync error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to sync EmailJS quota: ' + err.message });
  }
});

module.exports = router;

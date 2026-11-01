/**
 * MYTEE Audit Logger
 * Records administrative operations, ticket escalations, and security events.
 */

const { MyteeAuditLog } = require('../../db/models');

/**
 * Logs an administrative or sensitive action.
 */
async function logAction({ adminUser, action, target = '', details = {}, ip = 'Unknown' }) {
  try {
    if (!adminUser || !action) return;

    const entry = new MyteeAuditLog({
      adminUserId: adminUser._id || adminUser.id,
      adminName: adminUser.name || 'Admin',
      action,
      target,
      details,
      ip
    });

    await entry.save();
  } catch (err) {
    console.error('[MyteeAuditLogger] Failed to write audit log:', err.message);
  }
}

/**
 * Retrieves recent audit logs for Super Admin / Admin review.
 */
async function getRecentAuditLogs(limit = 50) {
  try {
    return await MyteeAuditLog.find()
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .populate('adminUserId', 'name role email phone')
      .lean();
  } catch (err) {
    console.error('[MyteeAuditLogger] Failed to read audit logs:', err.message);
    return [];
  }
}

module.exports = {
  logAction,
  getRecentAuditLogs
};


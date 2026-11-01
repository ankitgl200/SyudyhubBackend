/**
 * MYTEE Rate Limiting Middleware
 * Multi-tiered sliding window rate limiting for students, guests, support escalation, and admins.
 */

const config = require('../config');

// In-memory window stores
const minStores = new Map();
const dayStores = new Map();
const ticketStores = new Map();

// Periodic cleanup every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of minStores.entries()) {
    if (now - v.startTime > 60 * 1000) minStores.delete(k);
  }
  for (const [k, v] of dayStores.entries()) {
    if (now - v.startTime > 24 * 60 * 60 * 1000) dayStores.delete(k);
  }
  for (const [k, v] of ticketStores.entries()) {
    if (now - v.startTime > 60 * 60 * 1000) ticketStores.delete(k);
  }
}, 10 * 60 * 1000).unref();

function getClientKey(req) {
  if (req.user && req.user.id) {
    return `user:${req.user.id}`;
  }
  return `ip:${req.ip || req.socket?.remoteAddress || 'unknown-ip'}`;
}

/**
 * MYTEE Chat Rate Limiter (enforces both per-minute and per-day caps).
 */
function myteeChatLimiter(req, res, next) {
  const isAuth = !!(req.user && req.user.id);
  const isAdminUser = req.user && (req.user.role === 'admin' || req.user.role === 'superadmin');

  // Derive limits based on role
  let maxPerMin = isAuth ? config.MYTEE.STUDENT_RATE_LIMIT_MIN : config.MYTEE.GUEST_RATE_LIMIT_MIN;
  let maxPerDay = isAuth ? config.MYTEE.STUDENT_RATE_LIMIT_DAY : config.MYTEE.GUEST_RATE_LIMIT_DAY;

  if (isAdminUser) {
    maxPerMin = config.MYTEE.ADMIN_RATE_LIMIT_MIN;
    maxPerDay = maxPerDay * 5; // Generous admin quota
  }

  const key = getClientKey(req);
  const now = Date.now();

  // 1. Minute check
  let minRecord = minStores.get(key);
  if (!minRecord || (now - minRecord.startTime > 60 * 1000)) {
    minRecord = { count: 1, startTime: now };
    minStores.set(key, minRecord);
  } else {
    minRecord.count += 1;
  }

  // 2. Day check
  let dayRecord = dayStores.get(key);
  if (!dayRecord || (now - dayRecord.startTime > 24 * 60 * 60 * 1000)) {
    dayRecord = { count: 1, startTime: now };
    dayStores.set(key, dayRecord);
  } else {
    dayRecord.count += 1;
  }

  res.setHeader('X-RateLimit-Limit-Minute', maxPerMin);
  res.setHeader('X-RateLimit-Remaining-Minute', Math.max(0, maxPerMin - minRecord.count));
  res.setHeader('X-RateLimit-Limit-Day', maxPerDay);
  res.setHeader('X-RateLimit-Remaining-Day', Math.max(0, maxPerDay - dayRecord.count));

  if (minRecord.count > maxPerMin) {
    return res.status(429).json({
      success: false,
      message: `You are sending messages too quickly. Please wait a minute before asking MYTEE again.`,
      retryAfterSec: Math.ceil((minRecord.startTime + 60000 - now) / 1000)
    });
  }

  if (dayRecord.count > maxPerDay) {
    return res.status(429).json({
      success: false,
      message: `Daily MYTEE AI limit reached (${maxPerDay} requests/day). Please try again tomorrow.`,
      retryAfterSec: Math.ceil((dayRecord.startTime + 86400000 - now) / 1000)
    });
  }

  next();
}

/**
 * Support Ticket Submission Rate Limiter (Max 3 / hour per user/IP).
 */
function myteeTicketLimiter(req, res, next) {
  const key = `tkt:${getClientKey(req)}`;
  const now = Date.now();
  const maxPerHour = config.MYTEE.TICKET_RATE_LIMIT_HOUR || 3;

  let record = ticketStores.get(key);
  if (!record || (now - record.startTime > 60 * 60 * 1000)) {
    record = { count: 1, startTime: now };
    ticketStores.set(key, record);
  } else {
    record.count += 1;
  }

  if (record.count > maxPerHour) {
    return res.status(429).json({
      success: false,
      message: `Support ticket limit exceeded. You can submit up to ${maxPerHour} tickets per hour to prevent spam.`,
      retryAfterSec: Math.ceil((record.startTime + 3600000 - now) / 1000)
    });
  }

  next();
}

module.exports = {
  myteeChatLimiter,
  myteeTicketLimiter,
  getClientKey
};


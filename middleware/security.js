const config = require('../config');

// In-memory sliding window rate limiter
const rateLimitStores = new Map();

/**
 * Creates an in-memory rate limiting middleware.
 *
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Max requests allowed per window per key
 * @param {string} options.message - Error message when limit is exceeded
 * @param {Function} [options.keyGenerator] - Function to derive key from req (defaults to IP)
 */
function createRateLimiter({ windowMs, max, message, keyGenerator }) {
  const store = new Map();

  // Periodic cleanup of stale window entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store.entries()) {
      if (now - record.startTime > windowMs) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref(); // unref so timer doesn't keep node process open in tests

  return (req, res, next) => {
    const key = keyGenerator 
      ? keyGenerator(req) 
      : (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown-ip';

    const now = Date.now();
    let record = store.get(key);

    if (!record || (now - record.startTime > windowMs)) {
      record = { count: 1, startTime: now };
      store.set(key, record);
    } else {
      record.count += 1;
    }

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil((record.startTime + windowMs) / 1000));

    if (record.count > max) {
      console.warn(`[Security Alert] Rate limit exceeded for key [${key}] on route ${req.method} ${req.originalUrl}`);
      return res.status(429).json({
        success: false,
        message: message || 'Too many requests. Please slow down and try again later.'
      });
    }

    next();
  };
}

/**
 * Production Security Headers Middleware.
 * Protects against MIME-sniffing, clickjacking, and enforces strict transport security.
 */
function securityHeaders(req, res, next) {
  // Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent Clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), payment=()');

  // Strict Transport Security (HSTS) when on HTTPS
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

/**
 * Strict CORS origin validator.
 * Rejects unauthorized origins from reading API responses.
 */
function strictCors(req, res, next) {
  const origin = req.headers.origin;
  const allowed = config.SECURITY.ALLOWED_ORIGINS;

  // Allow requests without Origin (e.g. mobile apps, curl, server-to-server, same-origin static files)
  if (!origin) {
    return next();
  }

  if (allowed.includes(origin) || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight 24h

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  }

  // Reject unauthorized origin for API requests
  if (req.path.startsWith('/api/')) {
    console.warn(`[Security Alert] Blocked cross-origin request from unauthorized origin: ${origin}`);
    return res.status(403).json({ message: 'Cross-Origin Request Blocked by Security Policy' });
  }

  next();
}

// Pre-configured Rate Limiters
const otpRequestLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many OTP requests from this IP. Please try again after 15 minutes.'
});

const otpVerifyLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many verification attempts from this IP. Please try again later.'
});

const authGeneralLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many authentication attempts. Please try again later.'
});

module.exports = {
  createRateLimiter,
  securityHeaders,
  strictCors,
  otpRequestLimiter,
  otpVerifyLimiter,
  authGeneralLimiter
};

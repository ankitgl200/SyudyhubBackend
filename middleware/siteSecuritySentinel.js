/**
 * =========================================================================
 * StudyMyte — Site-Wide Security Sentinel (Autonomous WAF & Telemetry Engine)
 * =========================================================================
 * Protects StudyMyte from non-AI attacks:
 * 1. SQL & NoSQL Injections ($where, $regex, union select, ' or 1=1)
 * 2. XSS & HTML Injections (<script>, onerror=, javascript:, document.cookie)
 * 3. Path Traversal & LFI (../, /etc/passwd, win.ini, .env)
 * 4. Burp Suite & Request Tampering (Forging role: 'admin', isApproved: true)
 * 5. DDoS & Rapid Burst Scanners (>45 requests in 5 seconds)
 * 
 * Automatically scores threats (0-10), issues 3-strike escalation, logs
 * forensic dossiers to the Admin Dashboard, and locks down compromised accounts.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { User } = require('../db/models');
const { recordPlatformSecurityStrike } = require('../services/mytee/threatSentinelService');

// In-memory sliding window for DDoS / rapid burst scanning detection
const requestTracker = new Map(); // ip -> [timestamps]

// Cleanup rate-limit memory periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of requestTracker.entries()) {
    const fresh = timestamps.filter(t => now - t < 10000);
    if (fresh.length === 0) {
      requestTracker.delete(ip);
    } else {
      requestTracker.set(ip, fresh);
    }
  }
}, 30000);

// Attack detection signatures
const XSS_PATTERNS = [
  /<script\b[^>]*>[\s\S]*?<\/script>/i,
  /<script\b/i,
  /javascript:\s*[a-z0-9_]/i,
  /<(img|svg|iframe|body|input|audio|video|details|object|embed)\b[^>]*\b(onerror|onload|onclick|onmouseover|onfocus|onblur)\s*=/i,
  /document\.(cookie|location|domain)/i,
  /<iframe\b|<embed\b|<object\b/i
];

const SQLI_PATTERNS = [
  /\bunion\b\s+\bselect\b/i,
  /\bselect\b\s+.*\s+\bfrom\b/i,
  /('|\")\s*or\s*('1'\s*=\s*'1'|1\s*=\s*1)/i,
  /('|\")\s*and\s*('1'\s*=\s*'1'|1\s*=\s*1)/i,
  /--\s*$/m,
  /\bdrop\s+table\b/i,
  /\binsert\s+into\b/i
];

const NOSQLI_PATTERNS = [
  /\$(\bwhere\b|\bregex\b|\bgt\b|\bgte\b|\blt\b|\blte\b|\bne\b|\bnin\b|\bexists\b)/i
];

const TRAVERSAL_PATTERNS = [
  /(\.\.[\/\\]){2,}/,
  /\/etc\/passwd/i,
  /windows\/win\.ini/i,
  /\.env\b/i,
  /boot\.ini/i
];

// Burp Suite Collaborator & Out-of-band OAST exploitation patterns
const COLLABORATOR_PATTERNS = [
  /burpcollaborator\.net/i,
  /oastify\.com/i,
  /interact\.sh/i,
  /bxss\.me/i
];

// Automated hacking tools and scanner User-Agents
const SCANNER_USER_AGENTS = [
  /\bsqlmap\b/i,
  /\bnikto\b/i,
  /\bdirbuster\b/i,
  /\bgobuster\b/i,
  /\bwfuzz\b/i,
  /\bacunetix\b/i,
  /\bhavij\b/i,
  /\bburpcollaborator\b/i,
  /\barachni\b/i,
  /\bnessus\b/i
];

function inspectValueForThreat(val, path = '') {
  if (val === null || val === undefined) return null;

  if (typeof val === 'string') {
    // 1. Check Path Traversal
    for (const p of TRAVERSAL_PATTERNS) {
      if (p.test(val)) {
        return {
          score: 8.5,
          category: 'PATH_TRAVERSAL_ATTACK',
          reason: `Path traversal or system file inclusion detected in [${path}]`,
          flaggedPayload: val.slice(0, 300)
        };
      }
    }

    // 2. Check XSS / HTML Injection
    for (const p of XSS_PATTERNS) {
      if (p.test(val)) {
        return {
          score: 8.0,
          category: 'XSS_HTML_INJECTION',
          reason: `Cross-site scripting (XSS) or HTML script payload detected in [${path}]`,
          flaggedPayload: val.slice(0, 300)
        };
      }
    }

    // 3. Check SQL Injection
    for (const p of SQLI_PATTERNS) {
      if (p.test(val)) {
        return {
          score: 8.5,
          category: 'SQL_INJECTION_PROBE',
          reason: `Structured SQL injection payload detected in [${path}]`,
          flaggedPayload: val.slice(0, 300)
        };
      }
    }

    // 4. Check stringified NoSQL injection
    for (const p of NOSQLI_PATTERNS) {
      if (p.test(val)) {
        return {
          score: 8.5,
          category: 'NOSQL_INJECTION_PROBE',
          reason: `NoSQL MongoDB injection operator detected in [${path}]`,
          flaggedPayload: val.slice(0, 300)
        };
      }
    }

    // 5. Check Burp Collaborator / Out-of-band SSRF payloads
    for (const cp of COLLABORATOR_PATTERNS) {
      if (cp.test(val)) {
        return {
          score: 9.5,
          category: 'BURP_COLLABORATOR_EXPLOIT',
          reason: `Out-of-band Burp Collaborator / SSRF payload detected in [${path}]`,
          flaggedPayload: val.slice(0, 300)
        };
      }
    }
  } else if (typeof val === 'object') {
    // Object key check (e.g. { "$gt": "" } or { "$where": "..." })
    for (const key of Object.keys(val)) {
      if (key.startsWith('$')) {
        return {
          score: 9.0,
          category: 'NOSQL_OBJECT_INJECTION',
          reason: `Direct MongoDB operator injection object [${key}] detected in [${path}]`,
          flaggedPayload: JSON.stringify(val).slice(0, 300)
        };
      }
      const deep = inspectValueForThreat(val[key], path ? `${path}.${key}` : key);
      if (deep) return deep;
    }
  }

  return null;
}

/**
 * Express Middleware: Autonomous Site-Wide Security Sentinel
 */
async function siteSecuritySentinel(req, res, next) {
  const urlPath = req.path || '';

  // 1. Bypass static files, health checks, and public downloads
  if (
    urlPath.startsWith('/uploads') ||
    urlPath.startsWith('/public') ||
    urlPath === '/health' ||
    /\.(css|js|png|jpe?g|svg|ico|woff2?|map)$/i.test(urlPath)
  ) {
    return next();
  }

  // 1.5. ADMIN & SUPERADMIN WHITELIST: Bypass security inspections for authorized site testing & audits
  const authHeader = req.header('Authorization');
  const token = (authHeader && authHeader.startsWith('Bearer '))
    ? authHeader.slice(7)
    : req.query?.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      if (decoded && (decoded.role === 'admin' || decoded.role === 'superadmin')) {
        return next(); // Verified Admin or Superadmin testing bypass
      }
    } catch (e) {
      // Invalid/expired token, proceed to standard sentinel inspection
    }
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
  const now = Date.now();

  // 2. DDoS & Rapid Burst Scanner Detection (Sliding 5-second window)
  if (!requestTracker.has(clientIp)) {
    requestTracker.set(clientIp, []);
  }
  const timestamps = requestTracker.get(clientIp);
  timestamps.push(now);
  const recentWindow = timestamps.filter(t => now - t < 5000);
  requestTracker.set(clientIp, recentWindow);

  let detectedThreat = null;

  if (recentWindow.length > 50) {
    detectedThreat = {
      score: 7.5,
      category: 'DDOS_BURST_SCANNER',
      reason: `Automated high-velocity request burst (${recentWindow.length} reqs / 5s)`,
      flaggedPayload: `Client IP ${clientIp} flooded ${recentWindow.length} requests in 5 seconds to ${urlPath}`
    };
  }

  // 2.5 Inspect Scanner User-Agents & Tools
  if (!detectedThreat) {
    const userAgent = req.headers['user-agent'] || '';
    for (const uaPattern of SCANNER_USER_AGENTS) {
      if (uaPattern.test(userAgent)) {
        detectedThreat = {
          score: 9.0,
          category: 'AUTOMATED_SECURITY_SCANNER',
          reason: `Automated vulnerability scanner/tool signature detected in User-Agent: ${userAgent.slice(0, 80)}`,
          flaggedPayload: `User-Agent: ${userAgent}`
        };
        break;
      }
    }
  }

  // 3. Inspect Query Parameters
  if (!detectedThreat && req.query && typeof req.query === 'object') {
    detectedThreat = inspectValueForThreat(req.query, 'query');
  }

  // 4. Inspect Request Body (Forms, Reviews, Profile updates, JSON payloads)
  if (!detectedThreat && req.body && typeof req.body === 'object') {
    detectedThreat = inspectValueForThreat(req.body, 'body');

    // 5. Burp Suite Parameter Tampering: Unauthorized Role Elevation
    // Attacker modifies request body to elevate role (e.g., role: 'admin' or isApproved: true)
    if (!detectedThreat) {
      const hasPrivilegedRole = req.body.role === 'admin' || req.body.role === 'superadmin';
      const hasPrivilegedApproval = req.body.isApproved === true || req.body.isApproved === 'true';

      // If updating profile or registering, and injecting role: 'admin'
      const isSensitiveEndpoint = urlPath.includes('/auth/register') || urlPath.includes('/profile') || urlPath.includes('/users');
      if (isSensitiveEndpoint && (hasPrivilegedRole || hasPrivilegedApproval)) {
        // Check if caller is already authorized superadmin
        let callerIsSuperAdmin = false;
        const authHeader = req.header('Authorization');
        if (authHeader) {
          try {
            const token = authHeader.replace('Bearer ', '');
            const decoded = jwt.verify(token, config.JWT_SECRET);
            if (decoded && decoded.role === 'superadmin') callerIsSuperAdmin = true;
          } catch (e) {}
        }

        if (!callerIsSuperAdmin) {
          detectedThreat = {
            score: 9.0,
            category: 'BURP_ROLE_FORGERY',
            reason: `Attempted unauthorized privilege escalation (injected role='${req.body.role}' or isApproved=true)`,
            flaggedPayload: JSON.stringify({ role: req.body.role, isApproved: req.body.isApproved })
          };
        }
      }
    }
  }

  // If no threat found, proceed to normal application route
  if (!detectedThreat) {
    return next();
  }

  // 6. Threat Identified! Extract user identity from token if available
  let user = null;
  const userToken = token || req.header('Authorization')?.replace('Bearer ', '') || req.query?.token;
  if (userToken) {
    try {
      const decoded = jwt.verify(userToken, config.JWT_SECRET);
      if (decoded && decoded.id) {
        user = await User.findById(decoded.id);
      }
    } catch (e) {}
  }

  // If user is authenticated, log strike and enforce 3-strike escalation
  if (user) {
    try {
      const strikeResult = await recordPlatformSecurityStrike(user, detectedThreat, {
        endpoint: urlPath,
        method: req.method,
        clientIp
      });

      res.setHeader('X-Security-Strike', strikeResult.strikeNumber);

      if (strikeResult.isBlocked) {
        return res.status(403).json({
          success: false,
          blocked: true,
          code: 'ACCOUNT_SECURITY_LOCKDOWN',
          strikeNumber: strikeResult.strikeNumber,
          threatCategory: strikeResult.threatCategory,
          message: `ACCOUNT LOCKED: Excessive security violations (${detectedThreat.reason}). Your account has been suspended by the Security Sentinel.`,
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
        threatScore: detectedThreat.score,
        message: `⚠️ Security Violation Detected: ${detectedThreat.reason}. (Strike ${strikeResult.strikeNumber}/3). Continued tampering will trigger an automatic account lockout.`,
        details: detectedThreat.category
      });
    } catch (err) {
      console.error('[SiteSecuritySentinel] Strike logging error:', err);
    }
  }

  // Unauthenticated guest attack
  return res.status(403).json({
    success: false,
    code: 'SECURITY_VIOLATION',
    message: `Forbidden: Malicious activity or parameter tampering detected (${detectedThreat.reason}). Access blocked by StudyMyte Threat Sentinel.`
  });
}

module.exports = siteSecuritySentinel;


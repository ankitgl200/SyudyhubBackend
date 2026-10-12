const jwt = require('jsonwebtoken');
const config = require('../config');
const { User } = require('../db/models');

function parseUserAgent(userAgent, ip = 'Unknown') {
  let browser = 'Unknown';
  let os = 'Unknown';
  let deviceType = 'Desktop';
  let deviceModel = 'Unknown';

  if (!userAgent) {
    return { browser, os, deviceType, deviceModel, ip };
  }

  // Detect OS
  if (/windows/i.test(userAgent)) {
    os = 'Windows';
  } else if (/android/i.test(userAgent)) {
    os = 'Android';
    deviceType = 'Mobile';
    // Try to extract Android device model
    const match = userAgent.match(/Android\s+[^;]+;\s+([^;)]+)/);
    if (match && match[1]) {
      deviceModel = match[1].trim();
    }
  } else if (/ipad|iphone|ipod/i.test(userAgent)) {
    os = 'iOS';
    deviceType = /ipad/i.test(userAgent) ? 'Tablet' : 'Mobile';
    deviceModel = /ipad/i.test(userAgent) ? 'iPad' : 'iPhone';
  } else if (/macintosh|mac os x/i.test(userAgent)) {
    os = 'macOS';
  } else if (/linux/i.test(userAgent)) {
    os = 'Linux';
  }

  // Detect Browser
  if (/edg/i.test(userAgent)) {
    browser = 'Edge';
  } else if (/chrome|crios/i.test(userAgent)) {
    browser = 'Chrome';
  } else if (/firefox|fxios/i.test(userAgent)) {
    browser = 'Firefox';
  } else if (/safari/i.test(userAgent) && !/chrome|crios/i.test(userAgent)) {
    browser = 'Safari';
  } else if (/opr\//i.test(userAgent)) {
    browser = 'Opera';
  }

  return { browser, os, deviceType, deviceModel, ip };
}

async function auth(req, res, next) {
  // Get token from header or query param
  let token = '';
  const authHeader = req.header('Authorization');
  if (authHeader) {
    token = authHeader.replace('Bearer ', '');
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    req.user = decoded;

    // Check if the user still exists and is approved
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    if (!user.approved) {
      return res.status(403).json({ message: 'Your account is pending admin approval' });
    }

    // Update lastActive timestamp periodically (throttle to once per minute)
    const now = new Date();
    if (!user.lastActive || (now - new Date(user.lastActive)) > 60000) {
      const userAgent = req.headers['user-agent'] || '';
      const clientIp = req.ip || req.socket?.remoteAddress || 'Unknown';
      user.lastActive = now;
      user.deviceInfo = parseUserAgent(userAgent, clientIp);
      await user.save();
    }

    // Attach updated database fields
    req.user.role = user.role;
    req.user.approved = user.approved;
    req.user.name = user.name;
    req.user.phone = user.phone;

    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
}

// Middleware to check if user has admin privileges
function isAdmin(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied: Admin privileges required' });
    }
    next();
  });
}

// Middleware to check if user has superadmin privileges
function isSuperAdmin(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied: Super Admin privileges required' });
    }
    next();
  });
}

// Middleware to check if user has teacher/educator or admin/superadmin privileges
function isStaff(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'educator' && req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied: Teacher or Admin privileges required' });
    }
    next();
  });
}

module.exports = {
  auth,
  isAdmin,
  isSuperAdmin,
  isStaff
};

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, Document, Notification, OtpVerification, PasswordResetOtp } = require('../db/models');
const config = require('../config');
const { auth, isAdmin, isSuperAdmin } = require('../middleware/auth');
const { sendOtpEmail, maskEmail } = require('../services/emailService');
const { otpRequestLimiter, otpVerifyLimiter } = require('../middleware/security');

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

// @route   POST api/auth/signup
// @desc    Register user (instant approval for student, admin approval for educator/admin)
router.post('/signup', async (req, res) => {
  const { name, phone, email, password, role } = req.body;

  // Simple validation
  if (!name || !phone || !password || !role) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  // Proper email validation
  if (!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim())) {
    return res.status(400).json({ message: 'Please enter a valid email address' });
  }

  // Check if role is valid
  if (!['student', 'educator', 'admin'].includes(role)) {
    return res.status(400).json({ message: 'Invalid user role selection' });
  }

  try {
    // Check for existing phone
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this phone number already exists' });
    }

    // Check for existing email
    const normalizedEmail = email.trim().toLowerCase();
    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Students are approved automatically. Educators & Admins require admin approval.
    const approved = role === 'student';

    const newUser = new User({
      name,
      phone,
      email: normalizedEmail,
      password: hashedPassword,
      role,
      approved
    });
    
    await newUser.save();

    // Create welcome notification
    let welcomeMsg = '';
    if (role === 'student') {
      welcomeMsg = `Welcome to StudyHub! 📚\nExplore notes, papers, and resources to boost your learning. Stay consistent and keep growing! 🚀\n\n📌 Note: A PDF User Manual has been automatically downloaded to guide you through all of StudyHub's features. If the manual did not download automatically, you can download it manually at any time:\n👉 On PC: Click your name in the top-right corner to open the dropdown and click "Download Manual".\n👉 On Mobile: Go to the "Profile" tab, scroll down to the "Account" section, and tap "Download Manual".\n\nThank you\nTeam Studyhub.`;
    } else if (role === 'educator') {
      welcomeMsg = `Dear Sir/Ma’am,\n\nWe warmly welcome you to our platform as an educator and sincerely thank you for joining us. Your presence and experience will greatly benefit our student community.\n\nWe kindly request you to upload any resources you have, such as notes, previous year questions, or lab manuals, which can help students in their learning journey.\n\n📌 Note: A PDF User Manual has been automatically downloaded to guide you through all of StudyHub's features. If the manual did not download automatically, you can download it manually at any time:\n👉 On PC: Click your name in the top-right corner to open the dropdown and click "Download Manual".\n👉 On Mobile: Go to the "Profile" tab, scroll down to the "Account" section, and tap "Download Manual".\n\nIn case you face any issues while using the platform or otherwise, please feel free to use the Help & Support page—we are always here to assist you.\n\nThank you once again for being a valuable part of our initiative.\n\nThank you\nTeam Studyhub`;
    } else if (role === 'admin') {
      welcomeMsg = `Welcome Admin! ⚙️\n\nYou have full control to manage content, users, and keep StudyHub running smoothly. Let’s build something impactful! 🚀\n\n📌 Note: A PDF User Manual has been automatically downloaded to guide you through all of StudyHub's features. If the manual did not download automatically, you can download it manually at any time:\n👉 On PC: Click your name in the top-right corner to open the dropdown and click "Download Manual".\n👉 On Mobile: Go to the "Profile" tab, scroll down to the "Account" section, and tap "Download Manual".\n\nThank you\nTeam Studyhub`;
    }

    if (welcomeMsg) {
      const welcomeNotification = new Notification({
        recipientId: newUser._id,
        message: welcomeMsg,
        rawMessage: welcomeMsg
      });
      await welcomeNotification.save();
    }

    if (!approved) {
      return res.status(201).json({
        message: 'Registration successful! Your account is pending admin approval before you can log in.',
        requiresApproval: true
      });
    }

    // Sign JWT for students (never expires)
    const token = jwt.sign(
      { id: newUser._id, role: newUser.role, approved: newUser.approved },
      config.JWT_SECRET
    );

    res.status(201).json({
      token,
      isNewUser: true,
      user: {
        id: newUser._id,
        name: newUser.name,
        phone: newUser.phone,
        email: newUser.email,
        role: newUser.role,
        approved: newUser.approved
      }
    });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST api/auth/login
// @desc    Authenticate user & get token
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;

  // Simple validation
  if (!phone || !password) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  try {
    // Check for existing user
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check if approved
    if (!user.approved) {
      return res.status(403).json({ message: 'Your account is pending admin approval' });
    }

    // Sign JWT (never expires)
    const token = jwt.sign(
      { id: user._id, role: user.role, approved: user.approved },
      config.JWT_SECRET
    );

    // Update login timestamps and device info
    const userAgent = req.headers['user-agent'] || '';
    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'Unknown';
    
    const isNewUser = !user.lastLogin;
    user.lastLogin = new Date();
    user.lastActive = new Date();
    user.deviceInfo = parseUserAgent(userAgent, clientIp);
    
    await user.save();

    res.json({
      token,
      isNewUser,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email || null,
        role: user.role,
        approved: user.approved
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET api/auth/me
// @desc    Get current user profile
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      id: user._id,
      name: user.name,
      phone: user.phone,
      email: user.email || null,
      role: user.role,
      approved: user.approved
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET api/auth/pending
// @desc    Get all users pending approval (Admin only)
router.get('/pending', isAdmin, async (req, res) => {
  try {
    const pendingUsers = await User.find({ approved: false }).select('-password');
    res.json(pendingUsers.map(u => ({
      id: u._id,
      name: u.name,
      phone: u.phone,
      email: u.email || null,
      role: u.role,
      approved: u.approved,
      createdAt: u.createdAt
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error loading pending list' });
  }
});

// @route   POST api/auth/approve/:id
// @desc    Approve a pending registration (Admin only)
router.post('/approve/:id', isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const updated = await User.findByIdAndUpdate(userId, { approved: true }, { new: true });
    
    if (!updated) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ message: `Approved user ${updated.name}`, userId });
  } catch (err) {
    res.status(500).json({ message: 'Server error during approval' });
  }
});

// @route   POST api/auth/reject/:id
// @desc    Reject and delete a pending registration (Admin only)
router.post('/reject/:id', isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const deleted = await User.findByIdAndDelete(userId);
    
    if (!deleted) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Clean up notifications for rejected user
    await Notification.deleteMany({ recipientId: userId });
    
    res.json({ message: `Rejected and removed user account`, userId });
  } catch (err) {
    res.status(500).json({ message: 'Server error during rejection' });
  }
});

// @route   GET api/auth/users
// @desc    Get all registered users (Admin only)
router.get('/users', isAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    const result = [];
    for (const u of users) {
      let points = undefined;
      if (u.role === 'educator') {
        const uploadsCount = await Document.countDocuments({ uploadedByUserId: u._id });
        const docs = await Document.find({ uploadedByUserId: u._id });
        let likesCount = 0;
        docs.forEach(doc => {
          if (doc.likes) likesCount += doc.likes.length;
        });
        points = uploadsCount + (likesCount * 2);
      }
      result.push({
        id: u._id,
        name: u.name,
        phone: u.phone,
        email: u.email || null,
        role: u.role,
        approved: u.approved,
        points,
        lastLogin: u.lastLogin,
        lastActive: u.lastActive,
        deviceInfo: u.deviceInfo || { browser: 'Unknown', os: 'Unknown', deviceType: 'Unknown', deviceModel: 'Unknown', ip: 'Unknown' },
        createdAt: u.createdAt
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE api/auth/users/:id
// @desc    Delete any user (Super Admin can delete anyone, Admin can only delete students)
router.delete('/users/:id', isAdmin, async (req, res) => {
  const userId = req.params.id;

  try {
    const userToDelete = await User.findById(userId);
    if (!userToDelete) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Permanent Super Admin protection
    if (userToDelete.phone === '8218325600') {
      return res.status(400).json({ message: 'Cannot delete the primary Super Admin account' });
    }

    // Can't delete self
    if (userId === req.user.id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    // Staff (educators, admins, superadmins) can only be deleted by Super Admins
    if (['admin', 'superadmin', 'educator'].includes(userToDelete.role)) {
      if (req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'Access denied: Only Super Admin can delete admin or teacher accounts' });
      }
    }

    await User.findByIdAndDelete(userId);
    // Clean up notifications for deleted user
    await Notification.deleteMany({ recipientId: userId });
    
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST api/auth/promote/:id
// @desc    Promote an Admin to Super Admin (Super Admin only)
router.post('/promote/:id', isSuperAdmin, async (req, res) => {
  const targetId = req.params.id;

  try {
    const userToPromote = await User.findById(targetId);
    if (!userToPromote) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (userToPromote.role !== 'admin') {
      return res.status(400).json({ message: 'Only Admin accounts can be promoted to Super Admin' });
    }

    const updated = await User.findByIdAndUpdate(targetId, { role: 'superadmin' }, { new: true });
    res.json({ message: `Successfully promoted ${updated.name} to Super Admin`, userId: targetId });
  } catch (err) {
    res.status(500).json({ message: 'Server error promoting user' });
  }
});

// @route   GET api/auth/teachers/ranking
// @desc    Get all enrolled teachers with ranks and points (requires auth)
router.get('/teachers/ranking', auth, async (req, res) => {
  try {
    const teachers = await User.find({ role: 'educator', approved: true }).select('name phone createdAt');
    const rankingList = [];

    for (const t of teachers) {
      const uploadsCount = await Document.countDocuments({ uploadedByUserId: t._id });
      const docs = await Document.find({ uploadedByUserId: t._id });
      let likesCount = 0;
      docs.forEach(doc => {
        if (doc.likes) likesCount += doc.likes.length;
      });

      const points = uploadsCount + (likesCount * 2);
      rankingList.push({
        id: t._id,
        name: t.name,
        phone: t.phone,
        uploads: uploadsCount,
        likes: likesCount,
        points,
        createdAt: t.createdAt
      });
    }

    // Sort by points descending, then by name
    rankingList.sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }
      return a.name.localeCompare(b.name);
    });

    res.json(rankingList);
  } catch (err) {
    console.error('Ranking endpoint error:', err);
    res.status(500).json({ message: 'Server error loading rankings' });
  }
});

// @route   GET api/auth/teachers/stats
// @desc    Get teacher analytics statistics (requires auth)
router.get('/teachers/stats', auth, async (req, res) => {
  try {
    // Total files uploaded by all educators
    const educators = await User.find({ role: 'educator' }).select('_id');
    const educatorIds = educators.map(e => e._id);
    const totalTeacherFiles = await Document.countDocuments({ uploadedByUserId: { $in: educatorIds } });

    // Files uploaded by self
    const ownFilesCount = await Document.countDocuments({ uploadedByUserId: req.user.id });

    // Total likes on self's resources
    const ownDocs = await Document.find({ uploadedByUserId: req.user.id });
    let ownLikesCount = 0;
    ownDocs.forEach(doc => {
      if (doc.likes) ownLikesCount += doc.likes.length;
    });

    res.json({
      totalTeacherFiles,
      ownFilesCount,
      ownLikesCount
    });
  } catch (err) {
    console.error('Stats endpoint error:', err);
    res.status(500).json({ message: 'Server error loading teacher stats' });
  }
});

// @route   POST api/auth/reset-password
// @desc    Reset password for logged-in user (requires auth)
router.post('/reset-password', auth, async (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body;

  if (!oldPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: 'New passwords do not match' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Validate old password
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect old password' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    await user.save();

    res.json({ message: 'Password successfully changed!' });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST api/auth/users/:id/reset-password
// @desc    Admin reset user password to "123456" (Admin only)
router.post('/users/:id/reset-password', isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Hash default password "123456"
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('123456', salt);

    user.password = hashedPassword;
    await user.save();

    res.json({ message: `Successfully reset password for ${user.name} to 123456` });
  } catch (err) {
    console.error('Admin password reset error:', err);
    res.status(500).json({ message: 'Server error resetting user password' });
  }
});

// @route   GET api/auth/contributors
// @desc    Get top 50 student contributors (public route)
router.get('/contributors', async (req, res) => {
  try {

    const students = await User.find({ role: 'student' }).select('name phone createdAt');
    const rankingList = [];

    for (const s of students) {
      const points = await Document.countDocuments({ uploadedByUserId: s._id, status: 'approved' });
      if (points > 0) {
        rankingList.push({
          id: s._id,
          name: s.name,
          uploads: points,
          points,
          createdAt: s.createdAt
        });
      }
    }

    // Sort by points descending, then by name
    rankingList.sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }
      return a.name.localeCompare(b.name);
    });

    const top50 = rankingList.slice(0, 50);
    res.json(top50);
  } catch (err) {
    console.error('Contributors ranking error:', err);
    res.status(500).json({ message: 'Server error loading contributors' });
  }
});

// @route   PUT api/auth/email
// @desc    Update or link email address for logged-in user (requires auth)
router.put('/email', auth, async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim())) {
    return res.status(400).json({ message: 'Please enter a valid email address' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Check if email already registered by another account
    const existingUser = await User.findOne({
      email: normalizedEmail,
      _id: { $ne: req.user.id }
    });

    if (existingUser) {
      return res.status(400).json({ message: 'This email is already registered with another account' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.email = normalizedEmail;
    await user.save();

    res.json({
      message: 'Email updated successfully!',
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        approved: user.approved
      }
    });
  } catch (err) {
    console.error('Update email error:', err);
    res.status(500).json({ message: 'Server error updating email' });
  }
});

// ============================================================================
// SECURE SERVER-AUTHORITATIVE OTP & PASSWORD RESET ENDPOINTS
// ============================================================================

/**
 * Handle OTP Request (Supports both /request-otp and legacy /forgot-password)
 */
async function handleRequestOtp(req, res) {
  const { phone } = req.body;

  if (!phone || typeof phone !== 'string' || !/^\d{10,15}$/.test(phone.trim())) {
    return res.status(400).json({ message: 'Please enter a valid registered phone number' });
  }

  try {
    const cleanPhone = phone.trim();
    const user = await User.findOne({ phone: cleanPhone });

    // Prevent Account Enumeration: Return generic response if account does not exist
    if (!user) {
      console.log(`[Security Audit] OTP request for non-existent phone number: ${cleanPhone.slice(-4)}`);
      return res.json({
        success: true,
        hasEmail: true,
        message: 'If an account is associated with this phone, a verification code has been dispatched.',
        verificationId: crypto.randomUUID(),
        maskedEmail: 'ac***t@domain.com',
        expiresInSeconds: 300,
        cooldownSeconds: 60
      });
    }

    // Account without registered email -> Guide to Help & Support
    if (!user.email) {
      return res.json({
        success: false,
        hasEmail: false,
        name: user.name,
        phone: user.phone,
        role: user.role
      });
    }

    // Account-level rate limiting: Max 5 OTP requests per 15 minutes
    const recentRequests = await OtpVerification.countDocuments({
      userId: user._id,
      createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) }
    });

    if (recentRequests >= 5) {
      console.warn(`[Security Alert] Account OTP rate limit exceeded for user ${user._id}`);
      return res.status(429).json({
        success: false,
        message: 'Too many verification code requests for this account. Please try again after 15 minutes.'
      });
    }

    // Invalidate/Revoke any existing pending OTP sessions for this user
    await OtpVerification.updateMany(
      { userId: user._id, used: false, revoked: false },
      { $set: { revoked: true } }
    );

    // Cryptographically secure 6-digit numeric OTP
    const rawOtp = crypto.randomInt(100000, 1000000).toString();

    // Hash the OTP with HMAC-SHA256 using server secret
    const otpHash = crypto.createHmac('sha256', config.JWT_SECRET).update(rawOtp).digest('hex');

    // Generate unique verification transaction ID
    const verificationId = crypto.randomUUID();

    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'Unknown';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // Store verification transaction in database
    const verification = new OtpVerification({
      verificationId,
      userId: user._id,
      phone: user.phone,
      email: user.email,
      purpose: 'password_reset',
      otpHash,
      attempts: 0,
      maxAttempts: config.SECURITY.OTP_MAX_ATTEMPTS,
      used: false,
      revoked: false,
      expiresAt: new Date(Date.now() + config.SECURITY.OTP_LIFETIME_MS),
      lastSentAt: new Date(),
      resendCount: 0,
      maxResends: config.SECURITY.MAX_RESENDS,
      clientIp,
      userAgent
    });

    await verification.save();

    // Dispatch email from server (Plaintext OTP is NEVER returned in HTTP response)
    try {
      await sendOtpEmail({
        email: user.email,
        name: user.name,
        otp: rawOtp,
        purpose: 'password_reset'
      });
    } catch (mailErr) {
      console.error('[Email Dispatch Error]', mailErr.message);
      // Invalidate the record if dispatch failed
      await OtpVerification.deleteOne({ _id: verification._id });
      return res.status(502).json({
        success: false,
        message: 'Unable to deliver verification email at this time. Please try again later.'
      });
    }

    // Return safe generic response (NO OTP in JSON)
    res.json({
      success: true,
      hasEmail: true,
      message: 'A verification code has been dispatched to your registered email address.',
      verificationId,
      maskedEmail: maskEmail(user.email),
      expiresInSeconds: Math.floor(config.SECURITY.OTP_LIFETIME_MS / 1000),
      cooldownSeconds: config.SECURITY.RESEND_COOLDOWN_SEC
    });
  } catch (err) {
    console.error('Request OTP error:', err);
    res.status(500).json({ success: false, message: 'Server error processing verification request' });
  }
}

/**
 * Handle Resend OTP
 */
async function handleResendOtp(req, res) {
  const { verificationId } = req.body;

  if (!verificationId || typeof verificationId !== 'string') {
    return res.status(400).json({ message: 'Verification session ID is required' });
  }

  try {
    const verification = await OtpVerification.findOne({
      verificationId: verificationId.trim(),
      used: false,
      revoked: false
    });

    if (!verification) {
      return res.status(400).json({
        message: 'Verification session has expired or is invalid. Please request a new code.'
      });
    }

    // Check expiration
    if (Date.now() > new Date(verification.expiresAt).getTime()) {
      verification.revoked = true;
      await verification.save();
      return res.status(400).json({
        message: 'Verification session has expired. Please request a new code.'
      });
    }

    // Check cooldown
    const elapsedSec = (Date.now() - new Date(verification.lastSentAt).getTime()) / 1000;
    if (elapsedSec < config.SECURITY.RESEND_COOLDOWN_SEC) {
      const waitSec = Math.ceil(config.SECURITY.RESEND_COOLDOWN_SEC - elapsedSec);
      return res.status(429).json({
        message: `Please wait ${waitSec}s before requesting another code.`,
        cooldownSeconds: waitSec,
        cooldownRemaining: waitSec
      });
    }

    // Check resend count limit
    if (verification.resendCount >= verification.maxResends) {
      verification.revoked = true;
      await verification.save();
      return res.status(429).json({
        message: 'Maximum resend limit reached for this session. Please start over.'
      });
    }

    // Generate new OTP
    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHmac('sha256', config.JWT_SECRET).update(rawOtp).digest('hex');

    verification.otpHash = otpHash;
    verification.attempts = 0; // Reset attempts on fresh OTP
    verification.resendCount += 1;
    verification.lastSentAt = new Date();
    verification.expiresAt = new Date(Date.now() + config.SECURITY.OTP_LIFETIME_MS);
    await verification.save();

    // Fetch user for name
    const user = await User.findById(verification.userId);
    const recipientName = user ? user.name : 'Student';

    // Dispatch fresh email from server
    await sendOtpEmail({
      email: verification.email,
      name: recipientName,
      otp: rawOtp,
      purpose: 'password_reset'
    });

    res.json({
      success: true,
      message: 'A new verification code has been dispatched to your email.',
      cooldownSeconds: config.SECURITY.RESEND_COOLDOWN_SEC
    });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ message: 'Server error resending verification code' });
  }
}

/**
 * Handle OTP Verification (Supports both /verify-otp and legacy /verify-reset-otp)
 */
async function handleVerifyOtp(req, res) {
  const { verificationId, otp, phone, newPassword, confirmPassword } = req.body;

  if (!otp || !/^\d{6}$/.test(String(otp).trim())) {
    return res.status(400).json({ message: 'Please enter a valid 6-digit verification code' });
  }

  try {
    let doc = null;

    if (verificationId && typeof verificationId === 'string') {
      doc = await OtpVerification.findOne({ verificationId: verificationId.trim() });
    } else if (phone && typeof phone === 'string') {
      // Legacy fallback: locate latest active session by phone
      doc = await OtpVerification.findOne({
        phone: phone.trim(),
        used: false,
        revoked: false
      }).sort({ createdAt: -1 });
    }

    if (!doc || doc.revoked) {
      return res.status(400).json({ message: 'Verification session has expired or is invalid. Please request a new code.' });
    }

    if (doc.used) {
      return res.status(400).json({ message: 'This verification code has already been used. Please request a new code.' });
    }

    // Expiration check
    if (Date.now() > new Date(doc.expiresAt).getTime()) {
      doc.revoked = true;
      await doc.save();
      return res.status(400).json({ message: 'Verification code has expired. Please request a new code.' });
    }

    // Brute-force limit check
    if (doc.attempts >= doc.maxAttempts) {
      doc.revoked = true;
      await doc.save();
      return res.status(400).json({ message: 'Maximum verification attempts exceeded. Verification session locked.' });
    }

    // Constant-time HMAC comparison
    const submittedHash = crypto.createHmac('sha256', config.JWT_SECRET).update(String(otp).trim()).digest('hex');
    const expectedBuf = Buffer.from(doc.otpHash, 'hex');
    const actualBuf = Buffer.from(submittedHash, 'hex');

    const isMatch = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);

    if (!isMatch) {
      doc.attempts += 1;
      if (doc.attempts >= doc.maxAttempts) {
        doc.revoked = true;
      }
      await doc.save();

      const remaining = doc.maxAttempts - doc.attempts;
      return res.status(400).json({
        success: false,
        message: remaining > 0
          ? `Invalid code. ${remaining} attempt(s) remaining.`
          : 'Maximum attempts exceeded. Verification session locked.'
      });
    }

    // Atomic single-use state transition to prevent race conditions
    const consumed = await OtpVerification.findOneAndUpdate(
      { _id: doc._id, used: false, revoked: false },
      { $set: { used: true } },
      { new: true }
    );

    if (!consumed) {
      return res.status(409).json({ success: false, message: 'Verification code already consumed.' });
    }

    // Issue short-lived, signed JWT resetToken
    const resetToken = jwt.sign(
      {
        userId: String(consumed.userId),
        phone: consumed.phone,
        email: consumed.email,
        purpose: 'password_reset',
        verificationId: consumed.verificationId
      },
      config.JWT_SECRET,
      { expiresIn: '10m' }
    );

    // If newPassword provided directly (one-step backwards compatibility)
    if (newPassword || confirmPassword) {
      if (!newPassword || !confirmPassword) {
        return res.status(400).json({ message: 'Please enter all password fields' });
      }
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ message: 'Passwords do not match' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long' });
      }

      const user = await User.findById(consumed.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
      await user.save();

      // Revoke all OTPs for this user
      await OtpVerification.updateMany({ userId: user._id }, { $set: { revoked: true, used: true } });

      return res.json({
        success: true,
        message: 'Password successfully reset! You can now log in with your new password.',
        resetToken
      });
    }

    // Step 2 success: return resetToken for Step 3
    res.json({
      success: true,
      message: 'Verification code verified successfully! Please set your new password.',
      resetToken,
      phone: consumed.phone
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ message: 'Server error verifying code' });
  }
}

/**
 * Handle Final Password Reset
 */
async function handleResetPasswordFinal(req, res) {
  const { resetToken, newPassword, confirmPassword } = req.body;

  if (!newPassword || !confirmPassword) {
    return res.status(400).json({ message: 'Please enter and confirm your new password' });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long' });
  }

  if (!resetToken || typeof resetToken !== 'string') {
    return res.status(401).json({ message: 'Verification session has expired. Please verify code again.' });
  }

  try {
    const decoded = jwt.verify(resetToken, config.JWT_SECRET);
    if (decoded.purpose !== 'password_reset' || !decoded.userId) {
      return res.status(400).json({ message: 'Invalid reset token purpose' });
    }

    // Verify session has not already been used or revoked (replay attack prevention)
    if (decoded.verificationId) {
      const verifSession = await OtpVerification.findOne({
        verificationId: decoded.verificationId,
        revoked: false
      });

      if (!verifSession) {
        return res.status(401).json({
          message: 'Reset token has already been used or revoked. Please verify again.'
        });
      }

      verifSession.revoked = true;
      await verifSession.save();
    }

    // Retrieve user by ID derived from verified JWT (NEVER trust client phone/email parameters)
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ message: 'User account not found' });
    }

    // Hash and update password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    // Revoke all remaining OTPs for this user
    await OtpVerification.updateMany({ userId: user._id }, { $set: { revoked: true, used: true } });

    console.log(`[Security Audit] Password successfully changed for user ${user._id} via verified reset session.`);

    res.json({
      success: true,
      message: 'Password successfully updated! You can now log in with your new password.'
    });
  } catch (tokenErr) {
    console.warn(`[Security Alert] Invalid or expired resetToken submitted: ${tokenErr.message}`);
    return res.status(401).json({ message: 'Verification session has expired. Please verify code again.' });
  }
}

// Mount OTP routes
router.post('/request-otp', otpRequestLimiter, handleRequestOtp);
router.post('/forgot-password', otpRequestLimiter, handleRequestOtp); // Alias for backwards compatibility
router.post('/resend-otp', otpRequestLimiter, handleResendOtp);
router.post('/verify-otp', otpVerifyLimiter, handleVerifyOtp);
router.post('/verify-reset-otp', otpVerifyLimiter, handleVerifyOtp); // Alias for backwards compatibility
router.post('/reset-password-final', handleResetPasswordFinal);

// @route   PUT api/auth/users/:id/email
// @desc    Admin updates any user's email address by User ID
router.put('/users/:id/email', isAdmin, async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim())) {
    return res.status(400).json({ message: 'Please enter a valid email address' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const existing = await User.findOne({ email: normalizedEmail, _id: { $ne: req.params.id } });
    if (existing) {
      return res.status(400).json({ message: 'This email is already linked to another account' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.email = normalizedEmail;
    await user.save();

    res.json({
      message: 'User email successfully updated by Admin!',
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Admin update user email error:', err);
    res.status(500).json({ message: 'Server error updating user email' });
  }
});

// @route   PUT api/auth/users/by-phone/:phone/email
// @desc    Admin updates any user's email address by phone number
router.put('/users/by-phone/:phone/email', isAdmin, async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim())) {
    return res.status(400).json({ message: 'Please enter a valid email address' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const cleanPhone = req.params.phone.trim();
    const user = await User.findOne({ phone: cleanPhone });
    if (!user) {
      return res.status(404).json({ message: 'No user found with this phone number' });
    }

    const existing = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
    if (existing) {
      return res.status(400).json({ message: 'This email is already linked to another account' });
    }

    user.email = normalizedEmail;
    await user.save();

    res.json({
      message: 'User email successfully updated by Admin!',
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Admin update user email by phone error:', err);
    res.status(500).json({ message: 'Server error updating user email' });
  }
});

module.exports = router;

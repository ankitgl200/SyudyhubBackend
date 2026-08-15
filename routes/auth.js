const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Document, Notification } = require('../db/models');
const config = require('../config');
const { auth, isAdmin, isSuperAdmin } = require('../middleware/auth');

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
  const { name, phone, password, role } = req.body;

  // Simple validation
  if (!name || !phone || !password || !role) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  // Check if role is valid
  if (!['student', 'educator', 'admin'].includes(role)) {
    return res.status(400).json({ message: 'Invalid user role selection' });
  }

  try {
    // Check for existing user
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this phone number already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Students are approved automatically. Educators & Admins require admin approval.
    const approved = role === 'student';

    const newUser = new User({
      name,
      phone,
      password: hashedPassword,
      role,
      approved
    });
    
    await newUser.save();

    // Create welcome notification
    let welcomeMsg = '';
    if (role === 'student') {
      welcomeMsg = `Welcome to StudyHub! 📚\nExplore notes, papers, and resources to boost your learning. Stay consistent and keep growing! 🚀\n\nThank you\nTeam Studyhub.`;
    } else if (role === 'educator') {
      welcomeMsg = `Dear Sir/Ma’am,\n\nWe warmly welcome you to our platform as an educator and sincerely thank you for joining us. Your presence and experience will greatly benefit our student community.\n\nWe kindly request you to upload any resources you have, such as notes, previous year questions, or lab manuals, which can help students in their learning journey.\n\nIn case you face any issues while using the platform or otherwise, please feel free to use the Help & Support page—we are always here to assist you.\n\nThank you once again for being a valuable part of our initiative.\n\nThank you\nTeam Studyhub`;
    } else if (role === 'admin') {
      welcomeMsg = `Welcome Admin! ⚙️\n\nYou have full control to manage content, users, and keep StudyHub running smoothly. Let’s build something impactful! 🚀\n\nThank you\nTeam Studyhub`;
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
      user: {
        id: newUser._id,
        name: newUser.name,
        phone: newUser.phone,
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
    
    user.lastLogin = new Date();
    user.lastActive = new Date();
    user.deviceInfo = parseUserAgent(userAgent, clientIp);
    
    await user.save();

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
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

module.exports = router;

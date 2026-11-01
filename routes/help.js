const express = require('express');
const router = express.Router();
const { HelpRequest } = require('../db/models');
const { auth, isAdmin } = require('../middleware/auth');

// @route   POST api/help
// @desc    Submit a help and support request (Teachers, Students, and Guests)
router.post('/', async (req, res) => {
  const { subject, message, name, phone, role, requestedEmail } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ message: 'Subject and message are required' });
  }

  // Try to authenticate optional user token
  let userId = null;
  let submitterName = name;
  let submitterPhone = phone;
  let submitterRole = role;

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      userId = decoded.id;
      // Get user from DB to ensure they exist
      const { User } = require('../db/models');
      const user = await User.findById(userId);
      if (user) {
        submitterName = user.name;
        submitterPhone = user.phone;
        submitterRole = user.role;
      }
    } catch (err) {
      // Ignore token verification errors and treat as guest submission
    }
  }

  // If guest (not authenticated), name, phone, and role are required
  if (!userId) {
    if (!submitterName || !submitterPhone || !submitterRole) {
      return res.status(400).json({ message: 'Name, phone, and role are required' });
    }
  }

  try {
    const newRequest = new HelpRequest({
      userId: userId || null,
      name: submitterName,
      phone: submitterPhone,
      role: submitterRole,
      requestedEmail: requestedEmail ? requestedEmail.trim().toLowerCase() : null,
      subject,
      message
    });

    await newRequest.save();

    res.status(201).json({
      id: newRequest._id,
      userId: newRequest.userId,
      name: newRequest.name,
      phone: newRequest.phone,
      role: newRequest.role,
      requestedEmail: newRequest.requestedEmail || null,
      subject: newRequest.subject,
      message: newRequest.message,
      status: newRequest.status,
      createdAt: newRequest.createdAt
    });
  } catch (err) {
    console.error('Submit help request error:', err);
    res.status(500).json({ message: 'Server error submitting help request' });
  }
});

// @route   GET api/help/my
// @desc    Get all help and support requests submitted by the logged-in user
router.get('/my', auth, async (req, res) => {
  try {
    const list = await HelpRequest.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(list.map(r => ({
      id: r._id,
      userId: r.userId,
      name: r.name,
      phone: r.phone,
      role: r.role,
      requestedEmail: r.requestedEmail || null,
      subject: r.subject,
      message: r.message,
      status: r.status,
      createdAt: r.createdAt
    })));
  } catch (err) {
    console.error('Load my help requests error:', err);
    res.status(500).json({ message: 'Server error loading your help requests' });
  }
});

// @route   GET api/help
// @desc    Get all help and support requests (Admin and Superadmin only)
router.get('/', isAdmin, async (req, res) => {
  try {
    const list = await HelpRequest.find().sort({ createdAt: -1 });
    res.json(list.map(r => ({
      id: r._id,
      userId: r.userId,
      name: r.name,
      phone: r.phone,
      role: r.role,
      requestedEmail: r.requestedEmail || null,
      subject: r.subject,
      message: r.message,
      status: r.status,
      createdAt: r.createdAt
    })));
  } catch (err) {
    console.error('Load help requests error:', err);
    res.status(500).json({ message: 'Server error loading help requests' });
  }
});

// @route   POST api/help/resolve/:id
// @desc    Mark a help request as resolved (Admin and Superadmin only)
router.post('/resolve/:id', isAdmin, async (req, res) => {
  try {
    const request = await HelpRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    request.status = request.status === 'resolved' ? 'pending' : 'resolved';
    await request.save();

    res.json({ message: `Request marked as ${request.status}`, id: request._id, status: request.status });
  } catch (err) {
    console.error('Resolve help request error:', err);
    res.status(500).json({ message: 'Server error updating request' });
  }
});

// @route   DELETE api/help/:id
// @desc    Delete a help request (Admin and Superadmin only)
router.delete('/:id', isAdmin, async (req, res) => {
  try {
    const deleted = await HelpRequest.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Request not found' });
    }
    res.json({ message: 'Help request deleted successfully', id: req.params.id });
  } catch (err) {
    console.error('Delete help request error:', err);
    res.status(500).json({ message: 'Server error deleting request' });
  }
});

module.exports = router;

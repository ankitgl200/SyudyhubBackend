const express = require('express');
const router = require('express').Router();
const { Announcement } = require('../db/models');
const { auth, isStaff } = require('../middleware/auth');

const getAbsoluteUrl = (req, url) => {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}${url}`;
};

// @route   GET api/announcements
// @desc    Get all announcements (requires auth)
router.get('/', auth, async (req, res) => {
  try {
    const list = await Announcement.find().sort({ createdAt: -1 });
    res.json(list.map(a => ({
      id: a._id,
      title: a.title,
      content: a.content,
      docUrl: getAbsoluteUrl(req, a.docUrl),
      createdAt: a.createdAt
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error loading announcements' });
  }
});

// @route   POST api/announcements
// @desc    Create a new announcement (Teacher/Admin)
router.post('/', isStaff, async (req, res) => {
  const { title, content, docUrl } = req.body;

  if (!title || !content) {
    return res.status(400).json({ message: 'Title and content are required' });
  }

  try {
    const announcement = new Announcement({
      title,
      content,
      docUrl: docUrl || null
    });
    
    await announcement.save();

    // Limit announcements to 10 max
    const count = await Announcement.countDocuments();
    if (count > 10) {
      const oldest = await Announcement.find().sort({ createdAt: 1 }).limit(count - 10);
      const idsToDelete = oldest.map(a => a._id);
      await Announcement.deleteMany({ _id: { $in: idsToDelete } });
    }

    res.status(201).json({
      id: announcement._id,
      title: announcement.title,
      content: announcement.content,
      createdAt: announcement.createdAt
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error creating announcement' });
  }
});

// @route   DELETE api/announcements/:id
// @desc    Delete an announcement (Teacher/Admin)
router.delete('/:id', isStaff, async (req, res) => {
  const id = req.params.id;
  try {
    const deleted = await Announcement.findByIdAndDelete(id);
    
    if (!deleted) {
      return res.status(404).json({ message: 'Announcement not found' });
    }

    res.json({ message: 'Announcement deleted successfully', id });
  } catch (err) {
    res.status(500).json({ message: 'Server error deleting announcement' });
  }
});

module.exports = router;

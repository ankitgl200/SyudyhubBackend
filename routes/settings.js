const express = require('express');
const router = express.Router();
const { SystemSetting } = require('../db/models');
const { auth, isAdmin } = require('../middleware/auth');

// @route   GET api/settings/:key
// @desc    Get a system setting (Public)
router.get('/:key', async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ key: req.params.key });
    if (!setting) {
      return res.status(404).json({ message: 'Setting not found' });
    }
    res.json({ value: setting.value });
  } catch (err) {
    console.error('Error fetching setting:', err);
    res.status(500).json({ message: 'Server error fetching setting' });
  }
});

// @route   PUT api/settings/:key
// @desc    Create or update a system setting (Admin only)
router.put('/:key', isAdmin, async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({ message: 'Value is required' });
    }

    let setting = await SystemSetting.findOne({ key: req.params.key });
    
    if (setting) {
      setting.value = value;
      await setting.save();
    } else {
      setting = new SystemSetting({
        key: req.params.key,
        value: value
      });
      await setting.save();
    }

    res.json({ message: 'Setting updated successfully', setting });
  } catch (err) {
    console.error('Error updating setting:', err);
    res.status(500).json({ message: 'Server error updating setting' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { TeamMember } = require('../db/models');
const { auth, isSuperAdmin } = require('../middleware/auth');

// Get all team members (public)
router.get('/', async (req, res) => {
  try {
    const team = await TeamMember.find().sort({ order: 1, createdAt: 1 });
    res.json(team);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching team members' });
  }
});

// Create new team member (superadmin only)
router.post('/', auth, isSuperAdmin, async (req, res) => {
  try {
    const { name, role, bio, imageUrl, order } = req.body;
    let finalOrder = order;

    if (finalOrder !== undefined && finalOrder !== null && finalOrder !== '') {
      finalOrder = Number(finalOrder);
      // Check for duplicate order
      const existing = await TeamMember.findOne({ order: finalOrder });
      if (existing) {
        return res.status(400).json({ message: 'Position number already taken by another team member' });
      }
    } else {
      // Find max order and add 1
      const maxMember = await TeamMember.findOne().sort('-order');
      finalOrder = maxMember && maxMember.order !== undefined ? maxMember.order + 1 : 1;
    }

    const newMember = new TeamMember({ name, role, bio, imageUrl, order: finalOrder });
    await newMember.save();
    res.status(201).json(newMember);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update team member (superadmin only)
router.put('/:id', auth, isSuperAdmin, async (req, res) => {
  try {
    const { name, role, bio, imageUrl, order } = req.body;
    let updateData = { name, role, bio, imageUrl };

    if (order !== undefined && order !== null && order !== '') {
      const parsedOrder = Number(order);
      // Check for duplicate order excluding this member
      const existing = await TeamMember.findOne({ order: parsedOrder, _id: { $ne: req.params.id } });
      if (existing) {
        return res.status(400).json({ message: 'Position number already taken by another team member' });
      }
      updateData.order = parsedOrder;
    }

    const member = await TeamMember.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json(member);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete team member (superadmin only)
router.delete('/:id', auth, isSuperAdmin, async (req, res) => {
  try {
    await TeamMember.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;


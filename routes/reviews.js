const express = require('express');
const router = express.Router();
const { Review } = require('../db/models');
const { auth, isAdmin } = require('../middleware/auth');

// @route   POST api/reviews
// @desc    Submit a review (Any approved logged-in user, only once)
router.post('/', auth, async (req, res) => {
  const { rating, comment } = req.body;

  // Validate rating
  const rateNum = Number(rating);
  if (isNaN(rateNum) || rateNum < 1 || rateNum > 5) {
    return res.status(400).json({ message: 'Rating must be a number between 1 and 5' });
  }

  try {
    // Check if user already submitted a review
    const existingReview = await Review.findOne({ userId: req.user.id });
    if (existingReview) {
      return res.status(400).json({ message: 'You have already submitted a review' });
    }

    const review = new Review({
      userId: req.user.id,
      name: req.user.name,
      rating: rateNum,
      comment: comment || ''
    });

    await review.save();

    res.status(201).json({
      message: 'Review submitted successfully',
      review: {
        id: review._id,
        userId: review.userId,
        name: review.name,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt
      }
    });
  } catch (err) {
    console.error('Submit review error:', err);
    res.status(500).json({ message: 'Server error submitting review' });
  }
});

// @route   GET api/reviews/my
// @desc    Get the current user's submitted review (if any)
router.get('/my', auth, async (req, res) => {
  try {
    const review = await Review.findOne({ userId: req.user.id });
    if (!review) {
      return res.json({ hasSubmitted: false });
    }
    res.json({
      hasSubmitted: true,
      review: {
        id: review._id,
        userId: review.userId,
        name: review.name,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt
      }
    });
  } catch (err) {
    console.error('Get my review error:', err);
    res.status(500).json({ message: 'Server error fetching review status' });
  }
});

// @route   GET api/reviews
// @desc    Get all reviews (Admin and Superadmin only)
router.get('/', isAdmin, async (req, res) => {
  try {
    const list = await Review.find().sort({ createdAt: -1 });
    res.json(list.map(r => ({
      id: r._id,
      userId: r.userId,
      name: r.name,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt
    })));
  } catch (err) {
    console.error('Load reviews error:', err);
    res.status(500).json({ message: 'Server error loading reviews' });
  }
});

// @route   DELETE api/reviews/:id
// @desc    Delete a review (Admin and Superadmin only)
router.delete('/:id', isAdmin, async (req, res) => {
  try {
    const deleted = await Review.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Review not found' });
    }
    res.json({ message: 'Review deleted successfully', id: req.params.id });
  } catch (err) {
    console.error('Delete review error:', err);
    res.status(500).json({ message: 'Server error deleting review' });
  }
});

module.exports = router;

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
      if (req.params.key === 'ads_config') {
        return res.json({
          value: {
            enabled: false,
            ads: [
              {
                id: 1,
                name: 'Ad 1',
                enabled: true,
                format: 'html',
                title: 'Google AdSense',
                description: 'Official Partner Advertisement',
                imageUrl: '',
                linkUrl: '',
                buttonText: '',
                htmlCode: '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1950443996388582" crossorigin="anonymous"></script>\n<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-1950443996388582" data-ad-slot="6380389639" data-ad-format="auto" data-full-width-responsive="true"></ins>\n<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>'
              },
              {
                id: 2,
                name: 'Ad 2',
                enabled: false,
                format: 'banner',
                title: 'Partner with StudyMyte',
                description: 'Promote your educational tools, hackathons, and courses to verified engineering scholars.',
                imageUrl: '',
                linkUrl: 'mailto:support@studymyte.tech?subject=Sponsorship%20Inquiry',
                buttonText: 'Advertise With Us',
                htmlCode: ''
              },
              {
                id: 3,
                name: 'Ad 3',
                enabled: false,
                format: 'banner',
                title: 'Master Data Structures & Algorithms',
                description: 'Curated semester revision materials, interview cheat sheets, and coding resources.',
                imageUrl: '',
                linkUrl: 'https://studymyte.tech',
                buttonText: 'Explore Resources ➔',
                htmlCode: ''
              },
              {
                id: 4,
                name: 'Ad 4',
                enabled: false,
                format: 'banner',
                title: 'Join Our Contributor Community',
                description: 'Share your hand-written lecture notes and previous year papers to help your peers.',
                imageUrl: '',
                linkUrl: 'https://studymyte.tech/#/my-contributions',
                buttonText: 'Upload Notes ➔',
                htmlCode: ''
              }
            ]
          }
        });
      }
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

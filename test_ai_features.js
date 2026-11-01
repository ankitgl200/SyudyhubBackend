const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const config = require('./config');
const { User, Document, Announcement, OtpVerification } = require('./db/models');
const { executeTool, TOOL_DEFINITIONS } = require('./services/mytee/myteeTools');
const { runLocalFallbackEngine } = require('./services/mytee/geminiService');

test.describe('MYTEE — Advanced AI Controls & Profile Extraction Suite', () => {

  test.before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.MONGODB_URI);
    }
  });

  test.after(async () => {
    await mongoose.disconnect();
  });

  test('1. Tool definitions exist for all 4 new capabilities', () => {
    const names = TOOL_DEFINITIONS.map(t => t.name);
    assert.ok(names.includes('set_website_theme'), 'Missing set_website_theme');
    assert.ok(names.includes('set_website_font'), 'Missing set_website_font');
    assert.ok(names.includes('get_my_profile_and_uploads'), 'Missing get_my_profile_and_uploads');
    assert.ok(names.includes('get_latest_announcements'), 'Missing get_latest_announcements');
  });

  test('2. set_website_theme executes and produces clientAction', async () => {
    const darkRes = await executeTool('set_website_theme', { mode: 'dark' });
    assert.equal(darkRes.success, true);
    assert.equal(darkRes.mode, 'dark');
    assert.deepEqual(darkRes.clientAction, { type: 'set_theme', value: 'dark' });

    const lightRes = await executeTool('set_website_theme', { mode: 'light' });
    assert.equal(lightRes.success, true);
    assert.equal(lightRes.mode, 'light');
    assert.deepEqual(lightRes.clientAction, { type: 'set_theme', value: 'light' });
  });

  test('3. set_website_font lists choices when font is unspecified and applies when specified', async () => {
    const listRes = await executeTool('set_website_font', {});
    assert.equal(listRes.success, true);
    assert.equal(listRes.requiresChoice, true);
    assert.equal(listRes.availableFonts.length, 10);

    const applyRes = await executeTool('set_website_font', { fontId: 'outfit' });
    assert.equal(applyRes.success, true);
    assert.equal(applyRes.fontId, 'outfit');
    assert.deepEqual(applyRes.clientAction, { type: 'set_font', value: 'outfit' });
  });

  test('4. get_my_profile_and_uploads returns user info and latest 5 uploads for logged-in user only', async () => {
    // Unauthenticated guest
    const guestRes = await executeTool('get_my_profile_and_uploads', {}, null);
    assert.equal(guestRes.success, false);
    assert.equal(guestRes.requiresLogin, true);

    // Create test student user
    let user = await User.findOne({ email: 'test_ai_user@studymyte.tech' });
    if (!user) {
      user = new User({
        username: 'test_ai_user',
        name: 'AI Test Student',
        email: 'test_ai_user@studymyte.tech',
        phone: '9876543210',
        role: 'student',
        password: 'hashedpassword123'
      });
      await user.save();
    }

    // Create 6 test documents to verify latest 5 limit
    await Document.deleteMany({ uploadedByUserId: user._id });
    for (let i = 1; i <= 6; i++) {
      const doc = new Document({
        title: `Test Note ${i}`,
        type: 'notes',
        subject: 'Computer Science',
        year: '2nd Year',
        fileUrl: `/uploads/test${i}.pdf`,
        fileName: `test${i}.pdf`,
        status: i % 2 === 0 ? 'approved' : 'pending',
        uploadedBy: user.name,
        uploadedByUserId: user._id
      });
      await doc.save();
    }

    const authRes = await executeTool('get_my_profile_and_uploads', {}, { id: user._id.toString() });
    assert.equal(authRes.success, true);
    assert.equal(authRes.profile.name, 'AI Test Student');
    assert.equal(authRes.profile.email, 'test_ai_user@studymyte.tech');
    assert.equal(authRes.profile.phone, '9876543210');
    assert.equal(authRes.recentUploads.length, 5); // Must be capped at 5

    // Clean up
    await Document.deleteMany({ uploadedByUserId: user._id });
    await User.deleteOne({ _id: user._id });
  });

  test('5. get_latest_announcements fetches up to 10 notices', async () => {
    // Ensure at least 1 announcement exists
    let ann = await Announcement.findOne();
    if (!ann) {
      ann = new Announcement({
        title: 'Mid-Term Exam Schedule Released',
        content: 'The mid-term examination schedule for 2nd and 3rd year students is now live.'
      });
      await ann.save();
    }

    const res = await executeTool('get_latest_announcements', {});
    assert.equal(res.success, true);
    assert.ok(res.announcements.length >= 1);
    assert.ok(res.announcements.length <= 10);
    assert.ok(res.announcements[0].title);
    assert.ok(res.announcements[0].content);
  });

  test('6. Local Fallback Engine routes all 5 user query types seamlessly', async () => {
    // A. Theme switch query
    const themeRes = await runLocalFallbackEngine('switch to dark mode');
    assert.ok(themeRes.text.includes('Dark Mode Activated'));
    assert.deepEqual(themeRes.clientAction, { type: 'set_theme', value: 'dark' });

    // B. Font customization general query (asks user to choose)
    const fontChoiceRes = await runLocalFallbackEngine('customize font');
    assert.ok(fontChoiceRes.text.includes('10 available fonts'));
    assert.ok(fontChoiceRes.actions.some(a => a.path === 'action:set_font:outfit'));

    // C. Font specific query (applies chosen font)
    const fontSetRes = await runLocalFallbackEngine('change font to outfit');
    assert.ok(fontSetRes.text.includes('Outfit'));
    assert.deepEqual(fontSetRes.clientAction, { type: 'set_font', value: 'outfit' });

    // D. Announcements query
    const annRes = await runLocalFallbackEngine('show announcements');
    assert.ok(annRes.text.includes('Announcements'));

    // E. Download App query
    const dlRes = await runLocalFallbackEngine('how to download app');
    assert.ok(dlRes.text.includes('Android'));
    assert.ok(dlRes.text.includes('iOS'));
    assert.deepEqual(dlRes.clientAction, { type: 'download_app_android' });
  });

});


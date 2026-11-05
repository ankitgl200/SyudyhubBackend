const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const config = require('./config');
const { User, Document, Announcement, HelpRequest, Notification } = require('./db/models');
const adminSuperpowers = require('./services/mytee/adminSuperpowersService');
const { executeTool } = require('./services/mytee/myteeTools');
const { generateAiResponse } = require('./services/mytee/geminiService');

let adminUser = null;
let superAdminUser = null;
let testStudent = null;
let testEducator = null;
let testDoc = null;
let testTicket = null;

test('Admin Superpowers: Setup & Database Connection', async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(config.MONGODB_URI);
  }

  // Cleanup test fixtures if any
  await User.deleteMany({ email: /test_superpower_/i });
  await Document.deleteMany({ title: /test_superpower_/i });
  await Announcement.deleteMany({ title: /test_superpower_/i });
  await HelpRequest.deleteMany({ subject: /test_superpower_/i });
  await Notification.deleteMany({ message: /test_superpower_/i });

  // Create test accounts with required phone numbers
  adminUser = await User.create({
    name: 'Admin Tester',
    phone: '9876543211',
    email: 'test_superpower_admin@example.com',
    password: 'password123',
    role: 'admin',
    approved: true
  });

  superAdminUser = await User.create({
    name: 'SuperAdmin Tester',
    phone: '9876543212',
    email: 'test_superpower_superadmin@example.com',
    password: 'password123',
    role: 'superadmin',
    approved: true
  });

  testStudent = await User.create({
    name: 'Student Learner',
    phone: '9876543210',
    email: 'test_superpower_student@example.com',
    password: 'password123',
    role: 'student',
    approved: true
  });

  testEducator = await User.create({
    name: 'Prof. Sharma',
    phone: '9876500000',
    email: 'test_superpower_educator@example.com',
    password: 'password123',
    role: 'educator',
    approved: false // Pending approval
  });

  testDoc = await Document.create({
    title: 'test_superpower_DSA_Notes.pdf',
    type: 'notes',
    subject: 'Data Structures',
    year: '2nd Year',
    fileUrl: 'https://example.com/test_dsa.pdf',
    fileName: 'DSA_Unit1.pdf',
    uploadedBy: testStudent.name,
    uploadedByUserId: testStudent._id,
    status: 'pending'
  });

  testTicket = await HelpRequest.create({
    userId: testStudent._id,
    name: testStudent.name,
    phone: testStudent.phone,
    requestedEmail: testStudent.email,
    role: 'student',
    subject: 'test_superpower_Cannot view PDF notes',
    message: 'When I click on 2nd year OOPS paper, the screen stays white and does not open.',
    status: 'pending'
  });
});

test('Admin Superpowers: Role-Based Access Control (RBAC)', async (t) => {
  await t.test('Rejects students and guests attempting to access admin superpower tools', async () => {
    const guestResult = await executeTool('admin_manage_users', { action: 'search' }, null);
    assert.equal(guestResult.success, false);
    assert.ok(guestResult.error.includes('Administrative privileges required'));

    const studentResult = await executeTool('admin_manage_tickets', { action: 'list' }, {
      id: testStudent._id.toString(),
      role: 'student'
    });
    assert.equal(studentResult.success, false);
    assert.ok(studentResult.error.includes('Administrative privileges required'));
  });

  await t.test('Rejects non-admin in Fallback Chat engine', async () => {
    const res = await generateAiResponse({
      message: 'site status report',
      userContext: { id: testStudent._id.toString(), role: 'student' }
    });
    assert.ok(res.text.includes('Administrative Access Restricted'));
  });
});

test('Admin Superpowers: User Data Access & Search', async (t) => {
  await t.test('Admin can search users and receive enriched profile data', async () => {
    const res = await adminSuperpowers.searchUsers({ query: 'Student Learner' }, {
      id: adminUser._id.toString(),
      role: 'admin'
    });

    assert.equal(res.success, true);
    assert.ok(res.count >= 1);
    const found = res.users.find(u => u.email === testStudent.email);
    assert.ok(found);
    assert.equal(found.phone, '9876543210');
    assert.equal(found.role, 'student');
    assert.equal(found.totalUploads, 1);
  });

  await t.test('Admin can inspect deep user profile details', async () => {
    const res = await adminSuperpowers.getUserDetails(testStudent.email, {
      id: adminUser._id.toString(),
      role: 'admin'
    });

    assert.equal(res.success, true);
    assert.equal(res.user.name, 'Student Learner');
    assert.equal(res.user.stats.totalUploads, 1);
    assert.equal(res.user.recentUploads.length, 1);
    assert.equal(res.user.recentUploads[0].title, 'test_superpower_DSA_Notes.pdf');
  });

  await t.test('Admin can approve pending educator account and trigger notification', async () => {
    const res = await adminSuperpowers.updateUserStatus({
      targetUserId: testEducator._id.toString(),
      action: 'approve'
    }, { id: adminUser._id.toString(), role: 'admin' });

    assert.equal(res.success, true);
    const updated = await User.findById(testEducator._id);
    assert.equal(updated.approved, true);

    const notification = await Notification.findOne({ recipientId: testEducator._id });
    assert.ok(notification, 'Automated approval notification must be created');
  });
});

test('Admin Superpowers: Support Tickets & Intelligent Solution Generation', async (t) => {
  await t.test('Fetches pending tickets and auto-generates verified AI solutions', async () => {
    const res = await adminSuperpowers.getAllSupportTickets({ status: 'pending' }, {
      id: adminUser._id.toString(),
      role: 'admin'
    });

    assert.equal(res.success, true);
    const target = res.tickets.find(t => t.id === testTicket._id.toString());
    assert.ok(target, 'Must return the test support ticket');
    assert.equal(target.aiAnalysis.category, 'PDF & Document Viewing');
    assert.ok(target.aiAnalysis.recommendedSteps.length >= 2);
    assert.ok(target.aiAnalysis.suggestedReply.includes('inbuilt web viewer'));
  });

  await t.test('Admin can resolve support ticket and send notification to student', async () => {
    const res = await adminSuperpowers.resolveOrReplySupportTicket({
      ticketId: testTicket._id.toString(),
      resolutionMessage: 'Issue resolved: PDF viewer cache refreshed.',
      markResolved: true
    }, { id: adminUser._id.toString(), role: 'admin' });

    assert.equal(res.success, true);
    const updated = await HelpRequest.findById(testTicket._id);
    assert.equal(updated.status, 'resolved');
    assert.equal(res.notificationSent, true);
  });
});

test('Admin Superpowers: Content Management (Announcements & Documents)', async (t) => {
  let createdAnnId = null;

  await t.test('Admin can create, list, and delete official announcements', async () => {
    // 1. Create
    const createRes = await adminSuperpowers.manageAnnouncement({
      action: 'create',
      title: 'test_superpower_End Sem Schedule',
      content: 'Odd semester examination begins from 15th December.'
    }, { id: adminUser._id.toString(), role: 'admin' });

    assert.equal(createRes.success, true);
    createdAnnId = createRes.announcement.id;

    // 2. List
    const listRes = await adminSuperpowers.manageAnnouncement({ action: 'list' }, {
      id: adminUser._id.toString(),
      role: 'admin'
    });
    assert.ok(listRes.announcements.some(a => a.id === createdAnnId));

    // 3. Delete
    const delRes = await adminSuperpowers.manageAnnouncement({ action: 'delete', id: createdAnnId }, {
      id: adminUser._id.toString(),
      role: 'admin'
    });
    assert.equal(delRes.success, true);
  });

  await t.test('Admin can list pending uploads and approve a document', async () => {
    const pendingList = await adminSuperpowers.manageDocument({ action: 'list_pending' }, {
      id: adminUser._id.toString(),
      role: 'admin'
    });
    assert.ok(pendingList.documents.some(d => d.id === testDoc._id.toString()));

    const approveRes = await adminSuperpowers.manageDocument({
      action: 'approve',
      id: testDoc._id.toString()
    }, { id: adminUser._id.toString(), role: 'admin' });

    assert.equal(approveRes.success, true);
    const approvedDoc = await Document.findById(testDoc._id);
    assert.equal(approvedDoc.status, 'approved');
  });
});

test('Admin Superpowers: User Communication (In-App Message & Direct Email)', async (t) => {
  await t.test('Admin can send in-app notification to a specific user', async () => {
    const res = await adminSuperpowers.sendUserCommunication({
      targetUserId: testStudent._id.toString(),
      message: 'test_superpower_Please check updated syllabus.',
      channel: 'in_app',
      subject: 'Urgent Academic Notice'
    }, { id: adminUser._id.toString(), name: 'Admin Tester', role: 'admin' });

    assert.equal(res.success, true);
    const notif = await Notification.findOne({
      recipientId: testStudent._id,
      rawMessage: 'test_superpower_Please check updated syllabus.'
    });
    assert.ok(notif, 'Notification must be stored in database');
    assert.ok(notif.message.includes('Admin\ntest_superpower_Please check updated syllabus.'));
  });
});

test('Admin Superpowers: Executive Site Status & Analytics Report', async (t) => {
  await t.test('Generates real-time executive report with strategic recommendations', async () => {
    const res = await adminSuperpowers.generateExecutiveSiteStatusReport({
      id: adminUser._id.toString(),
      role: 'admin'
    });

    assert.equal(res.success, true);
    assert.ok(res.executiveSummary.totalRegisteredUsers >= 2);
    assert.ok(res.executiveSummary.totalArchivedResources >= 1);
    assert.ok(res.actionableRecommendations.length >= 3);
  });
});

test('Admin Superpowers: Chat Fallback Execution for Admin Commands', async (t) => {
  await t.test('Executes user search command in chat for admin', async () => {
    const res = await generateAiResponse({
      message: 'search user Student Learner',
      userContext: { id: adminUser._id.toString(), role: 'admin', name: 'Admin Tester' }
    });
    assert.ok(res.text.includes('Student Learner'));
    assert.ok(res.text.includes('9876543210'));
    assert.ok(res.toolsUsed.includes('admin_manage_users'));
  });

  await t.test('Executes support tickets command in chat for admin', async () => {
    const res = await generateAiResponse({
      message: 'show all support tickets',
      userContext: { id: adminUser._id.toString(), role: 'admin', name: 'Admin Tester' }
    });
    assert.ok(res.text.includes('Support Tickets'));
    assert.ok(res.toolsUsed.includes('admin_manage_tickets'));
  });

  await t.test('Executes resolve ticket with partial 10-char ID in chat for admin', async () => {
    const freshTicket = await HelpRequest.create({
      userId: testStudent._id,
      name: testStudent.name,
      phone: testStudent.phone,
      requestedEmail: testStudent.email,
      role: 'student',
      subject: 'test_superpower_Subject issue',
      message: 'Need help resolving this.',
      status: 'pending'
    });

    const partialId = freshTicket._id.toString().slice(-10);
    const res = await generateAiResponse({
      message: `Resolve ticket ${partialId}`,
      userContext: { id: adminUser._id.toString(), role: 'admin', name: 'Admin Tester' }
    });

    assert.ok(res.text.includes('Ticket Resolved Successfully!'));
    assert.ok(res.toolsUsed.includes('admin_manage_tickets'));
    const reloaded = await HelpRequest.findById(freshTicket._id);
    assert.equal(reloaded.status, 'resolved');
  });

  await t.test('Executes "resolvbe this ticket" typo in chat for admin', async () => {
    const pendingTicket = await HelpRequest.create({
      userId: testStudent._id,
      name: testStudent.name,
      phone: testStudent.phone,
      requestedEmail: testStudent.email,
      role: 'student',
      subject: 'test_superpower_Another pending ticket',
      message: 'Please assist.',
      status: 'pending'
    });

    const res = await generateAiResponse({
      message: 'resolvbe this ticket',
      userContext: { id: adminUser._id.toString(), role: 'admin', name: 'Admin Tester' }
    });

    assert.ok(res.text.includes('Ticket Resolved Successfully!'));
    assert.ok(res.toolsUsed.includes('admin_manage_tickets'));
    const reloaded = await HelpRequest.findById(pendingTicket._id);
    assert.equal(reloaded.status, 'resolved');
  });

  await t.test('Emailing by AI is disabled and returns helpful in-app alternative', async () => {
    const res = await generateAiResponse({
      message: 'send email to student@example.com: Important update',
      userContext: { id: adminUser._id.toString(), role: 'admin', name: 'Admin Tester' }
    });
    assert.ok(res.text.includes('AI Email Dispatch Disabled'));
    assert.ok(res.text.includes('In-App Message'));
  });

  await t.test('Executes executive site status command in chat for admin', async () => {
    const res = await generateAiResponse({
      message: 'site status report',
      userContext: { id: adminUser._id.toString(), role: 'admin', name: 'Admin Tester' }
    });
    assert.ok(res.text.includes('StudyMyte Executive Platform Status Report'));
    assert.ok(res.toolsUsed.includes('admin_get_site_status_report'));
  });
});

test('Admin Superpowers: Cleanup Test Fixtures', async () => {
  await User.deleteMany({ email: /test_superpower_/i });
  await Document.deleteMany({ title: /test_superpower_/i });
  await Announcement.deleteMany({ title: /test_superpower_/i });
  await HelpRequest.deleteMany({ subject: /test_superpower_/i });
  await Notification.deleteMany({ message: /test_superpower_/i });
  await mongoose.disconnect();
});

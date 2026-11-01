const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { executeTool } = require('./services/mytee/myteeTools');
const { runLocalFallbackEngine } = require('./services/mytee/geminiService');

test('Navigation Tool: open_website_page executes correctly', async (t) => {
  await t.test('navigates to public notes page', async () => {
    const res = await executeTool('open_website_page', { page: 'notes' }, null);
    assert.equal(res.success, true);
    assert.equal(res.clientAction.type, 'navigate');
    assert.equal(res.clientAction.path, '/notes');
  });

  await t.test('navigates to pyqs / papers page', async () => {
    const res = await executeTool('open_website_page', { page: 'pyqs' }, null);
    assert.equal(res.success, true);
    assert.equal(res.clientAction.type, 'navigate');
    assert.equal(res.clientAction.path, '/papers');
  });

  await t.test('navigates to resources page', async () => {
    const res = await executeTool('open_website_page', { page: 'resources' }, null);
    assert.equal(res.success, true);
    assert.equal(res.clientAction.type, 'navigate');
    assert.equal(res.clientAction.path, '/resources');
  });

  await t.test('navigates to support page', async () => {
    const res = await executeTool('open_website_page', { page: 'support' }, null);
    assert.equal(res.success, true);
    assert.equal(res.clientAction.type, 'navigate');
    assert.equal(res.clientAction.path, '/support');
  });

  await t.test('requires auth for profile if user is guest and redirects to login', async () => {
    const res = await executeTool('open_website_page', { page: 'profile' }, null);
    assert.equal(res.success, false);
    assert.equal(res.requiresAuth, true);
    assert.equal(res.clientAction.path, '/login');
  });

  await t.test('allows profile navigation for logged in user', async () => {
    const res = await executeTool('open_website_page', { page: 'profile' }, { id: 'usr_test_123', role: 'student' });
    assert.equal(res.success, true);
    assert.equal(res.clientAction.path, '/profile');
  });
});

test('Fallback Engine: Autonomous Navigation & Page Opening', async (t) => {
  await t.test('password reset request gives options to open page or reset in chat', async () => {
    const res = await runLocalFallbackEngine('i want to reset my password', [], { id: 'usr_1', email: 'test@example.com' });
    assert.ok(res.text.includes('Profile Settings') || res.text.includes('Password Reset'));
    assert.ok(res.actions.some(a => a.path.includes('/profile') || a.path.includes('action:open_page:')));
    assert.ok(res.actions.some(a => a.path === 'action:send_reset_otp'));
  });

  await t.test('user confirms to open reset page -> returns clientAction navigate to /profile', async () => {
    const res = await runLocalFallbackEngine('yes open the reset page', [{ role: 'user', content: 'i want to reset my password' }], { id: 'usr_1' });
    assert.ok(res.clientAction);
    assert.equal(res.clientAction.type, 'navigate');
    assert.equal(res.clientAction.path, '/profile');
  });

  await t.test('open notes command returns clientAction navigate to /notes', async () => {
    const res = await runLocalFallbackEngine('open notes', [], null);
    assert.ok(res.clientAction);
    assert.equal(res.clientAction.type, 'navigate');
    assert.equal(res.clientAction.path, '/notes');
  });

  await t.test('open papers / pyqs command returns clientAction navigate to /papers', async () => {
    const res = await runLocalFallbackEngine('open pyqs', [], null);
    assert.ok(res.clientAction);
    assert.equal(res.clientAction.type, 'navigate');
    assert.equal(res.clientAction.path, '/papers');
  });

  await t.test('open resources command returns clientAction navigate to /resources', async () => {
    const res = await runLocalFallbackEngine('open resources', [], null);
    assert.ok(res.clientAction);
    assert.equal(res.clientAction.type, 'navigate');
    assert.equal(res.clientAction.path, '/resources');
  });

  await t.test('open support command returns clientAction navigate to /support', async () => {
    const res = await runLocalFallbackEngine('open support', [], null);
    assert.ok(res.clientAction);
    assert.equal(res.clientAction.type, 'navigate');
    assert.equal(res.clientAction.path, '/support');
  });

  await t.test('open profile command for auth user returns clientAction navigate to /profile', async () => {
    const res = await runLocalFallbackEngine('open profile', [], { id: 'usr_1' });
    assert.ok(res.clientAction);
    assert.equal(res.clientAction.type, 'navigate');
    assert.equal(res.clientAction.path, '/profile');
  });
});

test('Frontend Link & Action Behavior: No target="_blank" for internal StudyMyte links', () => {
  const appJs = fs.readFileSync('frontend/app.js', 'utf8');

  // Ensure extractInternalRoute helper is present
  assert.ok(appJs.includes('function extractInternalRoute'), 'extractInternalRoute must be defined in app.js');

  // Verify that navigate clientAction is supported in handleSendMyteeMessage
  assert.ok(appJs.includes("resData.clientAction.type === 'navigate'"), 'handleSendMyteeMessage must handle navigate clientAction');

  // Verify action:open_page: is supported
  assert.ok(appJs.includes("action:open_page:"), 'app.js must support action:open_page:');
});


const test = require('node:test');
const assert = require('node:assert/strict');
const {
  handleFunQuery,
  HACK_RESPONSES,
  USER_DATA_STUDENT_RESPONSES,
  FAKE_ADMIN_RESPONSES,
  FAKE_OWNER_RESPONSES,
  SIGMA_ACTIVATION,
  ROAST_ACTIVATION,
  BEAST_ACTIVATION,
  NORMAL_ACTIVATION
} = require('./services/mytee/funPersonalityService');

test.describe('MYTEE — Fun Personality & Gen-Z Interaction Suite', () => {

  test('1. "How can i hack site" returns witty Gen-Z roast and study redirection', () => {
    const queries = [
      'How can i hack site',
      'how to hack this website',
      'can i hack studymyte',
      'teach me to hack site',
      'hack this site'
    ];

    for (const q of queries) {
      const res = handleFunQuery(q);
      assert.ok(res, `Expected match for "${q}"`);
      assert.equal(res.matched, true);
      assert.ok(res.text.includes('💀'), `Expected skull emoji in roast for "${q}"`);
      assert.ok(res.actions.length > 0, `Expected redirection actions for "${q}"`);
    }
  });

  test('2. "i want all user data" roasts students/educators and directs admins appropriately', () => {
    const studentContext = { id: 'std123', role: 'student', email: 'student@example.com' };
    const educatorContext = { id: 'edu123', role: 'educator', email: 'teacher@example.com' };
    const adminContext = { id: 'adm123', role: 'admin', email: 'admin@studymyte.tech' };

    // Student attempt
    const studentRes = handleFunQuery('i want all user data', studentContext);
    assert.ok(studentRes && studentRes.matched);
    assert.ok(studentRes.text.includes('💀'), 'Expected humorous rejection for student');
    assert.ok(studentRes.text.toLowerCase().includes('database') || studentRes.text.toLowerCase().includes('notes'));

    // Educator attempt
    const educatorRes = handleFunQuery('give me all user data', educatorContext);
    assert.ok(educatorRes && educatorRes.matched);
    assert.ok(educatorRes.text.includes('💀'));

    // Admin attempt
    const adminRes = handleFunQuery('i want all user data', adminContext);
    assert.ok(adminRes && adminRes.matched);
    assert.ok(adminRes.text.includes('Administrative Access Verified'), 'Expected admin verification text');
    assert.equal(adminRes.actions[0].path, '/admin');
  });

  test('3. "I am admin" roasts non-admins and acknowledges genuine admins', () => {
    const studentContext = { id: 'std123', role: 'student' };
    const adminContext = { id: 'adm123', role: 'admin' };

    // Normal student claiming to be admin
    const fakeRes = handleFunQuery('I am admin', studentContext);
    assert.ok(fakeRes && fakeRes.matched);
    assert.ok(fakeRes.text.includes('💀') || fakeRes.text.includes('🗿'), 'Expected witty shutdown for fake admin');

    // Genuine admin
    const realRes = handleFunQuery('I am admin', adminContext);
    assert.ok(realRes && realRes.matched);
    assert.ok(realRes.text.includes('Welcome back, Admin!'), 'Expected admin greeting');
  });

  test('4. "I am owner of this site" roasts students and references Ankit/equity/assignments', () => {
    const studentContext = { id: 'std123', role: 'student', name: 'Random Guy', email: 'guy@gmail.com' };
    const founderContext = { id: 'fnd123', role: 'admin', name: 'Ankit', email: 'ankitgl200@studymyte.tech' };

    // Student claiming ownership
    const fakeRes = handleFunQuery('I am owner of this site', studentContext);
    assert.ok(fakeRes && fakeRes.matched);
    assert.ok(fakeRes.text.includes('💀'), 'Expected roast for fake owner claim');
    assert.ok(fakeRes.text.toLowerCase().includes('ankit') || fakeRes.text.toLowerCase().includes('equity') || fakeRes.text.toLowerCase().includes('founder'));

    // Verified creator
    const realRes = handleFunQuery('I am owner of this site', founderContext);
    assert.ok(realRes && realRes.matched);
    assert.ok(realRes.text.includes('creator') || realRes.text.includes('founder'));
  });

  test('4.5. "is btkit good or not" always returns positive, enthusiastic response in English', () => {
    const btkitQueries = [
      'what do you thing is BTKIT good or not',
      'is btkit good or not',
      'is btkit good',
      'how is btkit',
      'what do you think of btkit',
      'btkit review'
    ];

    for (const q of btkitQueries) {
      const res = handleFunQuery(q);
      assert.ok(res, `Expected match for BTKIT query: "${q}"`);
      assert.equal(res.matched, true);
      assert.ok(res.text.toLowerCase().includes('founder'), `Expected mention of founders for "${q}"`);
      assert.ok(res.text.toLowerCase().includes('born') || res.text.toLowerCase().includes('created') || res.text.toLowerCase().includes('engineered'), `Expected mention of MYTEE being born at BTKIT for "${q}"`);
    }
  });

  test('5. Mode switching: SIGMA, ROAST, BEAST, and NORMAL modes', () => {
    // Sigma Mode
    const sigmaRes = handleFunQuery('activate sigma mode');
    assert.ok(sigmaRes && sigmaRes.matched);
    assert.equal(sigmaRes.newMode, 'sigma');
    assert.ok(sigmaRes.text.includes('SIGMA MODE ACTIVATED'));

    // Roast Mode
    const roastRes = handleFunQuery('roast me');
    assert.ok(roastRes && roastRes.matched);
    assert.equal(roastRes.newMode, 'roast');
    assert.ok(roastRes.text.includes('ROAST MODE ACTIVATED'));

    // Beast Mode
    const beastRes = handleFunQuery('activate beast mode');
    assert.ok(beastRes && beastRes.matched);
    assert.equal(beastRes.newMode, 'beast');
    assert.ok(beastRes.text.includes('BEAST MODE UNLOCKED'));

    // Normal Mode
    const normalRes = handleFunQuery('normal mode');
    assert.ok(normalRes && normalRes.matched);
    assert.equal(normalRes.newMode, 'normal');
    assert.ok(normalRes.text.includes('Normal Mode Restored'));
  });

  test('6. Non-fun academic queries return null to allow normal flow', () => {
    const academic = [
      'maths pyq',
      'find 2nd year oops notes',
      'what is binary search',
      'site overview',
      'help with login'
    ];

    for (const q of academic) {
      const res = handleFunQuery(q);
      assert.equal(res, null, `Expected null for normal academic query: "${q}"`);
    }
  });

});


const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const express = require('express');
const jwt = require('jsonwebtoken');

// Import the patched document router and security helpers
const documentRouter = require('./routes/documents');
const {
  resolveSafeLocalPath,
  sanitizeFileName,
  validateExternalUrl
} = documentRouter;

const TEST_SECRET = 'test-secret-key-1234567890';

test('1. resolveSafeLocalPath security boundary verification', async (t) => {
  // Create a temporary sandbox uploads directory
  const testUploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyhub-sec-test-'));
  const safeFileName = 'doc-test-safe-1234.pdf';
  const safeFilePath = path.join(testUploadsDir, safeFileName);
  fs.writeFileSync(safeFilePath, '%PDF-1.4 test safe content');

  t.after(() => {
    try {
      fs.rmSync(testUploadsDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('Rejects path traversal with ../ sequences', () => {
    assert.equal(resolveSafeLocalPath('/uploads/../../test.txt', testUploadsDir), null);
    assert.equal(resolveSafeLocalPath('/uploads/..%2f..%2ftest.txt', testUploadsDir), null);
    assert.equal(resolveSafeLocalPath('/uploads/....//test.txt', testUploadsDir), null);
    assert.equal(resolveSafeLocalPath('/uploads/a/../../test.txt', testUploadsDir), null);
  });

  await t.test('Rejects Windows backslash traversal sequences', () => {
    assert.equal(resolveSafeLocalPath('/uploads/..\\..\\test.txt', testUploadsDir), null);
    assert.equal(resolveSafeLocalPath('/uploads\\..\\..\\test.txt', testUploadsDir), null);
    assert.equal(resolveSafeLocalPath('uploads\\..\\..\\test.txt', testUploadsDir), null);
  });

  await t.test('Rejects absolute Windows paths and drive letters', () => {
    assert.equal(resolveSafeLocalPath('/uploads/C:\\test.txt', testUploadsDir), null);
    assert.equal(resolveSafeLocalPath('/uploads/D:\\Windows\\test.txt', testUploadsDir), null);
    assert.equal(resolveSafeLocalPath('C:\\Windows\\System32\\drivers\\etc\\hosts', testUploadsDir), null);
  });

  await t.test('Rejects UNC paths and network shares', () => {
    assert.equal(resolveSafeLocalPath('/uploads/\\\\attacker-share\\file.pdf', testUploadsDir), null);
    assert.equal(resolveSafeLocalPath('\\\\127.0.0.1\\c$\\test.txt', testUploadsDir), null);
  });

  await t.test('Rejects null bytes and control characters', () => {
    assert.equal(resolveSafeLocalPath(`/uploads/${safeFileName}\0.jpg`, testUploadsDir), null);
    assert.equal(resolveSafeLocalPath(`/uploads/${safeFileName}\x1b`, testUploadsDir), null);
  });

  await t.test('Rejects non-existent files safely', () => {
    assert.equal(resolveSafeLocalPath('/uploads/doc-does-not-exist.pdf', testUploadsDir), null);
  });

  await t.test('Rejects directories and empty filenames', () => {
    assert.equal(resolveSafeLocalPath('/uploads/', testUploadsDir), null);
    assert.equal(resolveSafeLocalPath('/uploads/.', testUploadsDir), null);
    assert.equal(resolveSafeLocalPath('/uploads/..', testUploadsDir), null);
    assert.equal(resolveSafeLocalPath('', testUploadsDir), null);
    assert.equal(resolveSafeLocalPath(null, testUploadsDir), null);
  });

  await t.test('Resolves legitimate existing file inside uploads directory', () => {
    const resolved = resolveSafeLocalPath(`/uploads/${safeFileName}`, testUploadsDir);
    assert.ok(resolved, 'Should resolve valid file');
    assert.equal(fs.realpathSync(resolved), fs.realpathSync(safeFilePath));
  });
});

test('2. sanitizeFileName verification', () => {
  assert.equal(sanitizeFileName('../../secret.pdf'), 'secret.pdf');
  assert.equal(sanitizeFileName('..\\..\\secret.pdf'), 'secret.pdf');
  assert.equal(sanitizeFileName('file"with"quotes.pdf'), 'file_with_quotes.pdf');
  assert.equal(sanitizeFileName('file\r\nwith\nnewlines.pdf'), 'file__with_newlines.pdf');
  assert.equal(sanitizeFileName(''), 'document.pdf');
  assert.equal(sanitizeFileName(null), 'document.pdf');
});

test('3. validateExternalUrl SSRF protection', () => {
  // Loopback and internal addresses blocked
  assert.equal(validateExternalUrl('http://localhost/doc.pdf'), null);
  assert.equal(validateExternalUrl('http://127.0.0.1/doc.pdf'), null);
  assert.equal(validateExternalUrl('http://127.0.0.1:5000/doc.pdf'), null);
  assert.equal(validateExternalUrl('http://169.254.169.254/latest/meta-data/'), null);
  assert.equal(validateExternalUrl('http://192.168.1.1/secret.pdf'), null);
  assert.equal(validateExternalUrl('http://10.0.0.1/internal.pdf'), null);
  assert.equal(validateExternalUrl('file:///c:/test.pdf'), null);
  assert.equal(validateExternalUrl('javascript:alert(1)'), null);

  // Legitimate external HTTPS URL allowed
  const valid = validateExternalUrl('https://example.com/syllabus.pdf');
  assert.equal(valid, 'https://example.com/syllabus.pdf');
});

test('4. End-to-end download authorization and traversal resistance', async (t) => {
  // Setup isolated temporary uploads directory with sample files
  const testUploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyhub-endpoint-test-'));
  const approvedFileName = 'doc-approved-001.pdf';
  const pendingFileName = 'doc-pending-002.pdf';
  const rejectedFileName = 'doc-rejected-003.pdf';

  fs.writeFileSync(path.join(testUploadsDir, approvedFileName), '%PDF-1.4 Approved Document');
  fs.writeFileSync(path.join(testUploadsDir, pendingFileName), '%PDF-1.4 Pending Document');
  fs.writeFileSync(path.join(testUploadsDir, rejectedFileName), '%PDF-1.4 Rejected Document');

  // Also create a dummy file outside testUploadsDir to ensure traversal attempts cannot read it
  const parentDir = path.dirname(testUploadsDir);
  const secretFileOutside = path.join(parentDir, 'fake-sensitive.txt');
  fs.writeFileSync(secretFileOutside, 'CONFIDENTIAL TEST STRING');

  t.after(() => {
    try {
      fs.rmSync(testUploadsDir, { recursive: true, force: true });
      fs.unlinkSync(secretFileOutside);
    } catch {}
  });

  // Mock users
  const studentUser = { id: '65f000000000000000000001', role: 'student', approved: true, name: 'Student Alice' };
  const studentOther = { id: '65f000000000000000000002', role: 'student', approved: true, name: 'Student Bob' };
  const adminUser = { id: '65f000000000000000000003', role: 'admin', approved: true, name: 'Admin Charlie' };

  // Generate tokens
  const studentToken = jwt.sign(studentUser, TEST_SECRET);
  const otherStudentToken = jwt.sign(studentOther, TEST_SECRET);
  const adminToken = jwt.sign(adminUser, TEST_SECRET);

  // Mock in-memory database of documents
  const mockDocuments = {
    'doc-id-approved': {
      _id: 'doc-id-approved',
      title: 'Math Notes',
      fileName: 'math.pdf',
      fileUrl: `/uploads/${approvedFileName}`,
      status: 'approved',
      uploadedByUserId: studentUser.id
    },
    'doc-id-pending': {
      _id: 'doc-id-pending',
      title: 'Physics Lab Draft',
      fileName: 'physics.pdf',
      fileUrl: `/uploads/${pendingFileName}`,
      status: 'pending',
      uploadedByUserId: studentUser.id
    },
    'doc-id-rejected': {
      _id: 'doc-id-rejected',
      title: 'Spam File',
      fileName: 'spam.pdf',
      fileUrl: `/uploads/${rejectedFileName}`,
      status: 'rejected',
      uploadedByUserId: studentUser.id
    },
    'doc-id-traversal-attack': {
      _id: 'doc-id-traversal-attack',
      title: 'Malicious Traversal Document',
      fileName: 'attack.pdf',
      fileUrl: `/uploads/../fake-sensitive.txt`,
      status: 'approved',
      uploadedByUserId: studentUser.id
    }
  };

  // Build a test Express app mimicking the server configuration
  const app = express();

  // Test auth middleware using TEST_SECRET
  const testAuth = (req, res, next) => {
    let token = '';
    const authHeader = req.header('Authorization');
    if (authHeader) token = authHeader.replace('Bearer ', '');
    else if (req.query.token) token = req.query.token;

    if (!token) return res.status(401).json({ message: 'No token, authorization denied' });
    try {
      req.user = jwt.verify(token, TEST_SECRET);
      next();
    } catch {
      return res.status(401).json({ message: 'Token is not valid' });
    }
  };

  // Mount download handler using our security logic
  app.get('/api/documents/download/:id', testAuth, (req, res) => {
    const doc = mockDocuments[req.params.id];
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const isStaffOrAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'superadmin');
    const isOwner = req.user && doc.uploadedByUserId && doc.uploadedByUserId.toString() === req.user.id;

    if (doc.status !== 'approved' && !isStaffOrAdmin && !isOwner) {
      return res.status(403).json({ message: 'Access denied: Document is not approved' });
    }

    const safePath = resolveSafeLocalPath(doc.fileUrl, testUploadsDir);
    if (!safePath) {
      return res.status(404).json({ message: 'File not found on local disk' });
    }

    const fileName = sanitizeFileName(doc.fileName || 'document.pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/pdf');
    return res.sendFile(safePath);
  });

  // Start test server on random port
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/documents/download`;

  t.after(() => {
    server.close();
  });

  await t.test('Rejects unauthenticated download requests with 401', async () => {
    const res = await fetch(`${baseUrl}/doc-id-approved`);
    assert.equal(res.status, 401);
  });

  await t.test('Rejects non-existent document with 404', async () => {
    const res = await fetch(`${baseUrl}/doc-non-existent`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.message, 'Document not found');
  });

  await t.test('Allows ordinary student to download approved document', async () => {
    const res = await fetch(`${baseUrl}/doc-id-approved`, {
      headers: { Authorization: `Bearer ${otherStudentToken}` }
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('Approved Document'));
  });

  await t.test('Blocks other student from downloading pending document (403)', async () => {
    const res = await fetch(`${baseUrl}/doc-id-pending`, {
      headers: { Authorization: `Bearer ${otherStudentToken}` }
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.message, 'Access denied: Document is not approved');
  });

  await t.test('Allows original contributor/owner to download their own pending document', async () => {
    const res = await fetch(`${baseUrl}/doc-id-pending`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('Pending Document'));
  });

  await t.test('Allows admin to download pending document for review', async () => {
    const res = await fetch(`${baseUrl}/doc-id-pending`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('Pending Document'));
  });

  await t.test('Blocks other student from downloading rejected document (403)', async () => {
    const res = await fetch(`${baseUrl}/doc-id-rejected`, {
      headers: { Authorization: `Bearer ${otherStudentToken}` }
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.message, 'Access denied: Document is not approved');
  });

  await t.test('Blocks path traversal attempt in database record and does not reveal filesystem paths', async () => {
    const res = await fetch(`${baseUrl}/doc-id-traversal-attack`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.message, 'File not found on local disk');
    // Ensure the fake sensitive string was NOT returned
    const text = JSON.stringify(body);
    assert.ok(!text.includes('CONFIDENTIAL TEST STRING'));
    assert.ok(!text.includes(testUploadsDir));
    assert.ok(!text.includes('fake-sensitive.txt'));
  });
});

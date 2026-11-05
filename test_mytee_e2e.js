/**
 * End-to-End HTTP Route Verification for MYTEE
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');

const config = require('./config');
const myteeRoutes = require('./routes/mytee');
const { User, Document } = require('./db/models');

describe('MYTEE E2E HTTP Endpoints', () => {
  let app;
  let server;
  let port;
  let adminToken;
  let studentToken;

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.MONGODB_URI);
    }

    const student = await User.findOne({ role: 'student', approved: true });
    const admin = await User.findOne({ role: 'admin', approved: true });

    const jwt = require('jsonwebtoken');
    studentToken = student ? jwt.sign({ id: student._id.toString(), role: 'student' }, config.JWT_SECRET) : '';
    adminToken = admin ? jwt.sign({ id: admin._id.toString(), role: 'admin' }, config.JWT_SECRET) : '';

    app = express();
    app.use(express.json());
    app.use('/api/mytee', myteeRoutes);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise(r => server.close(r));
    try {
      await mongoose.disconnect();
    } catch (e) {}
  });

  function makeRequest(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const reqHeaders = {
        'Content-Type': 'application/json',
        ...headers
      };
      if (payload) {
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = http.request({
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: reqHeaders
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data });
          }
        });
      });

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  test('GET /api/mytee/info returns verified website information', async () => {
    const res = await makeRequest('GET', '/api/mytee/info');
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.info.websiteName, 'StudyMyte');
    assert.ok(Array.isArray(res.data.routes));
  });

  test('POST /api/mytee/chat rejects unauthenticated users (requires login)', async () => {
    const res = await makeRequest('POST', '/api/mytee/chat', {
      message: 'Hello'
    });
    assert.equal(res.status, 401);
    assert.equal(res.data.requiresLogin, true);
    assert.ok(res.data.reply.includes('Please Log In to Access MYTEE'));
  });

  test('POST /api/mytee/chat handles scope rejection politely for logged-in user', async () => {
    const res = await makeRequest('POST', '/api/mytee/chat', {
      message: 'Who will win the next political election?'
    }, {
      'Authorization': `Bearer ${studentToken}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.scopeRejected, true);
    assert.ok(res.data.reply.includes('I am MYTEE, the official AI assistant of StudyMyte'));
  });

  test('POST /api/mytee/chat returns resources for academic queries for logged-in user', async () => {
    const res = await makeRequest('POST', '/api/mytee/chat', {
      message: 'Give me PYQs for 2nd year OOPS'
    }, {
      'Authorization': `Bearer ${studentToken}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.ok(res.data.reply);
    assert.ok(Array.isArray(res.data.resources));
  });

  test('POST /api/mytee/admin/chat requires admin authentication (401/403 for students)', async () => {
    const unauthRes = await makeRequest('POST', '/api/mytee/admin/chat', {
      question: 'How many users joined this week?'
    });
    assert.equal(unauthRes.status, 401);

    const studentRes = await makeRequest('POST', '/api/mytee/admin/chat', {
      question: 'How many users joined this week?'
    }, {
      'Authorization': `Bearer ${studentToken}`
    });
    assert.equal(studentRes.status, 403);
  });

  test('POST /api/mytee/admin/chat executes for authorized admin', async () => {
    if (!adminToken) return;
    const adminRes = await makeRequest('POST', '/api/mytee/admin/chat', {
      question: 'How many users joined this week?'
    }, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.equal(adminRes.status, 200);
    assert.equal(adminRes.data.success, true);
    assert.ok(adminRes.data.report);
  });

  test('POST /api/mytee/feedback submits feedback successfully', async () => {
    const res = await makeRequest('POST', '/api/mytee/feedback', {
      rating: 'helpful',
      comment: 'Very fast and accurate answer!'
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
  });
});


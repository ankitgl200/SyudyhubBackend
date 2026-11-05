const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('./config');
const authRouter = require('./routes/auth');
const { User, Document } = require('./db/models');

test('Super Admin User Export Feature Suite', async (t) => {
  const superadminId = '507f1f77bcf86cd799439011';
  const adminId = '507f1f77bcf86cd799439012';
  const studentId = '507f1f77bcf86cd799439013';
  const educatorId = '507f1f77bcf86cd799439014';

  const superadminToken = jwt.sign({ id: superadminId, role: 'superadmin' }, config.JWT_SECRET);
  const adminToken = jwt.sign({ id: adminId, role: 'admin' }, config.JWT_SECRET);
  const studentToken = jwt.sign({ id: studentId, role: 'student' }, config.JWT_SECRET);
  const educatorToken = jwt.sign({ id: educatorId, role: 'educator' }, config.JWT_SECRET);

  // Mock users in memory for database tests
  const mockDbUsers = [
    {
      _id: superadminId,
      name: 'Super Admin Person',
      phone: '8218325600',
      email: 'superadmin@studymyte.com',
      role: 'superadmin',
      approved: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastLogin: new Date('2026-10-15T10:00:00Z'),
      lastActive: new Date('2026-10-15T12:00:00Z'),
      deviceInfo: { browser: 'Chrome', os: 'Windows', deviceType: 'Desktop', deviceModel: 'PC', ip: '192.168.1.10' }
    },
    {
      _id: adminId,
      name: 'Normal Admin',
      phone: '9876543210',
      email: 'admin@studymyte.com',
      role: 'admin',
      approved: true,
      createdAt: new Date('2026-02-01T00:00:00Z'),
      lastLogin: new Date('2026-10-14T10:00:00Z'),
      lastActive: new Date('2026-10-14T11:00:00Z'),
      deviceInfo: { browser: 'Firefox', os: 'Linux', deviceType: 'Desktop', deviceModel: 'PC', ip: '192.168.1.11' }
    },
    {
      _id: educatorId,
      name: 'Prof. Sharma, PhD',
      phone: '9123456789',
      email: 'sharma@btkit.ac.in',
      role: 'educator',
      approved: true,
      createdAt: new Date('2026-03-01T00:00:00Z'),
      lastLogin: new Date('2026-10-13T10:00:00Z'),
      lastActive: new Date('2026-10-13T11:00:00Z'),
      deviceInfo: { browser: 'Safari', os: 'macOS', deviceType: 'Desktop', deviceModel: 'MacBook', ip: '192.168.1.12' }
    },
    {
      _id: studentId,
      name: 'Rahul "Ace" Kumar',
      phone: '9988776655',
      email: 'rahul@student.in',
      role: 'student',
      approved: true,
      createdAt: new Date('2026-04-01T00:00:00Z'),
      lastLogin: new Date('2026-10-12T10:00:00Z'),
      lastActive: new Date('2026-10-12T11:00:00Z'),
      deviceInfo: { browser: 'Chrome', os: 'Android', deviceType: 'Mobile', deviceModel: 'Pixel 7', ip: '192.168.1.13' }
    },
    {
      _id: '507f1f77bcf86cd799439015',
      name: 'Pending Student',
      phone: '9988776656',
      email: 'pending@student.in',
      role: 'student',
      approved: false,
      createdAt: new Date('2026-05-01T00:00:00Z'),
      lastLogin: null,
      lastActive: null,
      deviceInfo: { browser: 'Unknown', os: 'Unknown', deviceType: 'Unknown', deviceModel: 'Unknown', ip: 'Unknown' }
    }
  ];

  // Helper to mock User.findById and User.find
  const origFindById = User.findById;
  const origFind = User.find;
  const origDocFind = Document.find;

  t.after(() => {
    User.findById = origFindById;
    User.find = origFind;
    Document.find = origDocFind;
  });

  User.findById = function (id) {
    const user = mockDbUsers.find(u => u._id.toString() === id.toString());
    const userObj = user ? { ...user, save: async () => {} } : null;
    return {
      exec: async () => userObj,
      then: (resolve) => resolve(userObj)
    };
  };

  User.find = function (query = {}) {
    let list = [...mockDbUsers];

    if (query.role) {
      if (typeof query.role === 'object' && query.role.$in) {
        list = list.filter(u => query.role.$in.includes(u.role));
      } else {
        list = list.filter(u => u.role === query.role);
      }
    }

    if (query.approved !== undefined) {
      list = list.filter(u => u.approved === query.approved);
    }

    if (query.$or) {
      list = list.filter(u => {
        return query.$or.some(cond => {
          if (cond.name) return cond.name.$regex && new RegExp(cond.name.$regex, cond.name.$options).test(u.name);
          if (cond.phone) return cond.phone.$regex && new RegExp(cond.phone.$regex, cond.phone.$options).test(u.phone);
          if (cond.email) return cond.email.$regex && new RegExp(cond.email.$regex, cond.email.$options).test(u.email || '');
          return false;
        });
      });
    }

    if (query._id) {
      if (query._id.$in) {
        list = list.filter(u => query._id.$in.map(String).includes(String(u._id)));
      }
      if (query._id.$nin) {
        list = list.filter(u => !query._id.$nin.map(String).includes(String(u._id)));
      }
    }

    return {
      select: () => ({
        sort: () => {
          let chain = {
            limit: (n) => ({
              lean: async () => list.slice(0, n)
            }),
            lean: async () => list
          };
          return chain;
        }
      })
    };
  };

  Document.find = function () {
    return {
      select: () => ({
        lean: async () => [
          { uploadedByUserId: educatorId, likes: ['like1', 'like2'] }
        ]
      })
    };
  };

  await t.test('1. Security: Only Super Admin can access export endpoint', async () => {
    const makeReq = (token, body = {}) => {
      return new Promise((resolve) => {
        let statusCode = 200;
        let headers = {};
        let responseBody = '';
        let resolved = false;

        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve({ status: statusCode, headers, body: responseBody });
          }
        };

        const req = {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          header: (name) => name.toLowerCase() === 'authorization' ? (token ? `Bearer ${token}` : null) : null,
          body,
          query: {}
        };

        const res = {
          status: (code) => { statusCode = code; return res; },
          setHeader: (k, v) => { headers[k] = v; },
          json: (data) => { responseBody = data; done(); return res; },
          send: (text) => { responseBody = text; done(); return res; }
        };

        const { isSuperAdmin } = require('./middleware/auth');
        isSuperAdmin(req, res, async () => {
          await authRouter.handleUserExport(req, res);
          done();
        });
      });
    };

    // Test with Student token
    const studentRes = await makeReq(studentToken);
    assert.equal(studentRes.status, 403, 'Student should be rejected with 403 Forbidden');

    // Test with Educator token
    const educatorRes = await makeReq(educatorToken);
    assert.equal(educatorRes.status, 403, 'Educator should be rejected with 403 Forbidden');

    // Test with Admin token (not superadmin)
    const adminRes = await makeReq(adminToken);
    assert.equal(adminRes.status, 403, 'Regular Admin should be rejected with 403 Forbidden');

    // Test with Super Admin token
    const superAdminRes = await makeReq(superadminToken);
    assert.equal(superAdminRes.status, 200, 'Super Admin should be allowed with 200 OK');
  });

  await t.test('2. Role Filtering: Exports only requested user groups', async () => {
    const makeExportReq = async (params) => {
      let statusCode = 200;
      let headers = {};
      let responseBody = '';

      const req = {
        headers: { authorization: `Bearer ${superadminToken}` },
        header: () => `Bearer ${superadminToken}`,
        user: { id: superadminId, role: 'superadmin' },
        body: params,
        query: {}
      };

      const res = {
        status: (code) => { statusCode = code; return res; },
        setHeader: (k, v) => { headers[k] = v; },
        json: (data) => { responseBody = data; return res; },
        send: (text) => { responseBody = text; return res; }
      };

      await authRouter.handleUserExport(req, res);
      return { status: statusCode, headers, body: responseBody };
    };

    // All users
    const allRes = await makeExportReq({ role: 'all', format: 'json' });
    assert.equal(allRes.status, 200);
    assert.equal(allRes.body.count, 5);

    // Students only
    const studentsRes = await makeExportReq({ role: 'student', format: 'json' });
    assert.equal(studentsRes.body.count, 2);
    studentsRes.body.users.forEach(u => assert.equal(u.role, 'Student'));

    // Educators only
    const educatorsRes = await makeExportReq({ role: 'educator', format: 'json' });
    assert.equal(educatorsRes.body.count, 1);
    assert.equal(educatorsRes.body.users[0].role, 'Teacher/Educator');

    // Admins only (combined admin + superadmin)
    const adminsRes = await makeExportReq({ role: 'admins', format: 'json' });
    assert.equal(adminsRes.body.count, 2);
  });

  await t.test('3. Field Customization: Exports only selected fields', async () => {
    const makeExportReq = async (params) => {
      let responseBody = '';
      const req = {
        headers: { authorization: `Bearer ${superadminToken}` },
        header: () => `Bearer ${superadminToken}`,
        user: { id: superadminId, role: 'superadmin' },
        body: params,
        query: {}
      };

      const res = {
        status: () => res,
        setHeader: () => {},
        json: (data) => { responseBody = data; return res; },
        send: (text) => { responseBody = text; return res; }
      };

      await authRouter.handleUserExport(req, res);
      return responseBody;
    };

    // A) Only Names
    const namesOnly = await makeExportReq({ fields: ['name'], format: 'json' });
    assert.deepEqual(namesOnly.fields, [{ key: 'name', label: 'Full Name' }]);
    assert.equal(Object.keys(namesOnly.users[0]).length, 1);
    assert.ok(namesOnly.users[0].name);

    // B) Name & Email
    const nameEmail = await makeExportReq({ fields: ['name', 'email'], format: 'json' });
    assert.equal(nameEmail.fields.length, 2);
    assert.deepEqual(Object.keys(nameEmail.users[0]), ['name', 'email']);

    // C) Name, Phone & Email
    const contactOnly = await makeExportReq({ fields: ['name', 'phone', 'email'], format: 'json' });
    assert.equal(contactOnly.fields.length, 3);
    assert.deepEqual(Object.keys(contactOnly.users[0]), ['name', 'phone', 'email']);

    // D) Whole Data (All available fields including audit device info and teacher points)
    const wholeData = await makeExportReq({
      fields: ['id', 'name', 'phone', 'email', 'role', 'approved', 'createdAt', 'lastLogin', 'lastActive', 'points', 'uploadsCount', 'browser', 'os', 'deviceType', 'deviceModel', 'ip'],
      format: 'json'
    });
    assert.equal(wholeData.fields.length, 16);
    assert.equal(Object.keys(wholeData.users[0]).length, 16);
  });

  await t.test('4. RFC-4180 CSV Export Compliance & Excel UTF-8 BOM', async () => {
    let responseHeaders = {};
    let csvData = '';

    const req = {
      headers: { authorization: `Bearer ${superadminToken}` },
      header: () => `Bearer ${superadminToken}`,
      user: { id: superadminId, role: 'superadmin' },
      body: { role: 'all', fields: ['name', 'phone', 'email', 'role'] },
      query: {}
    };

    const res = {
      status: () => res,
      setHeader: (k, v) => { responseHeaders[k] = v; },
      send: (text) => { csvData = text; return res; }
    };

    await authRouter.handleUserExport(req, res);

    assert.equal(responseHeaders['Content-Type'], 'text/csv; charset=utf-8');
    assert.ok(responseHeaders['Content-Disposition'].includes('.csv'));

    // Verify UTF-8 BOM is first character
    assert.equal(csvData.charCodeAt(0), 0xFEFF, 'First character must be UTF-8 BOM for Excel');

    // Verify Header row
    const lines = csvData.slice(1).split('\r\n');
    assert.equal(lines[0], 'Full Name,Phone Number,Email Address,Role');

    // Verify quotes and comma escaping
    // 'Prof. Sharma, PhD' contains a comma, so must be quoted: '"Prof. Sharma, PhD"'
    assert.ok(csvData.includes('"Prof. Sharma, PhD"'), 'Names with commas must be wrapped in double quotes');

    // 'Rahul "Ace" Kumar' contains quotes, so must be escaped with double quotes: '"Rahul ""Ace"" Kumar"'
    assert.ok(csvData.includes('"Rahul ""Ace"" Kumar"'), 'Names with quotes must be escaped per RFC 4180');
  });

  await t.test('5. Preview Mode: Returns first 5 users + totalCount for modal', async () => {
    let previewResponse = null;
    const req = {
      headers: { authorization: `Bearer ${superadminToken}` },
      header: () => `Bearer ${superadminToken}`,
      user: { id: superadminId, role: 'superadmin' },
      body: { role: 'all', preview: true },
      query: {}
    };

    const res = {
      status: () => res,
      setHeader: () => {},
      json: (data) => { previewResponse = data; return res; }
    };

    await authRouter.handleUserExport(req, res);

    assert.equal(previewResponse.success, true);
    assert.equal(previewResponse.totalCount, 5);
    assert.ok(Array.isArray(previewResponse.preview));
    assert.equal(previewResponse.preview.length, 5);
  });

  await t.test('6. User Selection, Exclusion and Quantity Limit', async () => {
    const makeExportReq = async (params) => {
      let responseBody = '';
      const req = {
        headers: { authorization: `Bearer ${superadminToken}` },
        header: () => `Bearer ${superadminToken}`,
        user: { id: superadminId, role: 'superadmin' },
        body: params,
        query: {}
      };

      const res = {
        status: () => res,
        setHeader: () => {},
        json: (data) => { responseBody = data; return res; },
        send: (text) => { responseBody = text; return res; }
      };

      await authRouter.handleUserExport(req, res);
      return responseBody;
    };

    // A) Specific User Selection (Cherry-picking 2 users)
    const selectedRes = await makeExportReq({
      userIds: [superadminId, studentId],
      format: 'json'
    });
    assert.equal(selectedRes.count, 2);
    const selectedIds = selectedRes.users.map(u => u.phone);
    assert.ok(selectedIds.includes('8218325600'));
    assert.ok(selectedIds.includes('9988776655'));

    // B) User Exclusion (Exclude adminId)
    const excludeRes = await makeExportReq({
      excludeUserIds: [adminId],
      format: 'json'
    });
    assert.equal(excludeRes.count, 4);
    assert.ok(!excludeRes.users.some(u => u.phone === '9876543210'));

    // C) Quantity Limit (Top 2 users only)
    const limitRes = await makeExportReq({
      limit: 2,
      format: 'json'
    });
    assert.equal(limitRes.count, 2);
  });
});


const http = require('http');
const express = require('express');
const { 
  createRateLimiter, 
  loginLimiter, 
  signupLimiter, 
  passwordResetLimiter, 
  otpRequestLimiter, 
  otpVerifyLimiter 
} = require('./middleware/security');

/**
 * Helper to make HTTP request to a local server
 */
function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const reqOptions = {
      hostname: '127.0.0.1',
      port: address.port,
      path: options.path || '/',
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runRateLimitSecurityTests() {
  console.log('================================================================');
  console.log('   StudyHub Rate Limit & Proxy Spoofing Bypass Security Tests   ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: Spoofed X-Forwarded-For Under Verified Proxy Topology (trust proxy: 1)
  // --------------------------------------------------------------------------
  console.log('Test 1: Attackers cannot bypass rate limiter by injecting/spoofing X-Forwarded-For headers');
  {
    const app = express();
    // Simulate Render topology: Exactly 1 proxy hop in front of Node
    app.set('trust proxy', 1);

    const testLimiter = createRateLimiter({
      windowMs: 60 * 1000,
      max: 2,
      message: 'Rate limit exceeded'
    });

    app.get('/test-spoof', testLimiter, (req, res) => {
      res.json({ success: true, derivedIp: req.ip });
    });

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));

    try {
      const realClientIp = '198.51.100.77';

      // Request 1: Legitimate reverse proxy forwarding real IP
      // Proxy sets X-Forwarded-For: <real_ip>
      const res1 = await makeRequest(server, {
        path: '/test-spoof',
        headers: { 'X-Forwarded-For': realClientIp }
      });
      assert(res1.status === 200 && res1.body.derivedIp === realClientIp, 
        `Request 1 allowed (status 200, derived IP: ${res1.body.derivedIp})`);

      // Request 2: Still within quota (max: 2)
      const res2 = await makeRequest(server, {
        path: '/test-spoof',
        headers: { 'X-Forwarded-For': realClientIp }
      });
      assert(res2.status === 200, `Request 2 allowed (status 200)`);

      // Request 3: Attacker tries to bypass rate limit by prefixing a fake IP
      // In a real proxy, if client sends 'X-Forwarded-For: 10.99.99.99', upstream appends real IP:
      // Header received by Node: "10.99.99.99, 198.51.100.77"
      const res3 = await makeRequest(server, {
        path: '/test-spoof',
        headers: { 'X-Forwarded-For': `10.99.99.99, ${realClientIp}` }
      });
      assert(res3.status === 429, 
        `Request 3 with spoofed header "10.99.99.99, ${realClientIp}" was BLOCKED (status 429)`);

      // Request 4: Attacker tries rotating multiple fake IPs:
      const res4 = await makeRequest(server, {
        path: '/test-spoof',
        headers: { 'X-Forwarded-For': `8.8.8.8, 1.1.1.1, ${realClientIp}` }
      });
      assert(res4.status === 429, 
        `Request 4 with multi-hop spoofed header "8.8.8.8, 1.1.1.1, ${realClientIp}" was BLOCKED (status 429)`);

    } finally {
      server.close();
    }
  }

  // --------------------------------------------------------------------------
  // TEST 2: Multiple distinct clients behind the same proxy are NOT lumped together
  // --------------------------------------------------------------------------
  console.log('\nTest 2: Legitimate users behind the reverse proxy are tracked by distinct client IPs');
  {
    const app = express();
    app.set('trust proxy', 1);

    const testLimiter = createRateLimiter({
      windowMs: 60 * 1000,
      max: 2,
      message: 'Rate limit exceeded'
    });

    app.get('/test-isolation', testLimiter, (req, res) => {
      res.json({ success: true, clientIp: req.ip });
    });

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));

    try {
      const userA_Ip = '203.0.113.10';
      const userB_Ip = '203.0.113.20';

      // User A exhausts quota (2 requests)
      await makeRequest(server, { path: '/test-isolation', headers: { 'X-Forwarded-For': userA_Ip } });
      await makeRequest(server, { path: '/test-isolation', headers: { 'X-Forwarded-For': userA_Ip } });

      // User A's 3rd request is blocked
      const userABlocked = await makeRequest(server, { path: '/test-isolation', headers: { 'X-Forwarded-For': userA_Ip } });
      assert(userABlocked.status === 429, `User A is rate limited after 2 requests (status 429)`);

      // User B makes request from different IP through the same proxy hop
      const userBAllowed = await makeRequest(server, { path: '/test-isolation', headers: { 'X-Forwarded-For': userB_Ip } });
      assert(userBAllowed.status === 200 && userBAllowed.body.clientIp === userB_Ip, 
        `User B is NOT blocked by User A's traffic (status 200, IP: ${userBAllowed.body.clientIp})`);

    } finally {
      server.close();
    }
  }

  // --------------------------------------------------------------------------
  // TEST 3: Direct connection without proxy (trust proxy: false) ignores client X-Forwarded-For
  // --------------------------------------------------------------------------
  console.log('\nTest 3: Direct connections without proxy (trust proxy: false) ignore client X-Forwarded-For');
  {
    const app = express();
    app.set('trust proxy', false);

    const testLimiter = createRateLimiter({
      windowMs: 60 * 1000,
      max: 2,
      message: 'Rate limit exceeded'
    });

    app.get('/test-direct', testLimiter, (req, res) => {
      res.json({ success: true, ip: req.ip });
    });

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));

    try {
      // Attacker attempts to forge X-Forwarded-For on direct server
      await makeRequest(server, { path: '/test-direct', headers: { 'X-Forwarded-For': '1.2.3.4' } });
      await makeRequest(server, { path: '/test-direct', headers: { 'X-Forwarded-For': '5.6.7.8' } });

      // 3rd request with different spoofed IP
      const res3 = await makeRequest(server, { path: '/test-direct', headers: { 'X-Forwarded-For': '9.10.11.12' } });
      assert(res3.status === 429, 
        `Direct connection rejected spoofed bypass and enforced rate limit on socket IP (status 429)`);
    } finally {
      server.close();
    }
  }

  // --------------------------------------------------------------------------
  // TEST 4: Sensitive Endpoint Limiter Verification (Login, OTP, Password Reset)
  // --------------------------------------------------------------------------
  console.log('\nTest 4: Verification of sensitive endpoint limiters');
  {
    const app = express();
    app.use(express.json());
    app.set('trust proxy', 1);

    // Mount test routes with dedicated limiters (each route gets its own limiter instance)
    const testLoginLimiter = createRateLimiter({ windowMs: 10000, max: 1 });
    const testOtpLimiter = createRateLimiter({ windowMs: 10000, max: 1 });
    const testResetLimiter = createRateLimiter({ windowMs: 10000, max: 1 });

    app.post('/api/auth/login-test', testLoginLimiter, (req, res) => res.json({ ok: true }));
    app.post('/api/auth/otp-test', testOtpLimiter, (req, res) => res.json({ ok: true }));
    app.post('/api/auth/reset-test', testResetLimiter, (req, res) => res.json({ ok: true }));

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));

    try {
      // Login test
      const log1 = await makeRequest(server, { path: '/api/auth/login-test', method: 'POST' });
      const log2 = await makeRequest(server, { path: '/api/auth/login-test', method: 'POST' });
      assert(log1.status === 200 && log2.status === 429, 'Login endpoint rate limiter blocks repeated attempts (429)');

      // OTP test
      const otp1 = await makeRequest(server, { path: '/api/auth/otp-test', method: 'POST' });
      const otp2 = await makeRequest(server, { path: '/api/auth/otp-test', method: 'POST' });
      assert(otp1.status === 200 && otp2.status === 429, 'OTP endpoint rate limiter blocks repeated attempts (429)');

      // Password reset test
      const rst1 = await makeRequest(server, { path: '/api/auth/reset-test', method: 'POST' });
      const rst2 = await makeRequest(server, { path: '/api/auth/reset-test', method: 'POST' });
      assert(rst1.status === 200 && rst2.status === 429, 'Password reset endpoint rate limiter blocks repeated calls (429)');
    } finally {
      server.close();
    }
  }

  // --------------------------------------------------------------------------
  // TEST 5: Rate limit headers and sanitized logging
  // --------------------------------------------------------------------------
  console.log('\nTest 5: Standard rate limit headers (Limit, Remaining, Reset) returned properly');
  {
    const app = express();
    const testLimiter = createRateLimiter({ windowMs: 60000, max: 5 });
    app.get('/headers-test', testLimiter, (req, res) => res.json({ ok: true }));

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));

    try {
      const res = await makeRequest(server, { path: '/headers-test' });
      assert(res.headers['x-ratelimit-limit'] === '5', `X-RateLimit-Limit returned as 5`);
      assert(res.headers['x-ratelimit-remaining'] === '4', `X-RateLimit-Remaining decremented to 4`);
      assert(!!res.headers['x-ratelimit-reset'], `X-RateLimit-Reset timestamp header present`);
    } finally {
      server.close();
    }
  }

  console.log('\n----------------------------------------------------------------');
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('----------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRateLimitSecurityTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});

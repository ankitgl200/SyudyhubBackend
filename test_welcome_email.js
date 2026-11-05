const test = require('node:test');
const assert = require('node:assert/strict');
const { sendWelcomeEmail, emailjs, maskEmail } = require('./services/emailService');
const config = require('./config');

test('Email Service - maskEmail', () => {
  assert.equal(maskEmail('john.doe@example.com'), 'jo***e@example.com');
  assert.equal(maskEmail('a@b.com'), 'a***@b.com');
  assert.equal(maskEmail(''), '');
});

test('Email Service - sendWelcomeEmail parameter validation', async () => {
  await assert.rejects(
    async () => {
      await sendWelcomeEmail({ name: 'Test User' });
    },
    /Recipient email is required for welcome email dispatch/
  );
});

test('Email Service - sendWelcomeEmail configuration defaults', () => {
  assert.equal(typeof config.EMAILJS.SERVICE_ID, 'string');
  assert.equal(typeof config.EMAILJS.WELCOME_TEMPLATE_ID, 'string');
  assert.equal(typeof config.EMAILJS.PUBLIC_KEY, 'string');
});

test('Email Service - emailjs.send wrapper exists and is callable', () => {
  assert.equal(typeof emailjs.send, 'function');
});

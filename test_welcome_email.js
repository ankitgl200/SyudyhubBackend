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
  assert.equal(config.EMAILJS.SERVICE_ID, 'service_k0369d9');
  assert.equal(config.EMAILJS.WELCOME_TEMPLATE_ID, 'template_4coiqgc');
  assert.equal(config.EMAILJS.PUBLIC_KEY, 'EADCytMay61qrmUUk');
});

test('Email Service - emailjs.send wrapper exists and is callable', () => {
  assert.equal(typeof emailjs.send, 'function');
});

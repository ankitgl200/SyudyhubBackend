const config = require('../config');

/**
 * Mask an email address for safe logging and UI display.
 * Example: ankit.ghugtyal@gmail.com -> an***l@gmail.com
 */
function maskEmail(email) {
  if (!email || !email.includes('@')) return email || '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) {
    return local[0] + '***@' + domain;
  }
  return local.slice(0, 2) + '***' + local.slice(-1) + '@' + domain;
}

/**
 * Server-Side Email Dispatcher using EmailJS REST API.
 * The browser NEVER initiates or modifies this call.
 *
 * @param {Object} params
 * @param {string} params.email - Verified recipient email from database
 * @param {string} params.name - User's name
 * @param {string} params.otp - Cryptographically generated 6-digit OTP
 * @param {string} [params.purpose='password_reset'] - Purpose description
 * @returns {Promise<{ success: boolean, messageId?: string }>}
 */
async function sendOtpEmail({ email, name, otp, purpose = 'password_reset' }) {
  if (!email || !otp) {
    throw new Error('Recipient email and OTP code are required for dispatch.');
  }

  const cleanEmail = email.trim().toLowerCase();
  const displayName = name ? name.trim() : 'StudyMyte Student';

  // Build payload for EmailJS REST API
  const payload = {
    service_id: config.EMAILJS.SERVICE_ID,
    template_id: config.EMAILJS.TEMPLATE_ID,
    user_id: config.EMAILJS.PUBLIC_KEY,
    template_params: {
      OTP: String(otp),
      name: displayName,
      email: cleanEmail
    }
  };

  if (config.EMAILJS.PRIVATE_KEY) {
    payload.accessToken = config.EMAILJS.PRIVATE_KEY;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Origin': config.EMAILJS.ORIGIN || 'https://studymyte4students.vercel.app'
  };

  try {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[EmailService] Provider returned HTTP ${response.status} for ${maskEmail(cleanEmail)}: ${responseText}`);
      throw new Error(`Email provider failed to dispatch code (HTTP ${response.status}).`);
    }

    // Security audit log (NEVER log plaintext OTP)
    console.log(`[Security Audit] OTP email dispatched via EmailJS to ${maskEmail(cleanEmail)} for purpose: ${purpose}`);

    return {
      success: true,
      provider: 'emailjs',
      recipientMasked: maskEmail(cleanEmail)
    };
  } catch (err) {
    console.error(`[EmailService Error] Failed to send OTP to ${maskEmail(cleanEmail)}:`, err.message);
    throw err;
  }
}

/**
 * Low-level EmailJS dispatcher matching the signature:
 * emailjs.send(service_id, template_id, template_params)
 *
 * @param {string} serviceId - EmailJS service ID (defaults to config)
 * @param {string} templateId - EmailJS template ID
 * @param {Object} templateParams - Parameters for the template (e.g. { name, email })
 * @returns {Promise<{ success: boolean, provider: string, recipientMasked: string }>}
 */
async function sendEmailJs(serviceId, templateId, templateParams = {}) {
  const cleanEmail = (templateParams.email || '').trim().toLowerCase();

  const payload = {
    service_id: serviceId || config.EMAILJS.SERVICE_ID,
    template_id: templateId,
    user_id: config.EMAILJS.PUBLIC_KEY,
    template_params: templateParams
  };

  if (config.EMAILJS.PRIVATE_KEY) {
    payload.accessToken = config.EMAILJS.PRIVATE_KEY;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Origin': config.EMAILJS.ORIGIN || 'https://studymyte4students.vercel.app'
  };

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error(`[EmailService] Provider returned HTTP ${response.status} for ${maskEmail(cleanEmail)}: ${responseText}`);
    throw new Error(`EmailJS failed to dispatch email (HTTP ${response.status}).`);
  }

  return {
    success: true,
    provider: 'emailjs',
    recipientMasked: maskEmail(cleanEmail)
  };
}

const emailjs = {
  send: (serviceId, templateId, templateParams) => sendEmailJs(serviceId, templateId, templateParams)
};

/**
 * Send a welcome email to newly registered users.
 * Dispatches via EmailJS REST API:
 * service: config.EMAILJS.SERVICE_ID ("service_k0369d9")
 * template: config.EMAILJS.WELCOME_TEMPLATE_ID ("template_4coiqgc")
 * params: { name: username, email: user-email }
 *
 * @param {Object} params
 * @param {string} params.email - Recipient email
 * @param {string} params.name - User's display name
 * @returns {Promise<{ success: boolean, provider: string, recipientMasked: string }>}
 */
async function sendWelcomeEmail({ email, name }) {
  if (!email) {
    throw new Error('Recipient email is required for welcome email dispatch.');
  }

  const cleanEmail = email.trim().toLowerCase();
  const displayName = name ? name.trim() : 'StudyMyte Student';

  const serviceId = config.EMAILJS.SERVICE_ID || 'service_k0369d9';
  const templateId = config.EMAILJS.WELCOME_TEMPLATE_ID || 'template_4coiqgc';

  try {
    const result = await emailjs.send(serviceId, templateId, {
      name: displayName,
      email: cleanEmail
    });

    console.log(`[Security Audit] Welcome email dispatched via EmailJS to ${maskEmail(cleanEmail)}`);
    return result;
  } catch (err) {
    console.error(`[EmailService Error] Failed to send welcome email to ${maskEmail(cleanEmail)}:`, err.message);
    throw err;
  }
}

module.exports = {
  emailjs,
  sendOtpEmail,
  sendWelcomeEmail,
  maskEmail
};

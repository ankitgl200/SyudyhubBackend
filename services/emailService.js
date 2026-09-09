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
  const displayName = name ? name.trim() : 'StudyHub Student';

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
    'Origin': config.EMAILJS.ORIGIN || 'https://studyhub4students.vercel.app'
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

module.exports = {
  sendOtpEmail,
  maskEmail
};

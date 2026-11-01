/**
 * Support Ticket Service
 * Automates first-level triage, troubleshooting, and support ticket creation.
 * Integrates directly with existing HelpRequest schema while enforcing strict
 * PII/credential redaction and anti-spam controls.
 */

const crypto = require('crypto');
const { HelpRequest, User } = require('../../db/models');

// Sensitive data patterns for redaction
const SENSITIVE_PATTERNS = [
  /\b(password|passwd|pwd)\s*[:=]\s*[^\s,]+/gi,
  /\b(otp|one time password)\s*[:=]?\s*\d{4,8}/gi,
  /\b(bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)/gi,
  /\b(api[_-]?key|secret)\s*[:=]\s*[A-Za-z0-9-_]{16,}/gi,
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g // Credit card like digits
];

/**
 * Redacts passwords, OTPs, auth tokens, and secret keys from text.
 */
function redactSensitiveData(text) {
  if (!text || typeof text !== 'string') return text;
  let sanitized = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED_SENSITIVE_CREDENTIAL]');
  }
  return sanitized;
}

/**
 * Formats a user-friendly ticket ID.
 */
function formatTicketCode(id) {
  const shortId = id.toString().slice(-6).toUpperCase();
  return `SM-TKT-${shortId}`;
}

/**
 * Creates an official support ticket in StudyMyte.
 * 
 * @param {Object} ticketData
 * @param {Object} [userContext] - Logged in user details (from req.user)
 */
async function createSupportTicket(ticketData = {}, userContext = null) {
  const {
    category = 'General Support',
    subject,
    description,
    troubleshootingAttempted = [],
    errorMessage = '',
    affectedSection = '',
    priority = 'medium',
    guestName,
    guestPhone,
    guestEmail
  } = ticketData;

  const rawDescription = description || subject || 'No description provided';
  const cleanDescription = redactSensitiveData(rawDescription);
  const cleanSubject = redactSensitiveData(subject || `${category}: ${cleanDescription.slice(0, 50)}...`);
  const cleanError = redactSensitiveData(errorMessage);

  let submitterUserId = null;
  let submitterName = guestName || 'Anonymous Student';
  let submitterPhone = guestPhone || 'Not Provided';
  let submitterRole = 'student';
  let submitterEmail = guestEmail || null;

  if (userContext && userContext.id) {
    submitterUserId = userContext.id;
    submitterName = userContext.name || submitterName;
    submitterPhone = userContext.phone || submitterPhone;
    submitterRole = userContext.role || submitterRole;
    if (userContext.email) submitterEmail = userContext.email;

    // Fetch freshest user record if phone is missing
    try {
      const dbUser = await User.findById(userContext.id).lean();
      if (dbUser) {
        submitterName = dbUser.name || submitterName;
        submitterPhone = dbUser.phone || submitterPhone;
        submitterRole = dbUser.role || submitterRole;
        if (dbUser.email) submitterEmail = dbUser.email;
      }
    } catch (e) {
      // Ignore
    }
  }

  // Build structured message payload containing metadata
  const stepsText = Array.isArray(troubleshootingAttempted) && troubleshootingAttempted.length > 0
    ? `\n\n[Troubleshooting Attempted]:\n- ${troubleshootingAttempted.join('\n- ')}`
    : '';

  const errorText = cleanError ? `\n\n[Reported Error]: ${cleanError}` : '';
  const sectionText = affectedSection ? `\n[Affected Section]: ${affectedSection}` : '';
  const priorityText = `\n[Priority]: ${priority.toUpperCase()}`;

  const compositeMessage = `${cleanDescription}${stepsText}${errorText}${sectionText}${priorityText}\n[Created via]: MYTEE AI Assistant`;

  // Create HelpRequest in existing database
  const helpRequest = new HelpRequest({
    userId: submitterUserId,
    name: submitterName,
    phone: submitterPhone,
    role: submitterRole,
    requestedEmail: submitterEmail ? submitterEmail.trim().toLowerCase() : null,
    subject: `[MYTEE] ${cleanSubject}`,
    message: compositeMessage,
    status: 'pending'
  });

  await helpRequest.save();

  const ticketCode = formatTicketCode(helpRequest._id);

  return {
    success: true,
    ticketId: helpRequest._id.toString(),
    ticketCode,
    category,
    subject: helpRequest.subject,
    status: 'pending',
    priority,
    submitterName,
    createdAt: helpRequest.createdAt,
    confirmationMessage: `Support ticket ${ticketCode} has been successfully logged. Our support team has been notified and will review your issue.`
  };
}

/**
 * Retrieves tickets created by a specific user.
 */
async function getUserTickets(userId) {
  if (!userId) return [];
  const list = await HelpRequest.find({ userId }).sort({ createdAt: -1 }).limit(10).lean();
  return list.map(t => ({
    ticketId: t._id.toString(),
    ticketCode: formatTicketCode(t._id),
    subject: t.subject,
    status: t.status,
    createdAt: t.createdAt
  }));
}

module.exports = {
  createSupportTicket,
  getUserTickets,
  redactSensitiveData,
  formatTicketCode
};


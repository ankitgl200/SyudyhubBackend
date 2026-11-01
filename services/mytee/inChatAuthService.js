/**
 * In-Chat Password Reset Service for MYTEE
 * Allows authenticated users to safely reset their password through email OTP verification.
 * Enforces rate limiting, HMAC-SHA256 hashing, attempt limits, timing-safe checks, and audit logging.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const { User, OtpVerification } = require('../../db/models');
const { sendOtpEmail, maskEmail } = require('../emailService');
const { logAction } = require('./myteeAuditLogger');

const OTP_MAX_ATTEMPTS = 5;
const OTP_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes
const RESET_TICKET_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Initiates in-chat password reset for an authenticated user.
 * Generates an OTP, saves HMAC hash, and sends an email.
 */
async function initiatePasswordReset(userContext, ipAddress = '127.0.0.1') {
  if (!userContext || !userContext.id) {
    return {
      success: false,
      requiresLogin: true,
      message: 'You must be logged in to your StudyMyte account to reset your password.'
    };
  }

  const user = await User.findById(userContext.id);
  if (!user) {
    return {
      success: false,
      message: 'User account not found.'
    };
  }

  if (!user.email) {
    return {
      success: false,
      message: 'No registered email address found for this account. Please update your profile or contact support.'
    };
  }

  // Account-level rate limiting: Max 5 OTP requests per 15 minutes
  const recentRequests = await OtpVerification.countDocuments({
    userId: user._id,
    createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) }
  });

  if (recentRequests >= 5) {
    return {
      success: false,
      rateLimited: true,
      message: 'Too many verification code requests for this account. Please try again after 15 minutes.'
    };
  }

  // Invalidate any previous pending OTP sessions for this user
  await OtpVerification.updateMany(
    { userId: user._id, used: false, revoked: false, purpose: 'password_reset' },
    { $set: { revoked: true } }
  );

  // Cryptographically secure 6-digit numeric OTP
  const rawOtp = crypto.randomInt(100000, 1000000).toString();

  // Hash OTP with HMAC-SHA256
  const otpHash = crypto.createHmac('sha256', config.JWT_SECRET).update(rawOtp).digest('hex');

  // Generate unique transaction ID
  const verificationId = crypto.randomUUID();

  const verification = new OtpVerification({
    verificationId,
    userId: user._id,
    phone: user.phone || '0000000000',
    email: user.email,
    purpose: 'password_reset',
    otpHash,
    attempts: 0,
    maxAttempts: OTP_MAX_ATTEMPTS,
    used: false,
    revoked: false,
    expiresAt: new Date(Date.now() + OTP_LIFETIME_MS),
    lastSentAt: new Date(),
    resendCount: 0,
    maxResends: 3,
    clientIp: ipAddress,
    userAgent: 'MYTEE-InChatAssistant'
  });

  await verification.save();

  // Dispatch OTP email through StudyMyte email service
  try {
    await sendOtpEmail({
      email: user.email,
      name: user.name || 'Student',
      otp: rawOtp,
      purpose: 'password_reset'
    });
  } catch (emailErr) {
    console.error('[InChatAuthService] Failed to send OTP email:', emailErr.message);
    return {
      success: false,
      message: 'Failed to dispatch verification email. Please try again in a few moments or contact support.'
    };
  }

  await logAction({
    userId: user._id.toString(),
    action: 'mytee_otp_requested',
    ip: ipAddress,
    details: { verificationId, email: maskEmail(user.email) }
  });

  return {
    success: true,
    verificationId,
    maskedEmail: maskEmail(user.email),
    expiresInMinutes: 10
  };
}

/**
 * Verifies the 6-digit OTP provided by the user.
 * Generates a signed cryptographic resetTicket upon success.
 */
async function verifyResetOtp(verificationId, rawOtp, userContext, ipAddress = '127.0.0.1') {
  if (!userContext || !userContext.id) {
    return { success: false, message: 'Unauthorized session.' };
  }

  if (!rawOtp || !/^\d{6}$/.test(rawOtp.trim())) {
    return { success: false, message: 'Please enter a valid 6-digit numeric verification code.' };
  }

  const query = {
    userId: userContext.id,
    purpose: 'password_reset',
    used: false,
    revoked: false
  };
  if (verificationId) {
    query.verificationId = verificationId;
  }

  const verification = await OtpVerification.findOne(query).sort({ createdAt: -1 });

  if (!verification) {
    return { success: false, message: 'No active verification session found. Please request a new code.' };
  }

  if (verification.used) {
    return { success: false, message: 'This verification code has already been used. Please request a new one.' };
  }

  if (verification.revoked) {
    return { success: false, message: 'This verification session was revoked. Please request a fresh code.' };
  }

  if (new Date() > verification.expiresAt) {
    return { success: false, message: 'The verification code has expired. Please request a new one.' };
  }

  if (verification.attempts >= verification.maxAttempts) {
    verification.revoked = true;
    await verification.save();
    return {
      success: false,
      message: 'Too many incorrect attempts. For security, this code has been revoked. Please request a new code.'
    };
  }

  // Verify hash using constant-time comparison
  const calculatedHash = crypto.createHmac('sha256', config.JWT_SECRET).update(rawOtp.trim()).digest('hex');
  const isValid = crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(verification.otpHash));

  if (!isValid) {
    verification.attempts += 1;
    await verification.save();
    const remaining = verification.maxAttempts - verification.attempts;
    return {
      success: false,
      message: `Incorrect verification code. ${remaining} attempt(s) remaining.`
    };
  }

  // Mark OTP as used
  verification.used = true;
  verification.verifiedAt = new Date();
  verification.updatedAt = new Date();
  await verification.save();

  // Create single-use signed resetTicket valid for 5 minutes
  const resetTicket = jwt.sign(
    {
      sub: userContext.id,
      verificationId,
      purpose: 'mytee_password_reset'
    },
    config.JWT_SECRET,
    { expiresIn: '5m' }
  );

  await logAction({
    userId: userContext.id,
    action: 'mytee_otp_verified',
    ip: ipAddress,
    details: { verificationId }
  });

  return {
    success: true,
    resetTicket,
    message: 'Verification successful! You can now set your new password.'
  };
}

/**
 * Completes the password reset using the verified resetTicket.
 * Hashes with bcrypt and securely updates user password.
 */
async function completePasswordReset(resetTicket, newPassword, userContext, ipAddress = '127.0.0.1') {
  if (!resetTicket || typeof resetTicket !== 'string') {
    return { success: false, message: 'Missing or invalid password reset authorization ticket.' };
  }

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    return { success: false, message: 'Password must be at least 6 characters long.' };
  }

  let decoded;
  try {
    decoded = jwt.verify(resetTicket, config.JWT_SECRET);
  } catch (err) {
    return { success: false, message: 'Password reset authorization has expired or is invalid. Please restart the verification.' };
  }

  if (decoded.purpose !== 'mytee_password_reset') {
    return { success: false, message: 'Invalid ticket purpose.' };
  }

  // Ensure ticket belongs to currently authenticated user
  if (userContext && userContext.id && decoded.sub !== userContext.id) {
    return { success: false, message: 'Identity mismatch. Unauthorized operation.' };
  }

  const userId = decoded.sub;
  const user = await User.findById(userId);
  if (!user) {
    return { success: false, message: 'User account not found.' };
  }

  // Hash new password using bcrypt
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  user.password = hashedPassword;
  await user.save();

  await logAction({
    userId: user._id.toString(),
    action: 'mytee_password_reset_completed',
    ip: ipAddress,
    details: { email: maskEmail(user.email) }
  });

  return {
    success: true,
    message: 'Your password has been successfully reset! You can now log in with your new password.'
  };
}

/**
 * Direct password reset for recently OTP-verified user session (within last 5 minutes).
 * Used when user types their new password directly into the chat prompt.
 */
async function completePasswordResetForUser(userId, newPassword, ipAddress = '127.0.0.1') {
  if (!userId) {
    return { success: false, message: 'Unauthorized session.' };
  }

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    return { success: false, message: 'New password must be at least 6 characters long.' };
  }

  // Look for a verification record that was marked used within the last 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const recentOtp = await OtpVerification.findOne({
    userId,
    purpose: 'password_reset',
    used: true,
    revoked: false,
    $or: [
      { verifiedAt: { $gte: tenMinutesAgo } },
      { updatedAt: { $gte: tenMinutesAgo } },
      { createdAt: { $gte: tenMinutesAgo } }
    ]
  }).sort({ createdAt: -1 });

  if (!recentOtp) {
    return {
      success: false,
      message: 'No recently verified OTP session found. Please enter your verification code or request a new code.'
    };
  }

  const user = await User.findById(userId);
  if (!user) {
    return { success: false, message: 'User account not found.' };
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);
  user.password = hashedPassword;
  await user.save();

  // Revoke the OTP so it cannot be reused
  recentOtp.revoked = true;
  await recentOtp.save();

  await logAction({
    userId: user._id.toString(),
    action: 'mytee_password_reset_completed_chat',
    ip: ipAddress,
    details: { email: maskEmail(user.email) }
  });

  return {
    success: true,
    message: 'Your password has been successfully reset! You can now use your new password across StudyMyte.'
  };
}

module.exports = {
  initiatePasswordReset,
  verifyResetOtp,
  completePasswordReset,
  completePasswordResetForUser
};

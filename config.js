require('dotenv').config();
const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  TRUST_PROXY: process.env.TRUST_PROXY !== undefined
    ? (process.env.TRUST_PROXY === 'true'
        ? 1
        : (process.env.TRUST_PROXY === 'false'
            ? false
            : (isNaN(Number(process.env.TRUST_PROXY))
                ? process.env.TRUST_PROXY
                : parseInt(process.env.TRUST_PROXY, 10))))
    : (process.env.NODE_ENV === 'production' ? 1 : false),
  JWT_SECRET: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' 
    ? (() => { throw new Error('FATAL: JWT_SECRET environment variable is required in production.'); })() 
    : 'studymyte-dev-secret-key-local-only'),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studymyte',
  CLOUDINARY: {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
    api_key: process.env.CLOUDINARY_API_KEY || '',
    api_secret: process.env.CLOUDINARY_API_SECRET || ''
  },
  UPLOADS_DIR: path.join(__dirname, 'uploads'),
  EMAILJS: {
    SERVICE_ID: process.env.EMAILJS_SERVICE_ID || '',
    TEMPLATE_ID: process.env.EMAILJS_TEMPLATE_ID || '',
    WELCOME_TEMPLATE_ID: process.env.EMAILJS_WELCOME_TEMPLATE_ID || '',
    PUBLIC_KEY: process.env.EMAILJS_PUBLIC_KEY || '',
    PRIVATE_KEY: process.env.EMAILJS_PRIVATE_KEY || '',
    ORIGIN: process.env.EMAILJS_ORIGIN || 'https://studymyte4students.vercel.app'
  },
  SECURITY: {
    OTP_LIFETIME_MS: parseInt(process.env.OTP_LIFETIME_MS, 10) || 5 * 60 * 1000, // 5 minutes
    OTP_MAX_ATTEMPTS: parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5,
    RESEND_COOLDOWN_SEC: parseInt(process.env.RESEND_COOLDOWN_SEC, 10) || 60,
    MAX_RESENDS: parseInt(process.env.MAX_RESENDS, 10) || 3,
    TRUST_PROXY: process.env.TRUST_PROXY !== undefined
      ? (process.env.TRUST_PROXY === 'true'
          ? 1
          : (process.env.TRUST_PROXY === 'false'
              ? false
              : (isNaN(Number(process.env.TRUST_PROXY))
                  ? process.env.TRUST_PROXY
                  : parseInt(process.env.TRUST_PROXY, 10))))
      : (process.env.NODE_ENV === 'production' ? 1 : false),
    ALLOWED_ORIGINS: [
      'https://studymyte4students.vercel.app',
      'https://studymyte.tech',
      'https://www.studymyte.tech',
      'http://studymyte.tech',
      'http://www.studymyte.tech',
      'http://localhost:5000',
      'http://localhost:3000',
      'http://127.0.0.1:5000',
      'http://127.0.0.1:3000'
    ]
  },
  GEMINI: {
    API_KEY: process.env.GEMINI_API_KEY || '',
    MODEL: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    TIMEOUT_MS: parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 30000,
    MAX_OUTPUT_TOKENS: parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS, 10) || 1024,
    TEMPERATURE: parseFloat(process.env.GEMINI_TEMPERATURE) || 0.3
  },
  MYTEE: {
    STUDENT_RATE_LIMIT_MIN: parseInt(process.env.MYTEE_STUDENT_RATE_LIMIT_MIN, 10) || 60,
    STUDENT_RATE_LIMIT_DAY: parseInt(process.env.MYTEE_STUDENT_RATE_LIMIT_DAY, 10) || 500,
    GUEST_RATE_LIMIT_MIN: parseInt(process.env.MYTEE_GUEST_RATE_LIMIT_MIN, 10) || 40,
    GUEST_RATE_LIMIT_DAY: parseInt(process.env.MYTEE_GUEST_RATE_LIMIT_DAY, 10) || 250,
    TICKET_RATE_LIMIT_HOUR: parseInt(process.env.MYTEE_TICKET_RATE_LIMIT_HOUR, 10) || 10,
    ADMIN_RATE_LIMIT_MIN: parseInt(process.env.MYTEE_ADMIN_RATE_LIMIT_MIN, 10) || 120,
    MAX_MESSAGE_LENGTH: parseInt(process.env.MYTEE_MAX_MESSAGE_LENGTH, 10) || 1200,
    MAX_HISTORY_TURNS: parseInt(process.env.MYTEE_MAX_HISTORY_TURNS, 10) || 10
  }
};

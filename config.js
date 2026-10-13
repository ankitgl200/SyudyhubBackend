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
  JWT_SECRET: process.env.JWT_SECRET || 'studymytesecretkey987654321',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studymyte',
  CLOUDINARY: {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
    api_key: process.env.CLOUDINARY_API_KEY || '',
    api_secret: process.env.CLOUDINARY_API_SECRET || ''
  },
  UPLOADS_DIR: path.join(__dirname, 'uploads'),
  EMAILJS: {
    SERVICE_ID: process.env.EMAILJS_SERVICE_ID || 'service_k0369d9',
    TEMPLATE_ID: process.env.EMAILJS_TEMPLATE_ID || 'template_axrwr8q',
    WELCOME_TEMPLATE_ID: process.env.EMAILJS_WELCOME_TEMPLATE_ID || 'template_4coiqgc',
    PUBLIC_KEY: process.env.EMAILJS_PUBLIC_KEY || 'EADCytMay61qrmUUk',
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
  }
};

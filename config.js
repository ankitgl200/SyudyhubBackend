require('dotenv').config();
const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'studyhubsecretkey987654321',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studyhub',
  CLOUDINARY: {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
    api_key: process.env.CLOUDINARY_API_KEY || '',
    api_secret: process.env.CLOUDINARY_API_SECRET || ''
  },
  UPLOADS_DIR: path.join(__dirname, 'uploads'),
  EMAILJS: {
    SERVICE_ID: process.env.EMAILJS_SERVICE_ID || 'service_k0369d9',
    TEMPLATE_ID: process.env.EMAILJS_TEMPLATE_ID || 'template_axrwr8q',
    PUBLIC_KEY: process.env.EMAILJS_PUBLIC_KEY || 'EADCytMay61qrmUUk',
    PRIVATE_KEY: process.env.EMAILJS_PRIVATE_KEY || '',
    ORIGIN: process.env.EMAILJS_ORIGIN || 'https://studyhub4students.vercel.app'
  },
  SECURITY: {
    OTP_LIFETIME_MS: parseInt(process.env.OTP_LIFETIME_MS, 10) || 5 * 60 * 1000, // 5 minutes
    OTP_MAX_ATTEMPTS: parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5,
    RESEND_COOLDOWN_SEC: parseInt(process.env.RESEND_COOLDOWN_SEC, 10) || 60,
    MAX_RESENDS: parseInt(process.env.MAX_RESENDS, 10) || 3,
    ALLOWED_ORIGINS: [
      'https://studyhub4students.vercel.app',
      'http://localhost:5000',
      'http://localhost:3000',
      'http://127.0.0.1:5000',
      'http://127.0.0.1:3000'
    ]
  }
};

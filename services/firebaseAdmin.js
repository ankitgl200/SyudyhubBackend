const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const path = require("path");
const fs = require("fs");

let serviceAccount;

// 1. Try to load from Render Environment Variable
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT env var:", err);
  }
} 
// 2. Fallback to local file for development
else {
  const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (fs.existsSync(keyPath)) {
    serviceAccount = require(keyPath);
  }
}

let app;
if (serviceAccount) {
  app = initializeApp({
    credential: cert(serviceAccount)
  });
} else {
  console.warn("⚠️ Firebase Service Account missing! Push notifications are disabled.");
}

module.exports = {
  messaging: () => {
    if (!app) {
      return {
        sendEachForMulticast: async () => {
          console.log("Push notification skipped: Firebase not configured.");
          return { successCount: 0, failureCount: 0 };
        }
      };
    }
    return getMessaging(app);
  }
};

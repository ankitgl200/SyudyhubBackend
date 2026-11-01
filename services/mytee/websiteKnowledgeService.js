/**
 * Website Knowledge Service
 * Centralized source of verified StudyMyte platform knowledge,
 * administrative contact/creator information, routes, and troubleshooting playbooks.
 */

const { SystemSetting, TeamMember } = require('../../db/models');

const SETTING_KEY_INFO = 'official_website_info';

// Default Verified Platform Information
const DEFAULT_WEBSITE_INFO = {
  websiteName: 'StudyMyte',
  tagline: "StudyMyte's Official Academic Platform",
  websiteUrl: 'https://studymyte.tech/',
  description: 'StudyMyte is a comprehensive academic repository and learning platform designed for engineering and college students. It provides verified lecture notes, previous-year question papers (PYQs), lab manuals, reference textbooks, and interactive academic resources.',
  purpose: 'Empower students with free, high-quality, and peer-reviewed educational resources to excel in their university examinations and coursework.',
  creators: [
    {
      name: 'Ankit Kumar',
      role: 'Lead Architect & Founder',
      contribution: 'Platform architecture, backend infrastructure, and core ecosystem engineering.'
    },
    {
      name: 'StudyMyte Developer & Editorial Team',
      role: 'Core Team',
      contribution: 'Content moderation, quality verification, and academic resource curation.'
    }
  ],
  contactEmail: 'support@studymyte.tech',
  supportEmail: 'studyhub.btkit@gmail.com',
  officialEmails: [
    'support@studymyte.tech',
    'studyhub.btkit@gmail.com'
  ],
  supportUrl: 'https://studymyte.tech/#/support',
  socialLinks: {
    instagram: 'https://www.instagram.com/studymyte_official/',
    telegram: 'https://t.me/+Y8-xHuu_XBo0ZDBl',
    github: 'https://github.com/ankitgl200/studyhubStudents'
  },
  availablePlatforms: ['instagram', 'telegram', 'github'],
  unavailableNotice: 'StudyMyte is officially available ONLY on Instagram, Telegram, and GitHub. We are NOT available on LinkedIn, Twitter/X, Discord, Facebook, or any other platform.',
  policies: {
    terms: 'All uploaded resources must adhere to copyright and academic integrity guidelines. Spam or copyrighted infringement is strictly prohibited.',
    privacy: 'User credentials and activity are safeguarded. Email addresses and mobile numbers are never sold or shared with third parties.',
    uploads: 'All contributed documents undergo admin or educator review before being approved and marked canonical.'
  }
};

// Verified Platform Routes
const VERIFIED_ROUTES = [
  { path: '/', label: 'Home Page', description: 'StudyMyte main overview and quick search' },
  { path: '/notes', label: 'Notes', description: 'Browse and download semester lecture notes by subject' },
  { path: '/papers', label: 'PYQs (Previous Year Questions)', description: 'Previous-year examination papers filtered by year and semester' },
  { path: '/resources', label: 'Books & Lab Manuals', description: 'Practical lab manuals, syllabus sheets, and reference textbooks' },
  { path: '/support', label: 'Help & Support', description: 'Submit issue requests, report bugs, and view support tickets' },
  { path: '/about', label: 'About StudyMyte', description: 'Learn about StudyMyte mission, creators, and team members' },
  { path: '/reviews', label: 'Reviews', description: 'Read student feedback and write your own platform review' },
  { path: '/contributors', label: 'Top Contributors', description: 'Student and educator contributors ranking board' },
  { path: '/profile', label: 'My Profile', description: 'View user profile, update contact information and security settings' },
  { path: '/appearance', label: 'Appearance', description: 'Toggle Dark Ops HUD, Scandinavian Minimal, or classic themes' },
  { path: '/login', label: 'Login', description: 'Student & Educator authentication' },
  { path: '/signup', label: 'Registration', description: 'Create a student or educator account' },
  { path: '/my-uploads', label: 'My Uploads', description: 'Educator and staff document management' },
  { path: '/my-contributions', label: 'My Contributions', description: 'Student submitted materials and approval statuses' },
  { path: '/teacher-dashboard', label: 'Teacher Dashboard', description: 'Educator stats and ranking' },
  { path: '/admin', label: 'Admin Dashboard', description: 'Platform administration and document moderation' }
];

// Verified Troubleshooting Solutions
const TROUBLESHOOTING_GUIDE = {
  pdf_view: {
    title: 'PDF Viewing Issues in Inbuilt Viewer',
    steps: [
      '1. Verify your internet connection and reload the document viewer.',
      '2. Ensure your browser allows inline scripts and canvas rendering required by the inbuilt PDF viewer.',
      '3. If using an ad blocker or strict tracker blocker, whitelist studymyte.tech as it might block the PDF stream.',
      '4. If on mobile, zoom using the controls within the viewer toolbar.',
      '5. If the document displays a loading error, notify our team or submit a ticket and we will verify the document source.'
    ]
  },
  login_issue: {
    title: 'Login & Account Access',
    steps: [
      '1. Verify that your registered 10-digit mobile number and password are typed correctly.',
      '2. New educator or student accounts may require administrative approval before first sign-in.',
      '3. If you forgot your password, navigate to the Forgot Password page to receive an OTP on your registered email/phone.',
      '4. Clear browser cookies and cache if session tokens fail to persist.'
    ]
  },
  upload_issue: {
    title: 'Resource Contribution & Uploads',
    steps: [
      '1. Ensure your file is in PDF format (.pdf) and smaller than 20 MB.',
      '2. Provide a clear title, subject name, branch, and academic year.',
      '3. Student uploads go into a "Pending Review" queue where administrators verify the document before making it public.',
      '4. Check the "My Contributions" section to monitor review status.'
    ]
  },
  profile_issue: {
    title: 'Profile & Contact Details Update',
    steps: [
      '1. Go to your Profile page from the top navigation or side menu.',
      '2. You can update your display name or linked email address.',
      '3. Password changes require authentication via the Reset Password menu.'
    ]
  }
};

/**
 * Retrieves the current official website info (from DB or default).
 */
async function getOfficialWebsiteInfo() {
  try {
    const setting = await SystemSetting.findOne({ key: SETTING_KEY_INFO });
    if (setting && setting.value) {
      return { ...DEFAULT_WEBSITE_INFO, ...setting.value };
    }
  } catch (err) {
    console.warn('[WebsiteKnowledge] Error reading official info setting:', err.message);
  }

  // Also query TeamMember table if available to enrich creators
  try {
    const teamMembers = await TeamMember.find().sort({ order: 1 });
    if (teamMembers && teamMembers.length > 0) {
      const enriched = { ...DEFAULT_WEBSITE_INFO };
      enriched.creators = teamMembers.map(m => ({
        name: m.name,
        role: m.role,
        bio: m.bio || ''
      }));
      return enriched;
    }
  } catch (err) {
    // Ignore and use default
  }

  return DEFAULT_WEBSITE_INFO;
}

/**
 * Updates official website info (Admin only).
 */
async function updateOfficialWebsiteInfo(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid website info payload');
  }

  let setting = await SystemSetting.findOne({ key: SETTING_KEY_INFO });
  if (setting) {
    setting.value = { ...setting.value, ...data };
    await setting.save();
  } else {
    setting = new SystemSetting({
      key: SETTING_KEY_INFO,
      value: { ...DEFAULT_WEBSITE_INFO, ...data }
    });
    await setting.save();
  }

  return setting.value;
}

/**
 * Resolves a verified navigation route by keyword.
 */
function findNavigationRoute(query) {
  if (!query) return null;
  const q = query.toLowerCase().trim();

  // Specific keyword shortcuts take precedence
  if (q.includes('pyq') || q.includes('paper') || q.includes('question')) {
    return VERIFIED_ROUTES.find(r => r.path === '/papers');
  }
  if (q.includes('note') || q.includes('lecture')) {
    return VERIFIED_ROUTES.find(r => r.path === '/notes');
  }
  if (q.includes('manual') || q.includes('book') || q.includes('lab')) {
    return VERIFIED_ROUTES.find(r => r.path === '/resources');
  }
  if (q.includes('support') || q.includes('ticket') || q.includes('help') || q.includes('issue')) {
    return VERIFIED_ROUTES.find(r => r.path === '/support');
  }
  if (q.includes('about') || q.includes('creator') || q.includes('developer') || q.includes('team')) {
    return VERIFIED_ROUTES.find(r => r.path === '/about');
  }

  for (const route of VERIFIED_ROUTES) {
    const slug = route.path.replace(/^\//, '');
    if (slug && q.includes(slug)) {
      return route;
    }
    if (q.includes(route.label.toLowerCase())) {
      return route;
    }
  }

  return null;
}

/**
 * Gets verified troubleshooting steps.
 * Directly supports category keys or natural language when expressing an issue.
 */
function getTroubleshootingGuide(issueType) {
  if (!issueType) return null;
  const key = issueType.toLowerCase().trim();

  // Direct category matches
  if (key === 'pdf' || key === 'pdf_view') return TROUBLESHOOTING_GUIDE.pdf_view;
  if (key === 'login' || key === 'login_issue') return TROUBLESHOOTING_GUIDE.login_issue;
  if (key === 'upload' || key === 'upload_issue') return TROUBLESHOOTING_GUIDE.upload_issue;
  if (key === 'profile' || key === 'profile_issue') return TROUBLESHOOTING_GUIDE.profile_issue;

  // In natural language, require that user is actually describing a difficulty/problem
  const isTrouble = /\b(issue|problem|error|bug|broken|not\s+working|can'?t|cannot|unable|fail|failed|failing|stuck|trouble|glitch)\b/i.test(key);
  if (!isTrouble) return null;

  if (/\b(pdf|view|viewer|download|open\s+pdf|load\s+pdf)\b/i.test(key)) {
    return TROUBLESHOOTING_GUIDE.pdf_view;
  }
  if (/\b(login|sign\s*in|password|account|otp|auth)\b/i.test(key)) {
    return TROUBLESHOOTING_GUIDE.login_issue;
  }
  if (/\b(upload|contribute|submit\s+file)\b/i.test(key)) {
    return TROUBLESHOOTING_GUIDE.upload_issue;
  }
  if (/\b(profile|email|phone|details)\b/i.test(key)) {
    return TROUBLESHOOTING_GUIDE.profile_issue;
  }

  return null;
}

module.exports = {
  DEFAULT_WEBSITE_INFO,
  VERIFIED_ROUTES,
  TROUBLESHOOTING_GUIDE,
  getOfficialWebsiteInfo,
  updateOfficialWebsiteInfo,
  findNavigationRoute,
  getTroubleshootingGuide
};

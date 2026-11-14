/**
 * Website Knowledge Service
 * Centralized source of verified StudyMyte platform knowledge,
 * administrative team details, full technical architecture, route hierarchy,
 * platform features, admin panel documentation, and troubleshooting playbooks.
 */

const mongoose = require('mongoose');
const { SystemSetting, TeamMember } = require('../../db/models');

const SETTING_KEY_INFO = 'official_website_info';

// Verified Founders & Core Leadership Team
const OFFICIAL_TEAM = [
  {
    name: 'Ankit Ghugtyal',
    role: 'Founder & Lead Full-Stack Architect',
    contribution: 'Conceived StudyMyte, built end-to-end full-stack architecture, database models, secure PDF viewer engine, and core AI ecosystem.'
  },
  {
    name: 'Soham Joshi',
    role: 'Co-Founder & Operations Lead',
    contribution: 'Strategic planning, university outreach, and operational scalability.'
  },
  {
    name: 'Abhay Chandra Joshi',
    role: 'Content Curator & Academic Lead',
    contribution: 'Curating, cataloging, and quality-verifying semester lecture notes and past university papers.'
  },
  {
    name: 'Adarsh Singh Chaudhary',
    role: 'Community Manager & Student Relations',
    contribution: 'Community building, student support, and feedback collection.'
  },
  {
    name: 'Aditya Maurya',
    role: 'Simulation Developer & Technical Lead',
    contribution: 'Simulink simulation development, interactive engineering modules, and technical optimizations.'
  }
];

// Default Verified Platform Information
const DEFAULT_WEBSITE_INFO = {
  websiteName: 'StudyMyte',
  tagline: "Central Academic Repository & Intelligent Study Companion for BTKIT Dwarahat",
  websiteUrl: 'https://studymyte.tech/',
  productionDomain: 'studymyte.tech',
  originInstitution: 'Bipin Tripathi Kumaon Institute of Technology (BTKIT / KEC Dwarahat), Almora, Uttarakhand',
  affiliation: 'Uttarakhand Technical University (UTU / Veer Madho Singh Bhandari Uttarakhand Technical University)',
  description: 'StudyMyte is a modern, student-centric academic repository and digital library designed to empower engineering students. It provides free, verified, and semester-wise categorized lecture notes, previous-year question papers (PYQs), lab manuals, reference textbooks, practical file front-page generators, and the MYTEE intelligent AI assistant.',
  purpose: 'Solve scattered study resources, lack of past exam question archives, and difficulty in exam preparation by offering a unified, clean, and lightning-fast digital library for college engineers.',
  creators: OFFICIAL_TEAM,
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
    github: 'https://github.com/ankitgl200/studyhub4students'
  },
  availablePlatforms: ['instagram', 'telegram', 'github'],
  unavailableNotice: 'StudyMyte is officially available ONLY on Instagram, Telegram, and GitHub. We are NOT available on LinkedIn, Twitter/X, Discord, Facebook, or any other unauthorized platform.',
  policies: {
    terms: 'All uploaded resources must adhere to academic integrity. Copyright infringement, offensive materials, and commercial re-selling are strictly prohibited.',
    privacy: 'User credentials and activity logs are strictly safeguarded with JWT and bcrypt hashing. Mobile numbers and emails are never sold or shared with any third party.',
    uploads: 'All student contributions undergo mandatory admin review before being published publicly to maintain academic quality and prevent spam.',
    ads: 'StudyMyte utilizes clean, non-intrusive sponsor and AdSense units strictly separated from authentication modals to keep studying distraction-free.'
  }
};

// Complete Technical Architecture & Codebase Specs
const PLATFORM_ARCHITECTURE = {
  frontend: {
    framework: 'Vanilla JavaScript (ES6+ modular SPA) with zero heavy framework bloat for instantaneous loading',
    styling: 'Modern CSS3 with CSS Custom Properties (Theme tokens), responsive CSS Grid, and Flexbox',
    animationEngine: 'Anime.js for smooth micro-interactions, page transitions, and interactive modal animations',
    icons: 'Lucide Icons SVG library dynamically refreshed via refreshIcons()',
    pwa: 'Progressive Web App (PWA) with Service Worker (sw.js) providing offline capability and installability',
    routing: 'Client-side hash router supporting clean bookmarkable URLs (#/notes, #/papers, #/resources, etc.)',
    tokenStreaming: 'Real-time Server-Sent Events (SSE) token streaming for MYTEE AI with sub-second latency'
  },
  backend: {
    runtime: 'Node.js LTS with Express.js RESTful API architecture',
    database: 'MongoDB Atlas with Mongoose ODM schemas (User, Document, Announcement, SupportTicket, Review, Settings, UsageLog)',
    security: 'JWT authentication, bcrypt password hashing, CORS whitelist, helmet security headers, and WAF rate-limiting',
    storage: 'Cloudinary CDN for resilient document storage, PDF asset delivery, and optimized file streaming',
    notifications: 'EmailJS integration for real-time OTP dispatch, password recovery, and admin alerts',
    hosting: 'Frontend deployed on Vercel Edge Network (studymyte.tech); Backend hosted on Render cloud services'
  }
};

// Platform Features & User Guide
const PLATFORM_FEATURES = {
  inbuiltPdfViewer: {
    name: 'Inbuilt Protected Document Viewer',
    description: 'Enables students to read lecture notes, question papers, and lab manuals directly in the browser with canvas rendering, multi-level zoom, full-screen mode, and page jumping—without needing to download large PDFs to device storage.',
    security: 'Applies dynamic anti-theft StudyMyte watermarking and disables raw PDF direct download leakage.'
  },
  labFrontPageGenerator: {
    name: 'Practical File Front Page & Index Generator',
    description: 'A built-in utility located in #/resources that allows students to generate custom, print-ready A4 PDF Lab Manual Front Pages with College Logo, Student Name, Roll No, Branch, Semester, Experiment Table, and Teacher Signatures in seconds.'
  },
  watermarkEngine: {
    name: 'Non-Intrusive StudyMyte Watermark Engine',
    description: 'Automatically applies a clean, semi-transparent diagonal watermark ("StudyMyte") across document views to prevent commercial re-selling while ensuring 100% reading legibility.'
  },
  adMonetizationSystem: {
    name: '4-Slot Stacked Advertisement Engine',
    description: 'Configurable from the Admin Panel. Features a Master Switch, 4 independent ad slots with individual ON/OFF toggles, supporting both custom sponsor image banners and Google AdSense responsive units. Excluded completely from Login/Signup modals.'
  },
  appearanceThemes: {
    name: 'Theme & Typography Customizer',
    description: 'Students can customize their visual experience with Light Mode, Dark Ops HUD Mode, and Scandinavian Clean, along with 6 curated font families (Inter, Lexend, Outfit, Poppins, Space Grotesk, Roboto).'
  },
  smartExamAnalyzer: {
    name: 'Smart PYQ Exam Analyzer',
    description: 'Analyzes historical university question papers to identify questions that recur with 60%–70%+ frequency, calculating unit weightages and generating step-by-step model answers.'
  }
};

// Admin Panel 10-Tab Structure & Capabilities
const ADMIN_PANEL_SYSTEM = {
  overview: 'The Super Admin Panel (#/admin) is a desktop-optimized, tab-based control center equipped with real-time review alert dots for pending tasks.',
  tabs: [
    {
      id: 'pending-approvals',
      name: 'Approvals',
      hasAlertDot: true,
      description: 'Review student-contributed study notes and question papers. Admins can view the PDF, verify title/branch/year, and click Approve or Reject.'
    },
    {
      id: 'user-directory',
      name: 'User Directory',
      hasAlertDot: false,
      description: 'Search all registered users by name or phone, view roles, promote to Admin, delete accounts, and export full user lists to CSV.'
    },
    {
      id: 'contributions',
      name: 'Contributions',
      hasAlertDot: true,
      description: 'Track the status of all student and faculty document contributions across departments.'
    },
    {
      id: 'help-support',
      name: 'Help & Support',
      hasAlertDot: true,
      description: 'Manage open student tickets and bug reports, assign status, and reply directly to students.'
    },
    {
      id: 'send-notice',
      name: 'Send Notice',
      hasAlertDot: false,
      description: 'Broadcast high-priority platform-wide announcements to all students with real-time push alerts.'
    },
    {
      id: 'sent-history',
      name: 'Sent History',
      hasAlertDot: false,
      description: 'Review historical record of all sent announcements and broadcasts.'
    },
    {
      id: 'security-logs',
      name: 'Security Logs',
      hasAlertDot: false,
      description: 'View real-time WAF telemetry, blocked malicious IPs, brute-force attempts, and scanner probes.'
    },
    {
      id: 'user-reviews',
      name: 'User Reviews',
      hasAlertDot: false,
      description: 'Moderate, feature, or remove student reviews submitted on the public platform.'
    },
    {
      id: 'ads-monetization',
      name: 'Ads & Monetization',
      hasAlertDot: false,
      description: 'Control the Master Advertisement Switch, manage all 4 ad slots individually, configure sponsor banners or paste Google AdSense code.'
    },
    {
      id: 'storage-capacity',
      name: 'Storage Capacity',
      hasAlertDot: false,
      description: 'Live infrastructure gauges tracking Cloudinary storage usage, MongoDB document count, and EmailJS email quotas.'
    }
  ]
};

// Verified Platform Routes
const VERIFIED_ROUTES = [
  { path: '/', label: 'Home Page', description: 'StudyMyte main overview, quick search, recent uploads, and announcement feed' },
  { path: '/notes', label: 'Notes Library', description: 'Folder tree of lecture notes categorized by Year -> Branch -> Subject' },
  { path: '/papers', label: 'PYQs (Past Question Papers)', description: 'Previous-year university examination papers sorted by year and semester' },
  { path: '/resources', label: 'Books, Manuals & Tools', description: 'Lab manuals, syllabus PDFs, reference textbooks, and Practical Front Page Generator' },
  { path: '/support', label: 'Help & Support', description: 'Submit issue requests, report broken links, and view active support tickets' },
  { path: '/about', label: 'About StudyMyte', description: 'Mission, history, founders (Ankit Ghugtyal, Soham Joshi, etc.), and contact information' },
  { path: '/reviews', label: 'Reviews', description: 'Read student feedback, testimonials, and submit your personal review' },
  { path: '/contributors', label: 'Top Contributors', description: 'Leaderboard of top student and faculty document contributors' },
  { path: '/profile', label: 'My Profile', description: 'View personal details, branch, semester, change password, and notification preferences' },
  { path: '/appearance', label: 'Appearance & Themes', description: 'Customize theme (Light, Dark Ops, Scandinavian) and reading typography' },
  { path: '/login', label: 'Login', description: 'Student & Educator authentication via 10-digit mobile number and password' },
  { path: '/signup', label: 'Sign Up', description: 'Create a new student or educator account with mandatory Terms agreement' },
  { path: '/my-uploads', label: 'My Uploads', description: 'Educator and faculty upload management panel' },
  { path: '/my-contributions', label: 'My Contributions', description: 'Student document contributions, review status, and approval tracking' },
  { path: '/admin', label: 'Super Admin Panel', description: 'Master administration, user moderation, approvals, ads, and telemetry' }
];

// Verified Troubleshooting Solutions
const TROUBLESHOOTING_GUIDE = {
  pdf_view: {
    title: 'PDF Viewing Issues in Inbuilt Viewer',
    steps: [
      '1. Verify your internet connection and reload the document viewer.',
      '2. Ensure your browser allows canvas rendering required by the secure PDF engine.',
      '3. If using an aggressive ad/tracker blocker, whitelist studymyte.tech as it may intercept PDF data chunks.',
      '4. If on mobile, use the viewer toolbar buttons to zoom in/out or toggle full-screen mode.',
      '5. If the document displays a loading error, click "Report Issue" or tell MYTEE and we will verify the source.'
    ]
  },
  login_issue: {
    title: 'Login & Account Access',
    steps: [
      '1. Ensure you are typing your registered 10-digit mobile number (without +91 or leading zeros).',
      '2. Verify password accuracy (case-sensitive).',
      '3. New accounts may require initial administrative verification before sign-in.',
      '4. If you forgot your password, click "Forgot Password" or ask MYTEE to trigger an OTP reset.'
    ]
  },
  upload_issue: {
    title: 'Resource Contribution & Uploads',
    steps: [
      '1. Ensure your file is in PDF format (.pdf) and under 20 MB.',
      '2. Fill in the correct title, academic year, branch, and target subject folder.',
      '3. Two upload methods exist: (A) The blue floating "+" button at the bottom-left, or (B) The "+ Contribute" button inside any target folder.',
      '4. Uploaded files enter the "Pending Review" queue where admins verify them within 12-24 hours.'
    ]
  },
  profile_issue: {
    title: 'Profile & Password Update',
    steps: [
      '1. Navigate to #/profile from the top navigation or user menu.',
      '2. Update your display name, linked email, or notification preferences.',
      '3. Use the Reset Password section for password changes.'
    ]
  },
  approval_status: {
    title: 'Pending Contribution Verification',
    steps: [
      '1. Visit #/my-contributions to see the real-time status of all your submitted documents.',
      '2. "Pending Review": Document is awaiting admin verification.',
      '3. "Approved": Document is live across the platform library.',
      '4. "Rejected": Document did not meet quality standards (e.g. blurry scan, copyrighted content, wrong category).'
    ]
  }
};

/**
 * Retrieves the current official website info (from DB or default).
 */
async function getOfficialWebsiteInfo() {
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const setting = await SystemSetting.findOne({ key: SETTING_KEY_INFO }).maxTimeMS(2000);
      if (setting && setting.value) {
        return { ...DEFAULT_WEBSITE_INFO, ...setting.value };
      }
    } catch (err) {
      console.warn('[WebsiteKnowledge] Error reading official info setting:', err.message);
    }

    try {
      const teamMembers = await TeamMember.find().sort({ order: 1 }).maxTimeMS(2000);
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
      // Fall back to default
    }
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

  if (q.includes('pyq') || q.includes('paper') || q.includes('question') || q.includes('previous year')) {
    return VERIFIED_ROUTES.find(r => r.path === '/papers');
  }
  if (q.includes('note') || q.includes('lecture') || q.includes('handout')) {
    return VERIFIED_ROUTES.find(r => r.path === '/notes');
  }
  if (q.includes('manual') || q.includes('book') || q.includes('lab') || q.includes('front page') || q.includes('index generator')) {
    return VERIFIED_ROUTES.find(r => r.path === '/resources');
  }
  if (q.includes('support') || q.includes('ticket') || q.includes('help') || q.includes('issue') || q.includes('contact')) {
    return VERIFIED_ROUTES.find(r => r.path === '/support');
  }
  if (q.includes('about') || q.includes('creator') || q.includes('developer') || q.includes('founder') || q.includes('team')) {
    return VERIFIED_ROUTES.find(r => r.path === '/about');
  }
  if (q.includes('admin') || q.includes('approval') || q.includes('telemetry') || q.includes('moderation')) {
    return VERIFIED_ROUTES.find(r => r.path === '/admin');
  }
  if (q.includes('theme') || q.includes('dark mode') || q.includes('light mode') || q.includes('appearance') || q.includes('font')) {
    return VERIFIED_ROUTES.find(r => r.path === '/appearance');
  }
  if (q.includes('contribution') || q.includes('my upload') || q.includes('status')) {
    return VERIFIED_ROUTES.find(r => r.path === '/my-contributions');
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
 * Gets verified troubleshooting steps for issues.
 */
function getTroubleshootingGuide(issueType) {
  if (!issueType) return null;
  const key = issueType.toLowerCase().trim();

  if (key === 'pdf' || key === 'pdf_view') return TROUBLESHOOTING_GUIDE.pdf_view;
  if (key === 'login' || key === 'login_issue') return TROUBLESHOOTING_GUIDE.login_issue;
  if (key === 'upload' || key === 'upload_issue') return TROUBLESHOOTING_GUIDE.upload_issue;
  if (key === 'profile' || key === 'profile_issue') return TROUBLESHOOTING_GUIDE.profile_issue;
  if (key === 'approval' || key === 'approval_status') return TROUBLESHOOTING_GUIDE.approval_status;

  const isTrouble = /\b(issue|problem|error|bug|broken|not\s+working|can'?t|cannot|unable|fail|failed|stuck|glitch|pending)\b/i.test(key);
  if (!isTrouble) return null;

  if (/\b(pdf|view|viewer|download|open\s+pdf|load\s+pdf)\b/i.test(key)) {
    return TROUBLESHOOTING_GUIDE.pdf_view;
  }
  if (/\b(login|sign\s*in|password|account|otp|auth)\b/i.test(key)) {
    return TROUBLESHOOTING_GUIDE.login_issue;
  }
  if (/\b(upload|contribute|submit\s+file|upload\s+fail)\b/i.test(key)) {
    return TROUBLESHOOTING_GUIDE.upload_issue;
  }
  if (/\b(profile|email|phone|details)\b/i.test(key)) {
    return TROUBLESHOOTING_GUIDE.profile_issue;
  }
  if (/\b(pending|approve|approval|review\s*status)\b/i.test(key)) {
    return TROUBLESHOOTING_GUIDE.approval_status;
  }

  return null;
}

/**
 * Builds a comprehensive system knowledge summary block for the AI.
 */
function getSystemKnowledgePrompt() {
  const teamList = OFFICIAL_TEAM.map(m => `• ${m.name} (${m.role}): ${m.contribution}`).join('\n');
  const routesList = VERIFIED_ROUTES.map(r => `• ${r.path} -> ${r.label}: ${r.description}`).join('\n');
  const adminTabsList = ADMIN_PANEL_SYSTEM.tabs.map(t => `• Tab "${t.name}" (${t.id}): ${t.description} ${t.hasAlertDot ? '[Has Red Review Alert Dot]' : ''}`).join('\n');

  return `
=== VERIFIED STUDYMYTE PLATFORM ENCYCLOPEDIA ===
1. PLATFORM OVERVIEW:
   • Name: StudyMyte (studymyte.tech)
   • Origin: Conceived, engineered, and tailored for BTKIT Dwarahat (KEC Dwarahat), Uttarakhand (affil. Uttarakhand Technical University).
   • Mission: Centralized, verified academic digital repository with zero fees, high-speed access, and AI guidance.

2. FOUNDERS & LEADERSHIP TEAM:
${teamList}

3. TECHNICAL ARCHITECTURE & STACK:
   • Frontend: Vanilla JavaScript (ES6+), Modular SPA architecture, Hash Routing, Anime.js, Lucide Icons, PWA (Progressive Web App with sw.js).
   • Backend: Node.js, Express.js REST API, MongoDB Atlas (Mongoose), JWT, bcrypt, Cloudinary CDN document streaming, EmailJS.
   • Deployments: Frontend on Vercel Edge (studymyte.tech), Backend on Render.

4. KEY PLATFORM FEATURES:
   • Inbuilt Document Viewer: Canvas-rendered protected PDF viewer with smooth multi-level zoom, full-screen, and zero local download requirements.
   • Watermarking Engine: Non-intrusive diagonal "StudyMyte" watermark safeguarding student and faculty notes against unauthorized re-selling.
   • Practical Lab Front Page Generator: Generates ready-to-print A4 PDF cover sheets with college logo, student credentials, and experiment index in #/resources.
   • 4-Slot Vertical Ad System: Clean stacked vertical ad cards across public sections with master and individual slot controls; excluded completely from Login/Signup modals.
   • Appearance Engine: Light Mode, Dark Ops HUD, Scandinavian Clean, and 6 custom typography selections.

5. ADMIN PANEL SYSTEM (10 TABS WITH ALERT NOTIFICATIONS):
${adminTabsList}

6. PLATFORM ROUTE HIERARCHY:
${routesList}

7. CONTRIBUTION & UPLOAD WORKFLOW:
   • Method 1: Floating blue "+" button at the bottom-left corner of the screen.
   • Method 2: Direct "+ Contribute" button inside any target subject folder.
   • Limits: PDF only, maximum 20 MB. Requires admin approval before appearing publicly.
=== END PLATFORM ENCYCLOPEDIA ===
`.trim();
}

module.exports = {
  DEFAULT_WEBSITE_INFO,
  OFFICIAL_TEAM,
  PLATFORM_ARCHITECTURE,
  PLATFORM_FEATURES,
  ADMIN_PANEL_SYSTEM,
  VERIFIED_ROUTES,
  TROUBLESHOOTING_GUIDE,
  getOfficialWebsiteInfo,
  updateOfficialWebsiteInfo,
  findNavigationRoute,
  getTroubleshootingGuide,
  getSystemKnowledgePrompt
};

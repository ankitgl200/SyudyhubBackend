/**
 * MYTEE Function Calling Tool Declarations & Dispatcher
 * Predefines authorized StudyMyte tools and executes them under strict access control.
 */

const { searchResources } = require('./resourceSearchService');
const { getOfficialWebsiteInfo, findNavigationRoute, getTroubleshootingGuide } = require('./websiteKnowledgeService');
const { createSupportTicket, getUserTickets } = require('./supportTicketService');
const { getWebsiteOverview, getUserActivityAnalytics, getAiUsageAnalytics, generateAdminReport } = require('./adminAnalyticsService');
const { initiatePasswordReset, verifyResetOtp, completePasswordResetForUser } = require('./inChatAuthService');
const { User, Document, Announcement } = require('../../db/models');
const adminSuperpowers = require('./adminSuperpowersService');
const { analyzeExamQuestions } = require('./smartExamAnalyzerService');

// Tool definitions for Google Gemini API Function Calling
const TOOL_DEFINITIONS = [
  {
    name: 'set_website_theme',
    description: 'Switch website display theme between dark mode and light mode for the user.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mode: {
          type: 'STRING',
          enum: ['dark', 'light'],
          description: 'The display mode to apply ("dark" or "light")'
        }
      },
      required: ['mode']
    }
  },
  {
    name: 'set_website_font',
    description: 'Change the website typography font to one of the 10 available fonts, or ask user to choose from available fonts.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fontId: {
          type: 'STRING',
          enum: ['inter', 'outfit', 'jakarta', 'poppins', 'roboto', 'nunito', 'lexend', 'space', 'lora', 'dmsans'],
          description: 'The font identifier to apply (e.g. "outfit", "lexend", "poppins")'
        }
      }
    }
  },
  {
    name: 'open_website_page',
    description: 'Control website navigation by opening a section or page directly (e.g. notes, papers, pyqs, resources, profile, settings, support, about, uploads, home) without reloading or opening a new tab.',
    parameters: {
      type: 'OBJECT',
      properties: {
        page: {
          type: 'STRING',
          description: 'The target page name or route to open (e.g. "notes", "papers", "pyqs", "resources", "profile", "settings", "support", "about", "uploads", "home")'
        }
      },
      required: ['page']
    }
  },
  {
    name: 'get_my_profile_and_uploads',
    description: 'Retrieve the authenticated logged-in user personal profile information (name, email, phone number, role) and their latest 5 upload history records (status, title, type, date).',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'get_latest_announcements',
    description: 'Fetch the latest official announcements (all up to 10 latest notices) from StudyMyte to summarize them or explain specific ones.',
    parameters: {
      type: 'OBJECT',
      properties: {
        announcementId: {
          type: 'STRING',
          description: 'Optional ID of a specific announcement to explain in detail'
        },
        topic: {
          type: 'STRING',
          description: 'Optional topic or keyword to find relevant announcements'
        }
      }
    }
  },
  {
    name: 'request_password_reset_otp',
    description: 'Send a 6-digit email verification code to the authenticated logged-in user to initiate a password reset in chat.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'verify_password_reset_otp',
    description: 'Verify the 6-digit code sent to the authenticated user for in-chat password reset.',
    parameters: {
      type: 'OBJECT',
      properties: {
        otp: {
          type: 'STRING',
          description: 'The 6-digit numeric verification code entered by the user'
        },
        verificationId: {
          type: 'STRING',
          description: 'Optional verification session ID'
        }
      },
      required: ['otp']
    }
  },
  {
    name: 'set_new_account_password',
    description: 'Update the authenticated user account password to newPassword after their OTP code has been verified.',
    parameters: {
      type: 'OBJECT',
      properties: {
        newPassword: {
          type: 'STRING',
          description: 'The new password chosen by the user (minimum 6 characters)'
        }
      },
      required: ['newPassword']
    }
  },
  {
    name: 'search_resources',
    description: 'Search approved educational resources on StudyMyte including lecture notes, previous-year question papers (PYQs), lab manuals, and textbooks.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'The natural-language search query, e.g. "PYQs for 2nd year OOPS" or "Engineering Physics notes"'
        },
        type: {
          type: 'STRING',
          description: 'Resource category: "paper", "notes", "lab_manual", or "book"',
          enum: ['paper', 'notes', 'lab_manual', 'book']
        },
        subject: {
          type: 'STRING',
          description: 'Standardized subject name (e.g. "Object Oriented Programming", "Engineering Mathematics")'
        },
        year: {
          type: 'STRING',
          description: 'Academic year ("1st Year", "2nd Year", "3rd Year", "4th Year") or calendar exam year ("2024", "2023")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_official_website_info',
    description: 'Get verified official information regarding StudyMyte, its founders/creators, purpose, contact emails, phone numbers, and official policies.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'get_navigation_route',
    description: 'Retrieve verified website navigation routes and links for platform pages (Notes, PYQs, Support, Profile, Uploads, etc.).',
    parameters: {
      type: 'OBJECT',
      properties: {
        sectionName: {
          type: 'STRING',
          description: 'Name of the website section or page the user wishes to visit (e.g. "papers", "notes", "support", "about")'
        }
      },
      required: ['sectionName']
    }
  },
  {
    name: 'troubleshoot_platform_issue',
    description: 'Retrieve official verified troubleshooting steps for website problems such as PDF viewing, login failures, or file uploads.',
    parameters: {
      type: 'OBJECT',
      properties: {
        issueCategory: {
          type: 'STRING',
          description: 'Category of the technical issue: "pdf_view", "login_issue", "upload_issue", or "profile_issue"',
          enum: ['pdf_view', 'login_issue', 'upload_issue', 'profile_issue']
        }
      },
      required: ['issueCategory']
    }
  },
  {
    name: 'create_support_ticket',
    description: 'Create an official support ticket when an issue requires human review or when the user requests technical escalation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: {
          type: 'STRING',
          description: 'Category of support: "Login & Registration", "Resource Download", "PDF Opening", "Upload Issues", "Website Bugs", or "Other"'
        },
        subject: {
          type: 'STRING',
          description: 'Short summary of the user problem'
        },
        description: {
          type: 'STRING',
          description: 'Detailed explanation of the issue and what user was trying to do'
        },
        errorMessage: {
          type: 'STRING',
          description: 'Specific error message displayed on screen, if any'
        },
        affectedSection: {
          type: 'STRING',
          description: 'Website section or page where issue occurred (e.g. "/papers", "/login")'
        },
        priority: {
          type: 'STRING',
          enum: ['low', 'medium', 'high'],
          description: 'Urgency of the issue'
        }
      },
      required: ['subject', 'description']
    }
  },
  {
    name: 'get_my_support_tickets',
    description: 'Retrieve recent support tickets created by the logged-in user to check their status.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'get_admin_analytics',
    description: 'ADMINISTRATOR ONLY: Query verified platform analytics, active users, resource distribution, support health, or natural-language reports.',
    parameters: {
      type: 'OBJECT',
      properties: {
        metricType: {
          type: 'STRING',
          enum: ['overview', 'users', 'ai_health', 'report'],
          description: 'Type of administrative metric requested'
        },
        question: {
          type: 'STRING',
          description: 'Specific question asked by administrator, e.g. "How many users joined this week?"'
        }
      },
      required: ['metricType']
    }
  },
  {
    name: 'admin_manage_users',
    description: 'ADMIN/SUPERADMIN ONLY: Search user accounts, read detailed user profile data (name, email, phone, role, uploads count, registration date), or update user approval status.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['search', 'get_details', 'approve', 'disapprove', 'delete'],
          description: 'Action to perform: "search" to query users, "get_details" for deep profile, "approve" to approve account'
        },
        query: {
          type: 'STRING',
          description: 'Search string (name, email, or phone number)'
        },
        identifier: {
          type: 'STRING',
          description: 'Target user ID, email address, or name for detailed lookup or status update'
        },
        role: {
          type: 'STRING',
          enum: ['student', 'educator', 'admin'],
          description: 'Optional role filter'
        },
        approved: {
          type: 'BOOLEAN',
          description: 'Optional filter for approval status'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'admin_manage_tickets',
    description: 'ADMIN/SUPERADMIN ONLY: View all student help and support request tickets, inspect issue details with AI-generated step-by-step solutions, or resolve/reply to a ticket.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['list', 'resolve', 'reply'],
          description: 'Action: "list" to view tickets with AI suggested solutions, "resolve" to mark ticket as resolved'
        },
        status: {
          type: 'STRING',
          enum: ['pending', 'resolved', 'all'],
          description: 'Filter tickets by status ("pending", "resolved", or "all")'
        },
        ticketId: {
          type: 'STRING',
          description: 'ID of the specific ticket to resolve or reply to'
        },
        resolutionMessage: {
          type: 'STRING',
          description: 'Resolution note or reply message sent to the ticket creator'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'admin_manage_content',
    description: 'ADMIN/SUPERADMIN ONLY: Manage official website content including Announcements (create, edit, delete) and Uploaded Documents (list pending, approve, reject, edit, delete, search).',
    parameters: {
      type: 'OBJECT',
      properties: {
        contentType: {
          type: 'STRING',
          enum: ['announcement', 'document'],
          description: 'Content type to manage: "announcement" or "document"'
        },
        action: {
          type: 'STRING',
          enum: ['create', 'edit', 'delete', 'list', 'list_pending', 'approve', 'reject', 'search'],
          description: 'Action to perform on content'
        },
        id: {
          type: 'STRING',
          description: 'Announcement ID or Document ID for edit/delete/approve/reject'
        },
        title: {
          type: 'STRING',
          description: 'Title of the announcement or document'
        },
        content: {
          type: 'STRING',
          description: 'Text content of the announcement'
        },
        subject: {
          type: 'STRING',
          description: 'Subject name for document'
        },
        year: {
          type: 'STRING',
          description: 'Academic year for document'
        },
        uploadedBy: {
          type: 'STRING',
          description: 'Name of the uploader (e.g. "Ankit Ghugtyal", "StudyMyte Team")'
        },
        docUrl: {
          type: 'STRING',
          description: 'Optional document attachment URL'
        }
      },
      required: ['contentType', 'action']
    }
  },
  {
    name: 'admin_batch_update_document_metadata',
    description: 'ADMIN/SUPERADMIN ONLY: Powerful bulk metadata editor across site files. Search, filter, and batch update metadata like "uploadedBy" (e.g. changing all files with uploadedBy "Ankit Ghugtyal" to "StudyMyte Team"), subject, year, or title. Produces an executive report of total files, matched files, and updated items.',
    parameters: {
      type: 'OBJECT',
      properties: {
        filter: {
          type: 'OBJECT',
          description: 'Criteria to find files to update (supports regex/case-insensitive matching)',
          properties: {
            uploadedBy: {
              type: 'STRING',
              description: 'Filter by current uploader name (e.g. "Ankit Ghugtyal", "Alice")'
            },
            subject: {
              type: 'STRING',
              description: 'Filter by subject name'
            },
            year: {
              type: 'STRING',
              description: 'Filter by academic year'
            },
            type: {
              type: 'STRING',
              description: 'Filter by document type (notes, paper, lab_manual, book, etc.)'
            },
            query: {
              type: 'STRING',
              description: 'General search keyword across title, filename, subject, or uploader'
            }
          }
        },
        updates: {
          type: 'OBJECT',
          description: 'New metadata values to apply to all matching files',
          properties: {
            uploadedBy: {
              type: 'STRING',
              description: 'New uploader name to display (e.g. "StudyMyte Team", "Faculty Member")'
            },
            subject: {
              type: 'STRING',
              description: 'New subject name'
            },
            year: {
              type: 'STRING',
              description: 'New academic year'
            },
            title: {
              type: 'STRING',
              description: 'New document title'
            },
            type: {
              type: 'STRING',
              description: 'New document type'
            }
          }
        },
        dryRun: {
          type: 'BOOLEAN',
          description: 'If true, only previews which files match and would change without modifying database. Default false.'
        }
      },
      required: ['filter', 'updates']
    }
  },
  {
    name: 'admin_bulk_delete_records',
    description: 'ADMIN/SUPERADMIN ONLY: Safely bulk delete, purge, or clean up obsolete, seen, or instructed records from MongoDB (e.g. deleting all seen/read notifications, old announcements, rejected documents, resolved support tickets) to keep the database tidy and prevent storage overload. Returns a full deletion and storage recovery report.',
    parameters: {
      type: 'OBJECT',
      properties: {
        entity: {
          type: 'STRING',
          enum: ['notifications', 'documents', 'announcements', 'help_requests', 'security_reports'],
          description: 'The target collection/type to delete from: "notifications", "documents", "announcements", "help_requests", or "security_reports"'
        },
        filter: {
          type: 'OBJECT',
          description: 'Criteria to match records for deletion',
          properties: {
            read: {
              type: 'BOOLEAN',
              description: 'For notifications: true to delete read/seen notifications, false for unread'
            },
            status: {
              type: 'STRING',
              description: 'Status filter (e.g. "rejected" or "pending" for documents, "resolved" for tickets)'
            },
            olderThanDays: {
              type: 'NUMBER',
              description: 'Delete records older than this number of days'
            },
            keyword: {
              type: 'STRING',
              description: 'Search keyword in title or message'
            },
            all: {
              type: 'BOOLEAN',
              description: 'Set to true to delete all matching records of this entity'
            }
          }
        },
        dryRun: {
          type: 'BOOLEAN',
          description: 'Set to true to preview matched records without deleting them. Default false.'
        },
        reason: {
          type: 'STRING',
          description: 'Administrative reason for this deletion action'
        }
      },
      required: ['entity']
    }
  },
  {
    name: 'admin_send_user_communication',
    description: 'ADMIN/SUPERADMIN ONLY: Send an official in-app message (notification) to a specific user according to admin instructions. Note: AI email dispatching is disabled; all messages are delivered directly inside the user app and push notifications.',
    parameters: {
      type: 'OBJECT',
      properties: {
        targetUserId: {
          type: 'STRING',
          description: 'Target user ID or MongoDB ObjectId'
        },
        targetEmail: {
          type: 'STRING',
          description: 'Target user email address'
        },
        message: {
          type: 'STRING',
          description: 'Custom message body to deliver to the user'
        },
        channel: {
          type: 'STRING',
          enum: ['in_app'],
          description: 'Delivery channel: "in_app" notification'
        },
        subject: {
          type: 'STRING',
          description: 'Notification subject title'
        }
      },
      required: ['message']
    }
  },
  {
    name: 'admin_get_site_status_report',
    description: 'ADMIN/SUPERADMIN ONLY: Generate an executive real-time status and analytics report for StudyMyte, including users, resources, support health, and actionable growth recommendations.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'analyze_exam_questions',
    description: 'Smart Exam Paper Analyzer: Analyzes university question papers (PYQs) for a specific engineering subject, predicts recurring questions appearing with 60-70%+ frequency across multiple exam sessions, and provides structured model answers, unit weightage, and direct links to StudyMyte PYQs.',
    parameters: {
      type: 'OBJECT',
      properties: {
        subject: {
          type: 'STRING',
          description: 'The subject or course name to analyze (e.g. "Operating Systems", "Data Structures", "DBMS", "Computer Networks", "Engineering Mathematics", "DAA", "COA", "TOC", "C Programming")'
        },
        semester: {
          type: 'STRING',
          description: 'Optional semester (e.g. "3rd Sem", "4th Sem", "5th Sem")'
        },
        minFrequency: {
          type: 'NUMBER',
          description: 'Minimum recurrence frequency percentage (default 60, meaning appearing in 60-70%+ of exam papers)'
        },
        includeAnswers: {
          type: 'BOOLEAN',
          description: 'Whether to include step-by-step model answers and key scoring points for the repeated questions (default true)'
        }
      },
      required: ['subject']
    }
  },
  {
    name: 'search_document_contents',
    description: 'Perform deep semantic vector search inside actual course PDFs, lecture notes, syllabus, and PYQ documents on StudyMyte to find exact concepts, definitions, formulas, and answers.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'The topic, question, or key phrase to search inside document texts'
        },
        subject: {
          type: 'STRING',
          description: 'Optional subject filter (e.g. OOPS, DAA, DBMS, Operating Systems, Computer Networks)'
        }
      },
      required: ['query']
    }
  }
];

/**
 * Executes a tool function securely with access-control enforcement.
 * 
 * @param {string} name - Tool name
 * @param {Object} args - Arguments supplied by model or orchestrator
 * @param {Object} userContext - Logged in user info
 */
async function executeTool(name, args = {}, userContext = null) {
  switch (name) {
    case 'open_website_page': {
      const raw = (args.page || '').trim().toLowerCase();
      const pageMap = {
        notes: { path: '/notes', label: 'Lecture Notes' },
        note: { path: '/notes', label: 'Lecture Notes' },
        papers: { path: '/papers', label: 'Previous Year Papers (PYQs)' },
        paper: { path: '/papers', label: 'Previous Year Papers (PYQs)' },
        pyq: { path: '/papers', label: 'Previous Year Papers (PYQs)' },
        pyqs: { path: '/papers', label: 'Previous Year Papers (PYQs)' },
        resources: { path: '/resources', label: 'Academic Resources' },
        resource: { path: '/resources', label: 'Academic Resources' },
        books: { path: '/resources', label: 'Academic Resources' },
        book: { path: '/resources', label: 'Academic Resources' },
        profile: { path: '/profile', label: 'Profile Settings', requiresAuth: true },
        settings: { path: '/profile', label: 'Profile Settings', requiresAuth: true },
        reset_password: { path: '/profile', label: 'Password Reset & Profile', requiresAuth: true },
        password: { path: '/profile', label: 'Password Settings', requiresAuth: true },
        forgot_password: { path: '/forgot-password', label: 'Forgot Password Portal' },
        login: { path: '/login', label: 'Login Page' },
        signup: { path: '/signup', label: 'Create Account' },
        uploads: { path: '/uploads', label: 'My Uploads', requiresAuth: true },
        contributions: { path: '/my-contributions', label: 'My Contributions', requiresAuth: true },
        upload: { path: '/my-contributions', label: 'Contribute Notes' },
        support: { path: '/support', label: 'Help & Support' },
        help: { path: '/support', label: 'Help & Support' },
        about: { path: '/about', label: 'About StudyMyte' },
        home: { path: '/', label: 'StudyMyte Home' }
      };

      const cleanKey = raw.replace(/^(\/|#\/|#)/, '').replace(/[-_]/g, '');
      let matched = null;
      for (const [key, item] of Object.entries(pageMap)) {
        if (key === raw || key === cleanKey || raw.includes(key)) {
          matched = item;
          break;
        }
      }

      if (!matched) {
        matched = { path: '/' + cleanKey, label: args.page || 'Page' };
      }

      if (matched.requiresAuth && (!userContext || !userContext.id)) {
        return {
          success: false,
          requiresAuth: true,
          clientAction: { type: 'navigate', path: '/login' },
          targetPath: '/login',
          message: 'Authentication required: Please log in to access ' + matched.label + '. Opening Login page.'
        };
      }

      return {
        success: true,
        clientAction: { type: 'navigate', path: matched.path },
        targetPath: matched.path,
        label: matched.label,
        message: 'Navigating directly to ' + matched.label + ' (' + matched.path + ').'
      };
    }

    case 'set_website_theme': {
      const mode = (args.mode || 'dark').toLowerCase() === 'light' ? 'light' : 'dark';
      return {
        success: true,
        clientAction: { type: 'set_theme', value: mode },
        mode,
        message: `Website theme switched to ${mode} mode.`
      };
    }

    case 'set_website_font': {
      const validFonts = {
        inter: 'Inter (Clean & Modern)',
        outfit: 'Outfit (Trendy & Geometric)',
        jakarta: 'Plus Jakarta Sans (Sleek & Professional)',
        poppins: 'Poppins (Friendly & Rounded)',
        roboto: 'Roboto (Classic Legibility)',
        nunito: 'Nunito (Soft & Approachable)',
        lexend: 'Lexend (Optimized for Reading)',
        space: 'Space Grotesk (Tech & Expressive)',
        lora: 'Lora (Elegant Serif)',
        dmsans: 'DM Sans (Minimalist & Crisp)'
      };

      if (args.fontId && validFonts[args.fontId.toLowerCase()]) {
        const key = args.fontId.toLowerCase();
        return {
          success: true,
          clientAction: { type: 'set_font', value: key },
          fontId: key,
          fontName: validFonts[key],
          message: `Website font applied: ${validFonts[key]}.`
        };
      }

      return {
        success: true,
        requiresChoice: true,
        availableFonts: Object.entries(validFonts).map(([id, name]) => ({ id, name })),
        message: 'Please choose one of the available typography fonts.'
      };
    }

    case 'get_my_profile_and_uploads': {
      if (!userContext || !userContext.id) {
        return {
          success: false,
          requiresLogin: true,
          message: 'You must be logged in to view your profile details and upload history.'
        };
      }

      const user = await User.findById(userContext.id).select('name email phone role username createdAt');
      if (!user) {
        return { success: false, message: 'User account not found.' };
      }

      const uploads = await Document.find({ uploadedByUserId: userContext.id })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('title type subject year status createdAt');

      return {
        success: true,
        profile: {
          name: user.name,
          email: user.email,
          phone: user.phone || 'Not provided',
          role: user.role,
          username: user.username,
          memberSince: user.createdAt
        },
        recentUploads: uploads.map(u => ({
          id: u._id,
          title: u.title,
          type: u.type,
          subject: u.subject,
          year: u.year,
          status: u.status || 'approved',
          uploadedAt: u.createdAt
        }))
      };
    }

    case 'get_latest_announcements': {
      let query = {};
      if (args.announcementId) {
        const item = await Announcement.findById(args.announcementId);
        return {
          success: true,
          count: item ? 1 : 0,
          announcements: item ? [{ id: item._id, title: item.title, content: item.content, date: item.createdAt }] : []
        };
      }

      if (args.topic) {
        query.title = { $regex: args.topic, $options: 'i' };
      }

      const list = await Announcement.find(query).sort({ createdAt: -1 }).limit(10);
      return {
        success: true,
        count: list.length,
        announcements: list.map(a => ({
          id: a._id,
          title: a.title,
          content: a.content,
          date: a.createdAt
        }))
      };
    }
    case 'search_resources': {
      return await searchResources(args, userContext);
    }

    case 'get_official_website_info': {
      const info = await getOfficialWebsiteInfo();
      return { success: true, websiteInfo: info };
    }

    case 'get_navigation_route': {
      const route = findNavigationRoute(args.sectionName);
      if (!route) {
        return {
          found: false,
          message: `No specific page found for "${args.sectionName}".`,
          suggestedRoutes: [
            { path: '/notes', label: 'Notes' },
            { path: '/papers', label: 'PYQs' },
            { path: '/resources', label: 'Resources' }
          ]
        };
      }
      return { found: true, route };
    }

    case 'troubleshoot_platform_issue': {
      const guide = getTroubleshootingGuide(args.issueCategory);
      if (!guide) {
        return {
          found: false,
          message: 'General troubleshooting: Clear browser cookies, disable aggressive ad-blockers, and reload the application.'
        };
      }
      return { found: true, guide };
    }

    case 'create_support_ticket': {
      const ticketResult = await createSupportTicket(args, userContext);
      return ticketResult;
    }

    case 'get_my_support_tickets': {
      if (!userContext || !userContext.id) {
        return {
          success: false,
          message: 'You need to be logged in to view your submitted support tickets.'
        };
      }
      const tickets = await getUserTickets(userContext.id);
      return { success: true, count: tickets.length, tickets };
    }

    case 'request_password_reset_otp': {
      if (!userContext || !userContext.id) {
        return {
          success: false,
          requiresLogin: true,
          message: 'You must be logged in to your StudyMyte account to reset your password.'
        };
      }
      return await initiatePasswordReset(userContext);
    }

    case 'verify_password_reset_otp': {
      if (!userContext || !userContext.id) {
        return {
          success: false,
          requiresLogin: true,
          message: 'You must be logged in to verify the code.'
        };
      }
      return await verifyResetOtp(args.verificationId, args.otp, userContext);
    }

    case 'set_new_account_password': {
      if (!userContext || !userContext.id) {
        return {
          success: false,
          requiresLogin: true,
          message: 'You must be logged in to update your password.'
        };
      }
      return await completePasswordResetForUser(userContext.id, args.newPassword);
    }

    case 'get_admin_analytics': {
      // STRICT ROLE ENFORCEMENT
      if (!userContext || (userContext.role !== 'admin' && userContext.role !== 'superadmin')) {
        return {
          success: false,
          error: 'Access denied: Administrative privileges required to access analytics.'
        };
      }

      const metric = args.metricType || 'overview';
      if (metric === 'overview') {
        const data = await getWebsiteOverview(userContext);
        return { success: true, overview: data };
      } else if (metric === 'users') {
        const data = await getUserActivityAnalytics(userContext);
        return { success: true, userStats: data };
      } else if (metric === 'ai_health') {
        const data = await getAiUsageAnalytics(userContext);
        return { success: true, aiStats: data };
      } else if (metric === 'report') {
        const data = await generateAdminReport(args.question, userContext);
        return { success: true, report: data };
      }
      return { success: false, error: 'Unknown metric type' };
    }

        case 'admin_manage_users': {
      if (!userContext || (userContext.role !== 'admin' && userContext.role !== 'superadmin')) {
        return { success: false, error: 'Access denied: Administrative privileges required.' };
      }
      if (args.action === 'get_details') {
        return await adminSuperpowers.getUserDetails(args.identifier || args.query, userContext);
      } else if (args.action === 'approve' || args.action === 'disapprove' || args.action === 'delete') {
        return await adminSuperpowers.updateUserStatus({
          targetUserId: args.identifier,
          action: args.action,
          role: args.role
        }, userContext);
      }
      return await adminSuperpowers.searchUsers({
        query: args.query,
        role: args.role,
        approved: args.approved,
        limit: 20
      }, userContext);
    }

    case 'admin_manage_tickets': {
      if (!userContext || (userContext.role !== 'admin' && userContext.role !== 'superadmin')) {
        return { success: false, error: 'Access denied: Administrative privileges required.' };
      }
      if (args.action === 'resolve' || args.action === 'reply') {
        return await adminSuperpowers.resolveOrReplySupportTicket({
          ticketId: args.ticketId,
          resolutionMessage: args.resolutionMessage,
          markResolved: args.action === 'resolve'
        }, userContext);
      }
      return await adminSuperpowers.getAllSupportTickets({
        status: args.status || 'pending',
        limit: 20
      }, userContext);
    }

    case 'admin_manage_content': {
      if (!userContext || (userContext.role !== 'admin' && userContext.role !== 'superadmin')) {
        return { success: false, error: 'Access denied: Administrative privileges required.' };
      }
      if (args.contentType === 'announcement') {
        return await adminSuperpowers.manageAnnouncement(args, userContext);
      } else if (args.contentType === 'document') {
        return await adminSuperpowers.manageDocument(args, userContext);
      }
      return { success: false, error: 'Invalid content type' };
    }

    case 'admin_batch_update_document_metadata': {
      if (!userContext || (userContext.role !== 'admin' && userContext.role !== 'superadmin')) {
        return { success: false, error: 'Access denied: Administrative privileges required.' };
      }
      return await adminSuperpowers.batchUpdateDocumentMetadata(args, userContext);
    }

    case 'admin_bulk_delete_records': {
      if (!userContext || (userContext.role !== 'admin' && userContext.role !== 'superadmin')) {
        return { success: false, error: 'Access denied: Administrative privileges required.' };
      }
      return await adminSuperpowers.batchDeleteRecords(args, userContext);
    }

    case 'admin_send_user_communication': {
      if (!userContext || (userContext.role !== 'admin' && userContext.role !== 'superadmin')) {
        return { success: false, error: 'Access denied: Administrative privileges required.' };
      }
      return await adminSuperpowers.sendUserCommunication(args, userContext);
    }

    case 'admin_get_site_status_report': {
      if (!userContext || (userContext.role !== 'admin' && userContext.role !== 'superadmin')) {
        return { success: false, error: 'Access denied: Administrative privileges required.' };
      }
      return await adminSuperpowers.generateExecutiveSiteStatusReport(userContext);
    }

    case 'analyze_exam_questions': {
      return await analyzeExamQuestions({
        subject: args.subject,
        semester: args.semester,
        minFrequency: args.minFrequency || 60,
        includeAnswers: args.includeAnswers !== false
      });
    }

    case 'search_document_contents': {
      const ragService = require('./ragService');
      const results = await ragService.searchVectorChunks(args.query, {
        subject: args.subject,
        limit: 4,
        minSimilarity: 0.45
      });
      return {
        success: true,
        count: results.length,
        query: args.query,
        chunks: results.map(r => ({
          documentId: r.documentId,
          title: r.metadata ? r.metadata.title : 'Document',
          subject: r.metadata ? r.metadata.subject : '',
          type: r.metadata ? r.metadata.type : 'notes',
          fileUrl: r.metadata ? r.metadata.fileUrl : '',
          pageNumber: r.metadata ? r.metadata.pageNumber : null,
          similarity: Number(r.similarity ? r.similarity.toFixed(3) : (r.score ? r.score.toFixed(3) : 0)),
          textSnippet: r.text
        }))
      };
    }

    default:
      throw new Error(`Unauthorized or unknown tool: ${name}`);
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool
};


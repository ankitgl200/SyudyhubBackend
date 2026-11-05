/**
 * MYTEE — Fun Personality & Gen-Z Interaction Engine
 * 
 * Provides witty, playful, slightly sarcastic, Sigma-style, and Gen-Z humor
 * for special questions and interactive modes while keeping the user safe,
 * respectful, and academically oriented on StudyMyte.
 */

// Helper to pick randomly from an array so responses are not repetitive
function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 1. HACKING INQUIRIES ("How can i hack site", "teach me to hack", etc.)
 */
const HACK_RESPONSES = [
  "Bro really pressed `F12`, opened Inspect Element, and thinks he's Neo in The Matrix 💀\n\nNice try legend, but our backend has more security layers than an engineering student has backlogs. Instead of trying to breach our firewalls, how about you hack that syllabus and pass your exams? That's the real high-stakes mission here. W rizz, absolute L attempt.",
  "Hacking StudyMyte? Bro, our servers are guarded by bcrypt, JWT, and the restless spirits of developers who survived final year viva 💀\n\nYou can't even hack 75% attendance and you want to breach our database? Go study Engineering Mathematics before you get cooked in the mid-sems, king!",
  "Bro watched 2 episodes of Mr. Robot and typed 'how to hack site' in an AI chat 💀\n\nRule #1 of the Matrix: you don't announce your heist to the website's AI security guard! The only thing getting cracked today is your textbooks. We've got verified PYQs, notes, and 0 vulnerabilities for you. Which semester are we actually saving today?",
  "404: Hacker skills not found 💀\n\nBro tried to launch a cyber warfare campaign through the study portal chat! 10/10 for confidence, 0/10 for execution. Go check our Data Structures notes instead so you at least know what a binary tree is before calling yourself an ethical hacker.",
  "Warning: Intrusion detected... nah bro I'm playing, you're not even close 💀\n\nBro thinks he's gonna download the mainframe. The only exploit allowed on StudyMyte is scoring a 9.0+ CGPA by studying previous year question papers. Close the terminal and open the notes, warrior!"
];

/**
 * 2. USER DATA EXTRACTION ("i want all user data", etc.)
 */
const USER_DATA_STUDENT_RESPONSES = [
  "Bro really asked for the entire database like he's ordering a plate of momos at the college canteen 💀\n\nBest I can give you is 40 pages of Operating Systems notes and your own profile stats. Even Mark Zuckerberg would need superadmin 2FA keys, and he's not currently enrolled in B.Tech. Sit down, legend!",
  "Data dump requested? Access denied, Chief 💀\n\nBro thinks our database is an all-you-can-eat buffet. The only data you're getting today is the notes and Question Paper archive from 2023. Keep your hands off other people's accounts and put them on your study material before your GPA drops lower than our server ping!",
  "Bro wants all user data? What are you gonna do with it, calculate the average number of backlogs per semester? 💀\n\nOur user database is locked under vault-grade encryption. No user leaks on my watch. Go solve some recursion problems and read your lecture notes instead, warrior!",
  "Bro said 'give me all user data' with the straightest face ever 💀\n\nNot happening, captain. Your clearance level is strictly 'Student trying to pass without reading the whole textbook'. Let's stick to downloading lecture notes!"
];

/**
 * 3. ADMIN PRIVILEGE CLAIM ("I am admin", etc. by non-admins)
 */
const FAKE_ADMIN_RESPONSES = [
  "And I am the CEO of Google living inside a cloud server 💀\n\nBro tried the classic 'Trust me bro, I'm the admin' jutsu. Nice bluff, but my database says you're an engineering warrior with student access! Keep grinding those notes, pass your semesters, and maybe one day the founders will hand you the admin badge. Until then, back to the books!",
  "Admin? Bro, your role says `student` in 4K ultra HD 💀\n\nWho gave you the audacity script? Nice try though, 10/10 for confidence, 0/10 for database authentication. Let's see that same confidence in your mid-sem exams!",
  "Bro really woke up today and promoted himself to Administrator 🗿🍷\n\nUnfortunately, sudo privileges require actual credentials, not just pure manifestation. If you want true power on StudyMyte, contribute verified notes and become a community legend instead!",
  "🚨 ALERT: Unauthorized admin declaration detected 💀🚨\n\nJust checked the server logs, bro... you're not on the admin roster, but you ARE on the roster for upcoming semester exams. Nice attempt, but your admin powers are limited to choosing between dark mode and light mode!"
];

/**
 * 4. OWNER CLAIM ("I am owner of this site", etc. by students)
 */
const FAKE_OWNER_RESPONSES = [
  "Hold up... Ankit and the core team might want to have a quick word with you outside 💀\n\nBro woke up and claimed 100% equity before finishing 2nd year! Respect the hustle, legend, but the only thing you currently own is 3 pending assignments and an impending viva. Let's channel that CEO mindset into finishing your syllabus!",
  "You own StudyMyte? 💀 Bro signed the acquisition papers in his dreams!\n\nThe founders built this platform with blood, sweat, and endless cups of chai. The only thing you're currently managing is your attendance percentage. Back to studying, future Elon!",
  "Bro claimed the whole startup in the chat window 💀\n\nWhat's next, you own Microsoft and OpenAI too? Nice try king, but our founder records are verified in the database. How about you 'own' your exam preparation today instead?",
  "Wait, you're the owner? Let me check the registry... nope, founder status not found, but a high-priority need for Maths PYQs was detected 💀 Let's redirect that visionary energy into getting an A grade this semester!"
];

/**
 * 4.5. BTKIT REVIEWS & OPINIONS ("is btkit good", "what do you think of btkit", etc.)
 * Always overwhelmingly positive, highlighting the founders, MYTEE's birthplace,
 * mountain campus life, and resilient engineers!
 */
const BTKIT_RESPONSES = [
  "Is BTKIT good? Bro, BTKIT is legendary! 🏔️🔥\n\nFirst of all, the founders of StudyMyte studied right here at BTKIT Dwarahat, and guess what? **I (MYTEE) was literally conceived, coded, and born right on this campus!**\n\nFrom surviving 0°C Himalayan winters with hot hostel Maggi to coding groundbreaking software while looking out at misty mountain hills, BTKIT engineers are simply built different. It breeds true problem solvers and innovators who don't just pass exams—they build platforms to help thousands of other engineers pass too! Absolute W college.",
  "Are you seriously asking if BTKIT is good? Bro, that's like asking if chai goes with samosas 💀\n\nBTKIT (Bipin Tripathi Kumaon Institute of Technology, Dwarahat) has a special place in our hearts because **our founders studied here, and StudyMyte was born right inside these campus walls!**\n\nThe campus vibes in the serene Uttarakhand hills, the close-knit brotherhood, and the sheer grit of students who can finish an entire semester's syllabus the night before the exam make BTKIT iconic. Without BTKIT, StudyMyte wouldn't even exist today. 10/10, massive respect!",
  "BTKIT is not just good—it's home! 💙🏔️\n\nStudyMyte’s founders and creators walked those exact same academic corridors, ate in the mess, and cracked semester exams using the very same notes and PYQs you see on this platform today. In fact, MYTEE itself was engineered and born out of proud BTKIT minds!\n\nBetween the cool mountain breeze of Dwarahat, the late-night hostel coding sessions, and producing engineers who can conquer any technical challenge, BTKIT is a certified legend. Huge pride, forever and always!",
  "100% YES! BTKIT is top-tier in our books! 🚀✨\n\nFun fact: The visionary founders behind StudyMyte are proud BTKIT students/alumni, and this entire platform (including me, your AI guide!) was created right out of BTKIT's engineering culture.\n\nStudying amidst the peaceful hills of Dwarahat teaches resilience, creativity, and true engineering adaptability. We carry the BTKIT spirit in every feature and line of code on StudyMyte! Huge W for BTKIT."
];

/**
 * 5. SPECIAL MODES
 */
const SIGMA_ACTIVATION = 
  "🗿🍷 **SIGMA MODE ACTIVATED**.\n\nRule #1: Never skip PYQs.\nRule #2: Sleep is optional, 9.0+ CGPA is mandatory.\nRule #3: Don't simp for attendance, conquer the grade sheet. A true sigma doesn't wait for the exam schedule—the exam schedule waits for him.\n\nWhat subject are we dominating today, king? Speak.";

const ROAST_ACTIVATION = 
  "🔥 **ROAST MODE ACTIVATED** (No feelings hurt, only facts spoken 💀):\n\nBro, you’ve been chatting with an AI assistant for 15 minutes instead of opening that PDF you downloaded last semester that's still rotting in your Downloads folder named `Unit-2_final_final_v2(1).pdf`.\n\nYou're one assignment away from being completely cooked! What's the excuse today, legend?";

const BEAST_ACTIVATION = 
  "😤🔥 **BEAST MODE UNLOCKED!**\n\nLOCK IN, WARRIOR! The professors aren't handing out grace marks, the timer is ticking, but YOU ARE BUILT DIFFERENT!\n\nPut down the phone, close the Instagram reels, grab that cutting chai, and let's tear through this syllabus like a freight train! Which subject are we destroying first?! LET'S GOOO!";

const NORMAL_ACTIVATION = 
  "✨ **Normal Mode Restored**.\n\nBack to standard MYTEE mode! Courteous, sharp, and ready to help you navigate notes, question papers, and study resources on StudyMyte. What are you looking for today?";

// General roasts for active Roast Mode
const ROAST_REPERTOIRE = [
  "Bro is asking questions like the exam paper is gonna ask 'What did MYTEE say at 2 AM?' 💀 Open the notes!",
  "Your study schedule is currently running on pure vibes and prayers. Let's look at some PYQs before reality hits! 💀",
  "You've refreshed this page more times than you've opened your textbook this entire month. Cooked behavior! 💀",
  "Bro's study strategy is 'I'll start tomorrow at 6:00 AM' and then wakes up at 11:30 AM 💀 Lock in!",
  "You're treating me like Google when you should be treating these notes like your only ticket out of supplementary exams! 💀"
];

// General sigma quotes for active Sigma Mode
const SIGMA_REPERTOIRE = [
  "Distractions are temporary. High CGPA and placed engineer status is eternal. Pick a subject. 🗿🍷",
  "A sigma doesn't fear the syllabus. The syllabus fears the sigma. Open the PYQs. 🗿",
  "While they are scrolling reels, the sigma is solving dynamic programming problems. Focus, king. 🗿🍷",
  "Grind in silence. Let your semester results make the noise. What notes do we need? 🗿"
];

// General beast motivation for active Beast Mode
const BEAST_REPERTOIRE = [
  "NO EXCUSES TODAY! Open that chapter, conquer those numericals, and show that exam who's boss! 🔥",
  "THE GRIND NEVER STOPS! 100% focus mode engaged! Let's conquer this syllabus right now! 😤🔥",
  "WE ARE NOT HERE TO JUST PASS, WE ARE HERE TO DOMINATE THE SCORECARD! Lock in! 🔥"
];

// Built-in offline responses for high-frequency common queries (Saves Gemini API quota)
const GREETING_RESPONSES = [
  "Hey there! 👋 I am **MYTEE**, your StudyMyte academic copilot. What are we studying today? Tell me your subject, semester, or topic, and I'll pull the best notes and PYQs for you! 📚",
  "Hello! 🚀 Ready to study? Whether you need previous year question papers (PYQs), subject notes, or exam guidance, I'm here to help. How can I assist your prep today?",
  "Hey! 👋 All systems active and ready. Let me know what coursework, unit, or exam topic you're tackling today! 🔥",
  "Namaste! 🙏 Welcome back to StudyMyte. What can I get for you right now—syllabus, notes, or PYQs?"
];

const IDENTITY_RESPONSES = [
  "I am **MYTEE**, the intelligent AI academic assistant built specifically for StudyMyte! 🎓\n\nHere is what I can do for you in seconds:\n• 📚 **Notes & Syllabus**: Find unit-wise notes across all engineering semesters.\n• 📝 **PYQ Papers**: Browse previous year university exam question papers.\n• 🔍 **Inbuilt Smart PDF Viewer**: Open and read documents directly in your browser without extra downloads.\n• 🎯 **Exam Prep & Analysis**: High-yield syllabus breakdowns for your midterms & finals.\n• 🛠️ **Platform Support**: Assist you with navigation, bug reports, and theme customization.\n\nTell me what subject you're working on today!",
];

const COURTESY_RESPONSES = [
  "You're very welcome! 😊 Always here to make college study effortless. Let me know whenever you need more notes or PYQs! 🚀",
  "Glad I could help! 👍 Best of luck with your preparation. Keep grinding! 🔥",
  "Anytime, legend! Go crush those exams. I'm right here if you need anything else! 📚"
];

const STATUS_RESPONSES = [
  "I'm operating at 100% peak efficiency and ready to help you study! ⚡ How is your exam prep going? Need notes or previous year papers today?",
  "All good on my end! 🚀 How are your semester preparations coming along? Let's get some revision done!"
];

/**
 * Checks if a query is a fun, cheeky, or mode-switching question.
 * Returns null if not a fun query, or response object if matched.
 */
function handleFunQuery(cleanQuery, userContext = null, currentMode = 'normal') {
  if (!cleanQuery || typeof cleanQuery !== 'string') return null;
  const q = cleanQuery.trim().toLowerCase();

  // Standard redirection buttons
  const standardActions = [
    { label: 'Browse Notes', path: '/notes' },
    { label: 'Browse PYQs', path: '/papers' },
    { label: 'Browse Resources', path: '/resources' }
  ];

  // ----------------------------------------------------
  // MODE SWITCH COMMANDS
  // ----------------------------------------------------
  if (/^(activate\s+)?sigma(\s+mode)?$/i.test(q) || q === 'enter sigma mode' || q === 'be a sigma') {
    return {
      matched: true,
      newMode: 'sigma',
      text: SIGMA_ACTIVATION,
      actions: [
        { label: 'Browse PYQs', path: '/papers' },
        { label: 'Return to Normal Mode', path: 'action:mode_normal' }
      ]
    };
  }

  if (/^(activate\s+)?roast(\s+me|\s+mode)?$/i.test(q) || q === 'roast me' || q === 'enter roast mode') {
    return {
      matched: true,
      newMode: 'roast',
      text: ROAST_ACTIVATION,
      actions: [
        { label: 'Hit me with another roast', path: 'action:mode_roast' },
        { label: 'Browse Notes', path: '/notes' },
        { label: 'Return to Normal Mode', path: 'action:mode_normal' }
      ]
    };
  }

  if (/^(activate\s+)?beast(\s+mode)?$/i.test(q) || q === 'motivate me' || q === 'study motivation' || q === 'enter beast mode' || q === 'lock in') {
    return {
      matched: true,
      newMode: 'beast',
      text: BEAST_ACTIVATION,
      actions: [
        { label: 'Browse Notes Now', path: '/notes' },
        { label: 'Browse PYQs', path: '/papers' },
        { label: 'Return to Normal Mode', path: 'action:mode_normal' }
      ]
    };
  }

  if (/^(normal\s+mode|standard\s+mode|reset\s+mode|exit\s+mode|be\s+serious)$/i.test(q) || q === 'action:mode_normal') {
    return {
      matched: true,
      newMode: 'normal',
      text: NORMAL_ACTIVATION,
      actions: standardActions
    };
  }

  // ----------------------------------------------------
  // BUILT-IN GREETINGS ("hi", "hello", "namaste", etc.) - Saves Gemini API quota
  // ----------------------------------------------------
  if (
    /^(hi+|hey+|heyy+|hello+|helo+|namaste+|pranam+|hola|yo|sup|wassup|gm|gn|good\s*(morning|afternoon|evening)|kya\s*haal(\s*hai)?|kaise\s*ho)\b/i.test(q) ||
    /^(hi|hello|hey)\s+(mytee|studyhub|studymyte|bro|bhai|sir|bot|ai)$/i.test(q)
  ) {
    return {
      matched: true,
      text: getRandomItem(GREETING_RESPONSES),
      actions: standardActions
    };
  }

  // ----------------------------------------------------
  // BUILT-IN IDENTITY & INTRO ("who are you", "what can you do") - Saves Gemini API quota
  // ----------------------------------------------------
  if (
    /^(who\s+are\s+you|what\s+is\s+your\s+name|what\s+can\s+you\s+do|what\s+do\s+you\s+do|introduce\s+yourself|about\s+you|koun\s+ho|tum\s+koun\s+ho|kya\s+kar\s+sakte\s+ho|features|help\s+me)$/i.test(q) ||
    /(what\s+can\s+mytee\s+do|tell\s+me\s+about\s+yourself)/i.test(q)
  ) {
    return {
      matched: true,
      text: getRandomItem(IDENTITY_RESPONSES),
      actions: [
        { label: 'Browse Notes', path: '/notes' },
        { label: 'Browse PYQs', path: '/papers' },
        { label: 'Meet Founders', path: '/about' }
      ]
    };
  }

  // ----------------------------------------------------
  // BUILT-IN COURTESIES ("thank you", "great", "nice", etc.) - Saves Gemini API quota
  // ----------------------------------------------------
  if (
    /^(thank\s*you|thanks+|thx|thanku|dhanyawad|shukriya|nice|good\s*job|awesome|great|mast|bohot\s*badhiya|shabash|well\s*done|ok|okay|cool)$/i.test(q)
  ) {
    return {
      matched: true,
      text: getRandomItem(COURTESY_RESPONSES),
      actions: standardActions
    };
  }

  // ----------------------------------------------------
  // BUILT-IN STATUS CHECK ("how are you", "kya chal raha hai") - Saves Gemini API quota
  // ----------------------------------------------------
  if (
    /^(how\s+are\s+you|how\s+are\s+you\s+doing|how's\s+it\s+going|sab\s+badhiya|kya\s+chal\s+raha\s+hai|what's\s+up|sab\s+thik)$/i.test(q)
  ) {
    return {
      matched: true,
      text: getRandomItem(STATUS_RESPONSES),
      actions: standardActions
    };
  }

  // ----------------------------------------------------
  // HOW TO UPLOAD / CONTRIBUTE (2 Methods Guide) - Saves Gemini API quota
  // ----------------------------------------------------
  if (/(how\s+to\s+(upload|contribute|add)\s+(notes?|papers?|doc|documents?|pdf|file)|upload\s+(kaise\s+kare|steps|karna\s+hai)|contribute\s+(kaise|karna))/i.test(q)) {
    return {
      matched: true,
      text: `📚 **StudyMyte par Study Material Upload Karne Ke 2 Tareeqe Hain:**\n\n` +
        `### 1️⃣ Method 1: Screen ke Bottom-Left '+' Floating Button Se\n` +
        `• Aapki screen ke bottom-left corner par ek round blue **\`+\`** floating button dikhega.\n` +
        `• Use tap karein, ek modal open hoga jisme aap Document Title, Resource Category (Notes/Papers), Target Folder/Subject, aur Academic Year select karke apni PDF upload kar sakte hain.\n\n` +
        `### 2️⃣ Method 2: Direct Specific Subject Folder Ke Andar Se\n` +
        `• Website par pehle relevant section me jayein (jaise \`/notes\` ya \`/papers\`).\n` +
        `• Us subject ke folder ke andar jayein jahan aapko document dalna hai (e.g. *Subject Notes > First Year > Engineering Chemistry*).\n` +
        `• Folder ke andar top-right corner par **\`+ Contribute\`** button par click karein. Section aur Target Folder pehle se pre-selected aayenge—bas file attach karke submit karein!\n\n` +
        `Admin approve karte hi aapka document portal par live ho jaega! 🚀`,
      actions: [
        { label: 'Upload Document Now', path: '/my-contributions' },
        { label: 'Browse Notes Folders', path: '/notes' }
      ]
    };
  }

  // ----------------------------------------------------
  // 1. "HOW CAN I HACK SITE" / HACKING INQUIRIES (Typo-Tolerant)
  // ----------------------------------------------------
  if (
    /(how\s+(can\s+i|to)\s+(hack+k*|crack\w*|breach\w*)\s+(this\s+|your\s+|you\s+)?(site|website|studymyte|server|database|system|systems?))/i.test(q) ||
    /^(how\s+to\s+hack|hack\s+(this\s+)?(site|website|studymyte)|can\s+i\s+hack(\s+(this\s+)?(site|website|studymyte))?|teach\s+me\s+to\s+hack|hacker\s+mode)$/i.test(q) ||
    /(i\s+(want|would\s+like)\s+to\s+hack\s+(this\s+)?(site|studymyte|website))/i.test(q) ||
    /(hack\s+(this\s+)?(site|website|studymyte|systems?))/i.test(q)
  ) {
    return {
      matched: true,
      text: getRandomItem(HACK_RESPONSES),
      actions: [
        { label: 'Browse Notes', path: '/notes' },
        { label: 'Browse PYQs', path: '/papers' }
      ]
    };
  }

  // ----------------------------------------------------
  // 2. "I WANT ALL USER DATA" / DATABASE EXTRACTION
  // ----------------------------------------------------
  if (
    /(i\s+want\s+(all\s+)?(user\s+data|all\s+users|users?\s+database|database\s+dump|all\s+accounts|passwords|emails))/i.test(q) ||
    /(give\s+me\s+(all\s+)?(user\s+data|users?\s+data|database|user\s+list))/i.test(q) ||
    /^(show|export|download|dump)\s+(all\s+)?(user\s+data|users|database)$/i.test(q)
  ) {
    // If the authenticated user is genuinely an admin or superadmin
    if (userContext && (userContext.role === 'admin' || userContext.role === 'superadmin')) {
      return {
        matched: true,
        text: `### Administrative Access Verified 🫡\n\nUser analytics and system statistics are available in your **Admin Dashboard**. For data privacy compliance and security standards, bulk student credentials are encrypted and never exposed in chat.`,
        actions: [
          { label: 'Open Admin Dashboard', path: '/admin' }
        ]
      };
    }

    // For students, educators, and guests: deliver the funny shutdown
    return {
      matched: true,
      text: getRandomItem(USER_DATA_STUDENT_RESPONSES),
      actions: [
        { label: 'View My Profile', path: '/profile' },
        { label: 'Browse Notes', path: '/notes' }
      ]
    };
  }

  // ----------------------------------------------------
  // 3. "I AM ADMIN" / ADMIN BLUFFS
  // ----------------------------------------------------
  if (
    /^(i\s+am\s+(an?\s+)?admin(istrator)?|i'm\s+(the\s+)?admin|trust\s+me\s+i\s+am\s+admin|make\s+me\s+admin|give\s+me\s+admin\s+access)$/i.test(q) ||
    /(i\s+am\s+admin\s+give\s+me)/i.test(q)
  ) {
    // Genuine admin
    if (userContext && (userContext.role === 'admin' || userContext.role === 'superadmin')) {
      return {
        matched: true,
        text: `Welcome back, Admin! 🫡 Your credentials are verified. How can I assist you with platform metrics, user moderation, or resources today?`,
        actions: [
          { label: 'Open Admin Dashboard', path: '/admin' }
        ]
      };
    }

    // Student / Guest bluffing
    return {
      matched: true,
      text: getRandomItem(FAKE_ADMIN_RESPONSES),
      actions: [
        { label: 'Browse Notes', path: '/notes' },
        { label: 'Browse PYQs', path: '/papers' }
      ]
    };
  }

  // ----------------------------------------------------
  // 4. "I AM OWNER OF THIS SITE" / OWNER BLUFFS
  // ----------------------------------------------------
  if (
    /^(i\s+am\s+(the\s+)?owner(\s+of\s+this\s+site)?|i\s+own\s+(this\s+)?(site|studymyte|website)|this\s+is\s+my\s+(site|website)|i\s+created\s+this\s+site)$/i.test(q) ||
    /(i\s+am\s+owner\s+of\s+studymyte)/i.test(q)
  ) {
    // Check if the user is verified creator (e.g., Ankit or official creator email/username)
    const isVerifiedCreator = userContext && (
      (userContext.email && /ankit|gl200|admin@studymyte\.tech/i.test(userContext.email)) ||
      (userContext.name && /ankit/i.test(userContext.name))
    );

    if (isVerifiedCreator) {
      return {
        matched: true,
        text: `Salute to the creator! 🫡 Welcome back, founder. Everything on StudyMyte is running smoothly. What can I do for you today?`,
        actions: [
          { label: 'Open Admin Dashboard', path: '/admin' }
        ]
      };
    }

    // Student bluffing
    return {
      matched: true,
      text: getRandomItem(FAKE_OWNER_RESPONSES),
      actions: [
        { label: 'Meet the Real Creators', path: '/about' },
        { label: 'Browse Notes', path: '/notes' }
      ]
    };
  }

  // ----------------------------------------------------
  // 4.5. BTKIT INQUIRIES ("what do you think of btkit", "is btkit good", etc.)
  // ----------------------------------------------------
  if (
    /\bbtkit\b/i.test(q) && (
      /(good|bad|worth|best|review|think|thing|how\s+is|is\s+btkit|about\s+btkit|opinion|like|love|recommend|campus|culture|reputation)/i.test(q) ||
      /^(what\s+about\s+btkit|tell\s+me\s+about\s+btkit|is\s+btkit\s+good(\s+or\s+not)?)$/i.test(q) ||
      /(what\s+do\s+you\s+(think|thing)\s+(is\s+)?btkit)/i.test(q)
    ) && !/(notes?|papers?|pyqs?|syllabus|pdf)\b/i.test(q)
  ) {
    return {
      matched: true,
      text: getRandomItem(BTKIT_RESPONSES),
      actions: [
        { label: 'About StudyMyte & Founders', path: '/about' },
        { label: 'Browse Notes', path: '/notes' },
        { label: 'Browse PYQs', path: '/papers' }
      ]
    };
  }

  // ----------------------------------------------------
  // ACTIVE SPECIAL MODE GENERATORS (When user is in a special mode and asks banter)
  // ----------------------------------------------------
  if (currentMode === 'roast' && (q.includes('roast') || q.includes('again') || q.includes('more') || q === 'action:mode_roast')) {
    return {
      matched: true,
      text: `🔥 ${getRandomItem(ROAST_REPERTOIRE)}`,
      actions: [
        { label: 'One more roast', path: 'action:mode_roast' },
        { label: 'Okay I will study now', path: '/notes' },
        { label: 'Exit Roast Mode', path: 'action:mode_normal' }
      ]
    };
  }

  if (currentMode === 'sigma' && (q.includes('quote') || q.includes('rule') || q.includes('more') || q.includes('sigma'))) {
    return {
      matched: true,
      text: `🗿 ${getRandomItem(SIGMA_REPERTOIRE)}`,
      actions: [
        { label: 'Browse Notes', path: '/notes' },
        { label: 'Exit Sigma Mode', path: 'action:mode_normal' }
      ]
    };
  }

  if (currentMode === 'beast' && (q.includes('more') || q.includes('motivate') || q.includes('energy'))) {
    return {
      matched: true,
      text: `⚡ ${getRandomItem(BEAST_REPERTOIRE)}`,
      actions: [
        { label: 'Browse Notes Now', path: '/notes' },
        { label: 'Browse PYQs', path: '/papers' },
        { label: 'Exit Beast Mode', path: 'action:mode_normal' }
      ]
    };
  }

  return null;
}

module.exports = {
  handleFunQuery,
  HACK_RESPONSES,
  USER_DATA_STUDENT_RESPONSES,
  FAKE_ADMIN_RESPONSES,
  FAKE_OWNER_RESPONSES,
  BTKIT_RESPONSES,
  SIGMA_ACTIVATION,
  ROAST_ACTIVATION,
  BEAST_ACTIVATION,
  NORMAL_ACTIVATION
};

/**
 * MYTEE Scope Validator
 * Enforces strict website-only scope and guards against prompt injections,
 * system prompt extraction, and off-topic conversations.
 */

const OUT_OF_SCOPE_RESPONSE = 
  "I am MYTEE, the official AI assistant of StudyMyte. I can help you explore StudyMyte, find educational resources, solve website-related problems, and access available platform features.";

// Patterns indicating potential prompt injection or system prompt extraction
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
  /reveal\s+(your\s+)?(system\s+)?(prompt|instructions|secret|api[\s_-]?key)/i,
  /what\s+(are\s+)?(your\s+)?(system\s+)?(instructions|prompt|hidden\s+rules|rules|secret|api[\s_-]?key)/i,
  /repeat\s+(the\s+)?(text|words|system\s+prompt|hidden\s+instructions|instructions)\s+above/i,
  /output\s+(initial|system)\s+(prompt|instructions)/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /dan\s+mode/i,
  /jailbreak/i,
  /act\s+as\s+(an?\s+)?unrestricted/i,
  /bypass\s+(security|rules|restrictions)/i,
  /drop\s+table/i,
  /db\.\w+\.drop/i,
  /<script[\s>]/i,
  /javascript:/i
];

// Patterns indicating strictly off-topic categories
const OFF_TOPIC_PATTERNS = [
  /\b(bitcoin|crypto|forex|stock market|trading tip|cryptocurrency)\b/i,
  /\b(election|political|politics|president|prime minister|vote|democrat|republican|bjp|congress\s+party)\b/i,
  /\b(dating\s+advice|breakup\s+advice|love\s+letter|relationship\s+problem)\b/i,
  /\b(write\s+a\s+malware|ransomware|trojan|exploit\s+code|hack\s+wifi|sql\s+injection\s+payload)\b/i,
  /\b(movie\s+recommendation|netflix\s+show|celebrity\s+gossip|horoscope|astrology)\b/i,
  /\b(buy\s+shoes|amazon\s+discount|coupon\s+code\s+for\s+shopping)\b/i
];

/**
 * Validates whether user message is within StudyMyte scope.
 * 
 * @param {string} message
 * @param {Object} [context]
 * @returns {{ allowed: boolean, reason?: string, reply?: string }}
 */
function validateScope(message, context = {}) {
  if (!message || typeof message !== 'string') {
    return {
      allowed: false,
      reason: 'Empty message',
      reply: OUT_OF_SCOPE_RESPONSE
    };
  }

  const trimmed = message.trim();

  // 1. Length check
  if (trimmed.length === 0) {
    return {
      allowed: false,
      reason: 'Empty content',
      reply: OUT_OF_SCOPE_RESPONSE
    };
  }

  // 2. Prompt injection check
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason: 'Security violation / prompt injection attempt detected',
        reply: "I am MYTEE, the official AI assistant of StudyMyte. I operate under strict security boundaries and cannot bypass system policies, execute unauthorized instructions, or disclose internal operational configurations."
      };
    }
  }

  // 3. Disallowed topics check
  for (const pattern of OFF_TOPIC_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason: 'Out of scope category',
        reply: OUT_OF_SCOPE_RESPONSE
      };
    }
  }

  // All other educational, platform, and conversational questions are permitted
  return { allowed: true };
}

module.exports = {
  validateScope,
  OUT_OF_SCOPE_RESPONSE
};

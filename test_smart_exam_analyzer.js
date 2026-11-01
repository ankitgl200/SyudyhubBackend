const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeExamQuestions,
  normalizeSubject,
  EXAM_RECURRENCE_DATABASE
} = require('./services/mytee/smartExamAnalyzerService');
const { executeTool } = require('./services/mytee/myteeTools');
const { generateAiResponse, runLocalFallbackEngine } = require('./services/mytee/geminiService');

test('Smart Exam Analyzer: Subject Normalization', () => {
  assert.equal(normalizeSubject('os'), 'Operating Systems');
  assert.equal(normalizeSubject('dbms'), 'Database Management Systems');
  assert.equal(normalizeSubject('dsa'), 'Data Structures & Algorithms');
  assert.equal(normalizeSubject('cn'), 'Computer Networks');
  assert.equal(normalizeSubject('daa'), 'Design & Analysis of Algorithms');
  assert.equal(normalizeSubject('m1'), 'Engineering Mathematics-I');
  assert.equal(normalizeSubject('toc'), 'Theory of Computation / Automata');
});

test('Smart Exam Analyzer: Operating Systems 60-70%+ Analysis', async () => {
  const result = await analyzeExamQuestions({
    subject: 'Operating Systems',
    minFrequency: 60,
    includeAnswers: true
  });

  assert.equal(result.success, true);
  assert.equal(result.subject, 'Operating Systems');
  assert.ok(result.totalPapersAnalyzed >= 5, 'Should analyze at least 5 examination papers');
  assert.ok(result.questions.length >= 3, 'Should return multiple recurring questions');

  // Verify all returned questions have >=60% frequency
  result.questions.forEach(q => {
    assert.ok(q.repeatFrequencyPercent >= 60, `Question ${q.topic} must have >= 60% frequency`);
    assert.ok(q.yearsAppeared.length >= 2, 'Must appear in multiple exam years');
    assert.ok(q.modelAnswer && q.modelAnswer.length > 0, 'Must include model answers');
  });

  // Verify report text includes Tier 1 and Tier 2 sections
  assert.ok(result.text.includes('Smart PYQ Exam Analyzer'));
  assert.ok(result.text.includes('Tier 1: Super High-Yield Questions'));
  assert.ok(result.text.includes('Banker\'s Algorithm') || result.text.includes('Deadlock'));
});

test('Smart Exam Analyzer: DBMS 60-70%+ Analysis', async () => {
  const result = await analyzeExamQuestions({
    subject: 'dbms',
    minFrequency: 60,
    includeAnswers: true
  });

  assert.equal(result.success, true);
  assert.equal(result.subject, 'Database Management Systems');
  assert.ok(result.tier1Count > 0, 'Must have Tier 1 recurring questions');
  assert.ok(result.text.includes('Normalization') || result.text.includes('1NF'));
});

test('Smart Exam Analyzer: Execution via executeTool dispatcher', async () => {
  const result = await executeTool('analyze_exam_questions', {
    subject: 'Data Structures',
    minFrequency: 60
  });

  assert.equal(result.success, true);
  assert.equal(result.subject, 'Data Structures & Algorithms');
  assert.ok(result.questions.some(q => q.topic.includes('AVL') || q.topic.includes('BST')));
});

test('Smart Exam Analyzer: AI Fallback Engine triggers for exam query', async () => {
  const mockUser = { id: '66d000000000000000000001', name: 'Test Student', role: 'student' };
  const fallbackRes = await runLocalFallbackEngine(
    'What are the important questions for Operating Systems that repeat 60-70% in exams?',
    [],
    mockUser
  );

  assert.ok(fallbackRes.text, 'Should return text response');
  assert.ok(fallbackRes.toolsUsed.includes('analyze_exam_questions'), 'Tools used should record analyze_exam_questions');
  assert.ok(fallbackRes.text.includes('Smart PYQ Exam Analyzer'), 'Text should include Smart Exam Analyzer heading');
  assert.ok(fallbackRes.text.includes('Deadlock') || fallbackRes.text.includes('Scheduling'), 'Text should include high frequency exam topics');
});

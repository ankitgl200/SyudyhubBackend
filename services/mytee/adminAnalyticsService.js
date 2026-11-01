/**
 * Admin Analytics Service
 * Provides secure, pre-computed, role-gated platform analytics and administrative intelligence.
 * Does NOT execute arbitrary SQL/Mongo pipelines from users.
 */

const { User, Document, HelpRequest, MyteeUsageLog } = require('../../db/models');

/**
 * Validates that requesting user has verified administrative credentials.
 */
function verifyAdminPermissions(userContext) {
  if (!userContext || (userContext.role !== 'admin' && userContext.role !== 'superadmin')) {
    const err = new Error('Unauthorized: Administrative credentials required');
    err.status = 403;
    throw err;
  }
}

/**
 * Computes website overview statistics.
 */
async function getWebsiteOverview(userContext) {
  verifyAdminPermissions(userContext);

  const now = new Date();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  // Parallel aggregations for maximum performance
  const [
    totalUsers,
    newUsersToday,
    newUsersWeek,
    newUsersMonth,
    dau,
    wau,
    mau,
    totalDocuments,
    notesCount,
    papersCount,
    labManualsCount,
    booksCount,
    pendingDocsCount,
    totalTickets,
    pendingTickets,
    resolvedTickets
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: dayAgo } }),
    User.countDocuments({ createdAt: { $gte: weekAgo } }),
    User.countDocuments({ createdAt: { $gte: monthAgo } }),
    User.countDocuments({ lastActive: { $gte: dayAgo } }),
    User.countDocuments({ lastActive: { $gte: weekAgo } }),
    User.countDocuments({ lastActive: { $gte: monthAgo } }),
    Document.countDocuments(),
    Document.countDocuments({ type: 'notes' }),
    Document.countDocuments({ type: 'paper' }),
    Document.countDocuments({ type: { $in: ['lab_manual', 'simulation'] } }),
    Document.countDocuments({ type: 'book' }),
    Document.countDocuments({ status: 'pending' }),
    HelpRequest.countDocuments(),
    HelpRequest.countDocuments({ status: 'pending' }),
    HelpRequest.countDocuments({ status: 'resolved' })
  ]);

  return {
    users: {
      total: totalUsers,
      newToday: newUsersToday,
      newLast7Days: newUsersWeek,
      newLast30Days: newUsersMonth,
      active: {
        daily: dau,
        weekly: wau,
        monthly: mau
      }
    },
    resources: {
      total: totalDocuments,
      notes: notesCount,
      pyqs: papersCount,
      labManuals: labManualsCount,
      books: booksCount,
      pendingApproval: pendingDocsCount
    },
    support: {
      total: totalTickets,
      pending: pendingTickets,
      resolved: resolvedTickets
    },
    timestamp: now.toISOString()
  };
}

/**
 * Computes user activity and demographic summaries.
 */
async function getUserActivityAnalytics(userContext) {
  verifyAdminPermissions(userContext);

  const [roleBreakdown, approvalStats, topContributors] = await Promise.all([
    // Role distribution
    User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]),
    // Approval distribution
    User.aggregate([
      { $group: { _id: '$approved', count: { $sum: 1 } } }
    ]),
    // Top contributors by approved documents
    Document.aggregate([
      { $match: { status: 'approved', uploadedByUserId: { $ne: null } } },
      { $group: { _id: '$uploadedByUserId', docCount: { $sum: 1 }, uploaderName: { $first: '$uploadedBy' } } },
      { $sort: { docCount: -1 } },
      { $limit: 5 }
    ])
  ]);

  return {
    roles: roleBreakdown.reduce((acc, curr) => ({ ...acc, [curr._id || 'unknown']: curr.count }), {}),
    approvals: approvalStats.reduce((acc, curr) => ({ ...acc, [curr._id ? 'approved' : 'pending']: curr.count }), {}),
    topContributors: topContributors.map(c => ({
      userId: c._id,
      name: c.uploaderName || 'Anonymous',
      documentsCount: c.docCount
    }))
  };
}

/**
 * Computes AI system health and usage metrics.
 */
async function getAiUsageAnalytics(userContext) {
  verifyAdminPermissions(userContext);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalAiRequests,
    scopeRejections,
    successfulAiCalls,
    recentAiLogs
  ] = await Promise.all([
    MyteeUsageLog.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    MyteeUsageLog.countDocuments({ createdAt: { $gte: thirtyDaysAgo }, scopePassed: false }),
    MyteeUsageLog.countDocuments({ createdAt: { $gte: thirtyDaysAgo }, success: true }),
    MyteeUsageLog.find({ createdAt: { $gte: thirtyDaysAgo } })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('endpoint query role responseTimeMs estimatedTokens success scopePassed createdAt')
      .lean()
  ]);

  // Calculate average response time
  let avgResponseMs = 0;
  if (recentAiLogs.length > 0) {
    const sum = recentAiLogs.reduce((acc, l) => acc + (l.responseTimeMs || 0), 0);
    avgResponseMs = Math.round(sum / recentAiLogs.length);
  }

  return {
    summary: {
      totalRequestsLast30Days: totalAiRequests,
      scopeRejectionsLast30Days: scopeRejections,
      successfulRequests: successfulAiCalls,
      successRatePct: totalAiRequests > 0 ? Math.round((successfulAiCalls / totalAiRequests) * 100) : 100,
      averageResponseTimeMs: avgResponseMs
    },
    recentQueries: recentAiLogs.map(l => ({
      query: l.query ? (l.query.length > 60 ? l.query.slice(0, 57) + '...' : l.query) : 'N/A',
      role: l.role,
      responseTimeMs: l.responseTimeMs,
      scopePassed: l.scopePassed,
      success: l.success,
      timestamp: l.createdAt
    }))
  };
}

/**
 * Formulates a natural-language answer to an administrative question.
 */
async function generateAdminReport(question, userContext) {
  verifyAdminPermissions(userContext);

  const overview = await getWebsiteOverview(userContext);
  const q = (question || '').toLowerCase();

  // 1. New users query
  if (q.includes('how many users joined') || q.includes('new users') || q.includes('joined this week')) {
    return {
      type: 'user_growth',
      title: 'User Registration Report',
      metrics: {
        newToday: overview.users.newToday,
        newThisWeek: overview.users.newLast7Days,
        newThisMonth: overview.users.newLast30Days,
        totalRegistered: overview.users.total
      },
      summary: `In the last 7 days, **${overview.users.newLast7Days}** new users registered on StudyMyte. Today, **${overview.users.newToday}** users joined. Total registered user base is currently **${overview.users.total}**.`
    };
  }

  // 2. Unresolved tickets
  if (q.includes('ticket') || q.includes('support') || q.includes('unresolved')) {
    return {
      type: 'support_health',
      title: 'Support Tickets Health Report',
      metrics: {
        pending: overview.support.pending,
        resolved: overview.support.resolved,
        total: overview.support.total
      },
      summary: `There are currently **${overview.support.pending}** pending/unresolved support tickets out of **${overview.support.total}** total tickets (**${overview.support.resolved}** resolved).`
    };
  }

  // 3. Resource breakdown
  if (q.includes('resource') || q.includes('pyq') || q.includes('notes') || q.includes('upload')) {
    return {
      type: 'resource_summary',
      title: 'Academic Resources Breakdown',
      metrics: {
        total: overview.resources.total,
        notes: overview.resources.notes,
        pyqs: overview.resources.pyqs,
        labManuals: overview.resources.labManuals,
        books: overview.resources.books,
        pendingReview: overview.resources.pendingApproval
      },
      summary: `StudyMyte currently hosts **${overview.resources.total}** approved resources, comprising **${overview.resources.notes}** lecture notes, **${overview.resources.pyqs}** PYQs, **${overview.resources.labManuals}** lab manuals/simulations, and **${overview.resources.books}** textbooks. There are **${overview.resources.pendingApproval}** submissions waiting for review.`
    };
  }

  // 4. Default complete overview report
  const userStats = await getUserActivityAnalytics(userContext);
  const aiStats = await getAiUsageAnalytics(userContext);

  return {
    type: 'comprehensive_overview',
    title: 'StudyMyte Executive Platform Health Report',
    overview,
    userStats,
    aiStats,
    summary: `**Platform Summary**:
- **Users**: ${overview.users.total} registered (DAU: ${overview.users.active.daily}, WAU: ${overview.users.active.weekly}, MAU: ${overview.users.active.monthly})
- **Resources**: ${overview.resources.total} total (${overview.resources.notes} Notes, ${overview.resources.pyqs} PYQs, ${overview.resources.labManuals} Labs)
- **Support**: ${overview.support.pending} open tickets needing attention
- **AI Health**: ${aiStats.summary.totalRequestsLast30Days} requests in 30 days with ${aiStats.summary.successRatePct}% success rate`
  };
}

module.exports = {
  verifyAdminPermissions,
  getWebsiteOverview,
  getUserActivityAnalytics,
  getAiUsageAnalytics,
  generateAdminReport
};


import { normalizeOrderNo, isPendingSdmStage } from '../utils/normalize.js';
import { filterVisibleRows } from './permissions.js';
import { getReportCache } from './reportCache.js';
import {
  addComment,
  getComments,
  getCommentCounts,
  getLatestComments,
  getCommentById,
  updateComment,
  deleteComment,
} from './commentsDb.js';

export function visiblePendingSdmOrders(user, role, people) {
  const cache = getReportCache();
  const visible = filterVisibleRows(user, role, people, cache.rows);
  const pending = visible.filter((r) => r.status === 'underActivation' && isPendingSdmStage(r.stage));
  /** @type {Map<string, { orderNo: string, companyName: string, kamNameOriginal: string, personId: string|null }>} */
  const byOrder = new Map();
  for (const row of pending) {
    const orderNo = normalizeOrderNo(row.orderIdentifier);
    if (!orderNo) continue;
    if (!byOrder.has(orderNo)) {
      byOrder.set(orderNo, {
        orderNo,
        companyName: row.companyName || '',
        kamNameOriginal: row.kamNameOriginal || '',
        personId: row.personId || null,
      });
    }
  }
  return [...byOrder.values()];
}

export function assertOrderVisible(orderNo, visibleOrders) {
  const key = normalizeOrderNo(orderNo);
  const allowed = new Set(visibleOrders.map((o) => o.orderNo));
  if (!allowed.has(key)) {
    throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
  }
  return key;
}

export async function listPendingSdmWithComments(user, role, people, commentFilter = 'all') {
  const orders = visiblePendingSdmOrders(user, role, people);
  const orderNos = orders.map((o) => o.orderNo);
  const [counts, latest] = await Promise.all([
    getCommentCounts(orderNos),
    getLatestComments(orderNos),
  ]);

  let rows = orders.map((o) => {
    const c = counts[o.orderNo] || 0;
    const lat = latest[o.orderNo] || null;
    return {
      ...o,
      commentCount: c,
      latestComment: lat,
    };
  });

  if (commentFilter === 'has') rows = rows.filter((r) => r.commentCount > 0);
  if (commentFilter === 'none') rows = rows.filter((r) => r.commentCount === 0);

  rows.sort((a, b) => a.companyName.localeCompare(b.companyName));
  const withComments = orders.filter((o) => (counts[o.orderNo] || 0) > 0).length;

  return { rows, total: rows.length, ordersWithComments: withComments };
}

export async function fetchCommentsForOrder(orderNo, user, role, people) {
  const visible = visiblePendingSdmOrders(user, role, people);
  const key = assertOrderVisible(orderNo, visible);
  return getComments(key);
}

export async function postComment(orderNo, text, user, role, people) {
  const visible = visiblePendingSdmOrders(user, role, people);
  const key = assertOrderVisible(orderNo, visible);
  const person = people.find((p) => p.id === user.personId);
  const author = person?.displayName || user.username;
  return addComment(key, text, author, user.username);
}

export function canModifyComment(comment, user, role) {
  if (role === 'admin' || role === 'top') return true;
  return comment.author_username === user.username;
}

export async function patchComment(id, text, user, role, people) {
  const row = await getCommentById(id);
  if (!row) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  const visible = visiblePendingSdmOrders(user, role, people);
  assertOrderVisible(row.order_no, visible);
  if (!canModifyComment(row, user, role)) {
    throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
  }
  return updateComment(id, text, user.username);
}

export async function removeComment(id, user, role, people) {
  const row = await getCommentById(id);
  if (!row) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  const visible = visiblePendingSdmOrders(user, role, people);
  assertOrderVisible(row.order_no, visible);
  if (!canModifyComment(row, user, role)) {
    throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
  }
  return deleteComment(id, user.username);
}

export async function pendingSdmCommentStatsAfterUpload() {
  const cache = getReportCache();
  const allPendingSdm = cache.rows.filter(
    (r) => r.status === 'underActivation' && isPendingSdmStage(r.stage),
  );
  const orderNos = [...new Set(allPendingSdm.map((r) => normalizeOrderNo(r.orderIdentifier)).filter(Boolean))];
  const { countCommentsNotInOrderSet, countOrdersWithComments } = await import('./commentsDb.js');
  const withComments = await countOrdersWithComments(orderNos);
  const hidden = await countCommentsNotInOrderSet(orderNos);
  return {
    pendingSdmOrdersWithComments: withComments,
    hiddenCommentRows: hidden.comments,
    hiddenOrderCount: hidden.orders,
  };
}

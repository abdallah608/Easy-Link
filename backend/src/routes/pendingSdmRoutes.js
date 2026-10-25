import { Router } from 'express';
import { loadPeople } from '../services/store.js';
import { attachAuth, requireAuth, requirePasswordChanged } from '../middleware/auth.js';
import { validateOrigin } from '../middleware/csrf.js';
import {
  listPendingSdmWithComments,
  fetchCommentsForOrder,
  postComment,
  patchComment,
  removeComment,
  canModifyComment,
} from '../services/commentsService.js';

const router = Router();
router.use(attachAuth, requireAuth, requirePasswordChanged);

router.get('/pending-sdm', async (req, res) => {
  try {
    const people = await loadPeople();
    const data = await listPendingSdmWithComments(
      req.auth.user,
      req.auth.role,
      people,
      String(req.query.commentFilter || 'all'),
    );
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, code: 'COMMENTS_LOAD_FAILED', message: err.message });
  }
});

router.get('/pending-sdm/:orderNo/comments', async (req, res) => {
  try {
    const people = await loadPeople();
    const comments = await fetchCommentsForOrder(req.params.orderNo, req.auth.user, req.auth.role, people);
    const withFlags = comments.map((c) => ({
      ...c,
      canEdit: canModifyComment(c, req.auth.user, req.auth.role),
      canDelete: canModifyComment(c, req.auth.user, req.auth.role),
    }));
    return res.json({ ok: true, data: { comments: withFlags } });
  } catch (err) {
    const code = err.code || 'COMMENTS_LOAD_FAILED';
    const status = code === 'FORBIDDEN' ? 403 : 500;
    return res.status(status).json({ ok: false, code });
  }
});

router.post('/pending-sdm/:orderNo/comments', validateOrigin, async (req, res) => {
  try {
    const people = await loadPeople();
    const row = await postComment(
      req.params.orderNo,
      req.body?.text,
      req.auth.user,
      req.auth.role,
      people,
    );
    return res.json({ ok: true, data: row });
  } catch (err) {
    const code = err.code || 'COMMENT_SAVE_FAILED';
    const status = code === 'FORBIDDEN' ? 403 : code === 'COMMENT_EMPTY' || code === 'COMMENT_TOO_LONG' ? 400 : 500;
    return res.status(status).json({ ok: false, code });
  }
});

router.patch('/comments/:id', validateOrigin, async (req, res) => {
  try {
    const people = await loadPeople();
    const row = await patchComment(req.params.id, req.body?.text, req.auth.user, req.auth.role, people);
    return res.json({ ok: true, data: row });
  } catch (err) {
    const code = err.code || 'COMMENT_UPDATE_FAILED';
    const status = code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : 400;
    return res.status(status).json({ ok: false, code });
  }
});

router.delete('/comments/:id', validateOrigin, async (req, res) => {
  try {
    const people = await loadPeople();
    await removeComment(req.params.id, req.auth.user, req.auth.role, people);
    return res.json({ ok: true });
  } catch (err) {
    const code = err.code || 'COMMENT_DELETE_FAILED';
    const status = code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json({ ok: false, code });
  }
});

export default router;

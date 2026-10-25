import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '../api/client.js';
import { t } from '../i18n/index.js';
import { formatDateTime } from '../utils/format.js';

export default function OrderCommentsDialog({ open, order, lang, onClose, onChanged }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    if (!open || !order?.orderNo) return;
    setLoading(true);
    setError('');
    api(`/pending-sdm/${encodeURIComponent(order.orderNo)}/comments`)
      .then((res) => setComments(res.data.comments || []))
      .catch(() => setError(t(lang, 'commentsLoadFailed')))
      .finally(() => setLoading(false));
  }, [open, order?.orderNo, lang]);

  if (!open || !order) return null;

  async function saveNew() {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await api(`/pending-sdm/${encodeURIComponent(order.orderNo)}/comments`, {
        method: 'POST',
        body: { text },
      });
      setText('');
      const res = await api(`/pending-sdm/${encodeURIComponent(order.orderNo)}/comments`);
      setComments(res.data.comments || []);
      onChanged?.();
    } catch (err) {
      setError(t(lang, err.code) || t(lang, 'commentsSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id) {
    if (!editText.trim()) return;
    try {
      await api(`/comments/${id}`, { method: 'PATCH', body: { text: editText } });
      setEditId(null);
      const res = await api(`/pending-sdm/${encodeURIComponent(order.orderNo)}/comments`);
      setComments(res.data.comments || []);
      onChanged?.();
    } catch {
      setError(t(lang, 'commentsSaveFailed'));
    }
  }

  async function remove(id) {
    if (!window.confirm(t(lang, 'commentDeleteConfirm'))) return;
    try {
      await api(`/comments/${id}`, { method: 'DELETE' });
      const res = await api(`/pending-sdm/${encodeURIComponent(order.orderNo)}/comments`);
      setComments(res.data.comments || []);
      onChanged?.();
    } catch {
      setError(t(lang, 'commentsSaveFailed'));
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card order-comments-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>
              {t(lang, 'commentOrderTitle')} <span dir="ltr">{order.orderNo}</span>
            </h3>
            <p className="order-comments-sub">{order.companyName}</p>
          </div>
          <button type="button" className="btn ghost btn-sm" onClick={onClose}>
            {t(lang, 'close')}
          </button>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {loading ? <p className="filters-meta">{t(lang, 'loading')}</p> : null}

        <div className="order-comments-list">
          {!loading && !comments.length ? (
            <p className="empty-state">{t(lang, 'commentsEmpty')}</p>
          ) : null}
          {comments.map((c) => (
            <div key={c.id} className="order-comment-card">
              <div className="order-comment-head">
                <strong>{c.author}</strong>
                <span className="filters-meta">{formatDateTime(lang, c.created_at)}</span>
                {c.edited_at ? <span className="badge badge-muted">{t(lang, 'commentEdited')}</span> : null}
              </div>
              {editId === c.id ? (
                <>
                  <textarea
                    className="input"
                    maxLength={1000}
                    rows={3}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="order-comment-actions">
                    <button type="button" className="btn btn-sm" onClick={() => saveEdit(c.id)}>
                      {t(lang, 'save')}
                    </button>
                    <button type="button" className="btn ghost btn-sm" onClick={() => setEditId(null)}>
                      {t(lang, 'cancel')}
                    </button>
                  </div>
                </>
              ) : (
                <p className="order-comment-body">{c.comment}</p>
              )}
              {editId !== c.id && (c.canEdit || c.canDelete) ? (
                <div className="order-comment-actions">
                  {c.canEdit ? (
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      aria-label={t(lang, 'edit')}
                      onClick={() => {
                        setEditId(c.id);
                        setEditText(c.comment);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                  ) : null}
                  {c.canDelete ? (
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      aria-label={t(lang, 'delete')}
                      onClick={() => remove(c.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="order-comments-compose">
          <textarea
            className="input"
            rows={3}
            maxLength={1000}
            placeholder={t(lang, 'commentPlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="order-comments-compose-foot">
            <span className="filters-meta" dir="ltr">
              {text.length}/1000
            </span>
            <button type="button" className="btn" disabled={!text.trim() || saving} onClick={saveNew}>
              {t(lang, 'save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

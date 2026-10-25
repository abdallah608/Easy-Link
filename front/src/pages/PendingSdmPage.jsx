import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { api } from '../api/client.js';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { formatDateTime, formatNumber } from '../utils/format.js';
import OrderCommentsDialog from '../components/OrderCommentsDialog.jsx';
import { Skeleton } from '../components/Skeleton.jsx';

function truncate(s, max = 60) {
  const t = String(s || '');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export default function PendingSdmPage() {
  const { lang } = useApp();
  const [commentFilter, setCommentFilter] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOrder, setDialogOrder] = useState(null);
  const [pickOrder, setPickOrder] = useState('');

  function load() {
    setLoading(true);
    setError('');
    const q = new URLSearchParams({ commentFilter });
    api(`/pending-sdm?${q}`)
      .then((res) => setData(res.data))
      .catch(() => setError(t(lang, 'commentsLoadFailed')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [commentFilter, lang]);

  const rows = data?.rows || [];

  return (
    <>
      <div className="overview-header">
        <div>
          <h2 style={{ margin: 0 }}>{t(lang, 'pendingSdmPage')}</h2>
          <p className="filters-meta">{t(lang, 'pendingSdmHint')}</p>
        </div>
      </div>

      {data?.ordersWithComments > 0 ? (
        <div className="results-badge" style={{ alignSelf: 'flex-start' }}>
          {t(lang, 'pendingSdmWithCommentsChip', { n: formatNumber(lang, data.ordersWithComments) })}
        </div>
      ) : null}

      <div className="filters-row">
        <label className="filter-field">
          <span>{t(lang, 'commentFilterLabel')}</span>
          <select className="input" value={commentFilter} onChange={(e) => setCommentFilter(e.target.value)}>
            <option value="all">{t(lang, 'commentFilterAll')}</option>
            <option value="has">{t(lang, 'commentFilterHas')}</option>
            <option value="none">{t(lang, 'commentFilterNone')}</option>
          </select>
        </label>
      </div>

      {rows.length > 0 ? (
        <div className="pending-sdm-pick">
          <label className="filter-field filter-field-grow">
            <span>{t(lang, 'openOrderPick')}</span>
            <select className="input" value={pickOrder} onChange={(e) => setPickOrder(e.target.value)}>
              <option value="">—</option>
              {rows.map((r) => (
                <option key={r.orderNo} value={r.orderNo}>
                  {r.companyName} ({r.orderNo})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={!pickOrder}
            onClick={() => setDialogOrder(rows.find((r) => r.orderNo === pickOrder) || null)}
          >
            {t(lang, 'openComments')}
          </button>
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      {loading ? (
        <Skeleton height={200} />
      ) : (
        <div className="card table-wrap">
          <table className="data-table pending-sdm-table">
            <thead>
              <tr>
                <th>{t(lang, 'colOrder')}</th>
                <th>{t(lang, 'filterCompany')}</th>
                <th>{t(lang, 'colComments')}</th>
                <th>{t(lang, 'colLastComment')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.orderNo}
                  className="pending-sdm-row"
                  tabIndex={0}
                  onClick={() => setDialogOrder(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setDialogOrder(row);
                  }}
                >
                  <td dir="ltr">{row.orderNo}</td>
                  <td>{row.companyName || '—'}</td>
                  <td>
                    {row.commentCount > 0 ? (
                      <span className="comment-pill" dir="ltr">
                        <MessageSquare size={14} /> {formatNumber(lang, row.commentCount)}
                      </span>
                    ) : (
                      <span className="filters-meta">—</span>
                    )}
                  </td>
                  <td className="last-comment-cell">
                    {row.latestComment ? (
                      <>
                        <span className="last-comment-text">{truncate(row.latestComment.text)}</span>
                        <span className="filters-meta">{formatDateTime(lang, row.latestComment.created_at)}</span>
                      </>
                    ) : (
                      <span className="filters-meta">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="empty-state">{t(lang, 'empty')}</p> : null}
        </div>
      )}

      <OrderCommentsDialog
        open={!!dialogOrder}
        order={dialogOrder}
        lang={lang}
        onClose={() => setDialogOrder(null)}
        onChanged={load}
      />
    </>
  );
}

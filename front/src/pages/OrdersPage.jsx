import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownUp, Download } from 'lucide-react';
import { api } from '../api/client.js';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { defaultReportingMonth } from '../utils/monthDefaults.js';
import { telHref, whatsAppHref } from '../utils/phoneLinks.js';
import { formatCurrency, formatNumber } from '../utils/format.js';
import { Skeleton } from '../components/Skeleton.jsx';
import OrderFilterPanel from '../components/OrderFilterPanel.jsx';

const tabs = [
  { key: 'applied', labelKey: 'applied' },
  { key: 'underActivation', labelKey: 'underActivation' },
  { key: 'lost', labelKey: 'lost' },
];

export default function OrdersPage() {
  const { lang, metadata } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState({
    companies: [],
    statusTexts: [],
    stages: [],
    statusOptions: [],
    stageOptions: [],
    people: [],
  });
  const [companyQuery, setCompanyQuery] = useState('');

  const defaultMonth = useMemo(
    () => defaultReportingMonth(metadata?.reportingYear, metadata?.availableMonths || []),
    [metadata?.reportingYear, metadata?.availableMonths],
  );

  const status = searchParams.get('status') || 'applied';
  const monthFromUrl = searchParams.get('month');
  // Under Activation = open backlog: default to all months unless user picks one.
  const month =
    monthFromUrl ||
    (status === 'underActivation' ? 'all' : String(defaultMonth || 'all'));
  const company = searchParams.get('company') || '';
  const person = searchParams.get('person') || '';
  const search = searchParams.get('search') || '';
  const page = Number(searchParams.get('page') || '1');
  const sortBy = searchParams.get('sortBy') || 'companyName';
  const sortDir = searchParams.get('sortDir') || 'asc';
  const statusTexts = searchParams.get('statusTexts')?.split(',').filter(Boolean) || [];
  const stages = searchParams.get('stages')?.split(',').filter(Boolean) || [];

  function patchParams(patch) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === '' || v == null) next.delete(k);
      else next.set(k, String(v));
    });
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    // Applied / Lost: auto-select reporting month when none is set.
    // Under Activation: leave month unset so "all open" is shown.
    if (status === 'underActivation') return;
    if (!searchParams.get('month') && defaultMonth) {
      patchParams({ month: defaultMonth });
    }
  }, [defaultMonth, status]);

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({
      status,
      page: String(page),
      pageSize: '25',
      search,
      sortBy,
      sortDir,
      month,
    });
    if (company) q.set('company', company);
    if (person) q.set('person', person);
    if (statusTexts.length) q.set('statusTexts', statusTexts.join(','));
    if (stages.length) q.set('stages', stages.join(','));
    api(`/orders?${q}`)
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }, [status, search, page, month, company, person, sortBy, sortDir, statusTexts.join(','), stages.join(',')]);

  useEffect(() => {
    const q = new URLSearchParams({ status, month });
    api(`/orders/options?${q}`).then((res) => setOptions(res.data));
  }, [status, month]);

  const months = t(lang, 'months');
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filteredCompanies = options.companies.filter((c) =>
    c.toLowerCase().includes(companyQuery.toLowerCase()),
  );

  function toggleInList(key, value) {
    const current = searchParams.get(key)?.split(',').filter(Boolean) || [];
    const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
    patchParams({ [key]: next.join(','), page: 1 });
  }

  function toggleSort(col) {
    if (sortBy === col) patchParams({ sortDir: sortDir === 'asc' ? 'desc' : 'asc', page: 1 });
    else patchParams({ sortBy: col, sortDir: 'asc', page: 1 });
  }

  async function exportCsv() {
    const q = new URLSearchParams({ status, month, search, sortBy, sortDir });
    if (company) q.set('company', company);
    if (person) q.set('person', person);
    if (statusTexts.length) q.set('statusTexts', statusTexts.join(','));
    if (stages.length) q.set('stages', stages.join(','));
    const res = await fetch(`/api/orders/export?${q}`, { credentials: 'include' });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'orders-export.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function display(v) {
    return v === null || v === undefined || v === '' ? '—' : v;
  }

  function clearAllFilters() {
    setCompanyQuery('');
    setSearchParams(
      new URLSearchParams({
        status,
        month: status === 'underActivation' ? 'all' : String(defaultMonth || month),
      }),
      { replace: true },
    );
  }

  return (
    <>
      <div className="filters-bar orders-toolbar">
        <div className="orders-toolbar-top">
          <div className="tab-segment" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={status === tab.key}
                className={`tab-segment-btn ${status === tab.key ? 'active' : ''}`}
                onClick={() => {
                  const patch = { status: tab.key, page: 1, statusTexts: '', stages: '' };
                  if (tab.key === 'underActivation') patch.month = 'all';
                  else if (defaultMonth) patch.month = String(defaultMonth);
                  patchParams(patch);
                }}
              >
                {t(lang, tab.labelKey)}
              </button>
            ))}
          </div>
          <div className="orders-toolbar-actions">
            {data ? (
              <span className="results-badge" dir="ltr">
                {formatNumber(lang, data.total)} {t(lang, 'resultsShort')}
              </span>
            ) : null}
            <button type="button" className="btn ghost btn-sm" onClick={exportCsv}>
              <Download size={16} /> CSV
            </button>
          </div>
        </div>

        <div className="orders-toolbar-grid">
          <label className="filter-field">
            <span>{t(lang, 'filterMonth')}</span>
            {status === 'underActivation' ? (
              <span className="filters-meta">{t(lang, 'underActivationMonthHint')}</span>
            ) : null}
            <select className="input" value={month} onChange={(e) => patchParams({ month: e.target.value, page: 1 })}>
              <option value="all">{t(lang, 'filterAll')}</option>
              {(metadata?.availableMonths?.length ? metadata.availableMonths : [...Array(12)].map((_, i) => i + 1)).map(
                (m) => (
                  <option key={m} value={m}>
                    {months[m]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="filter-field">
            <span>{t(lang, 'filterCompany')}</span>
            <input
              className="input"
              list="company-list"
              value={companyQuery || company}
              onChange={(e) => {
                setCompanyQuery(e.target.value);
                patchParams({ company: e.target.value, page: 1 });
              }}
            />
            <datalist id="company-list">
              {filteredCompanies.slice(0, 100).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          {options.people?.length > 1 ? (
            <label className="filter-field">
              <span>{t(lang, 'filterEmployee')}</span>
              <select className="input" value={person} onChange={(e) => patchParams({ person: e.target.value, page: 1 })}>
                <option value="">{t(lang, 'filterAll')}</option>
                {options.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="filter-field filter-field-grow">
            <span>{t(lang, 'search')}</span>
            <input
              className="input"
              placeholder={t(lang, 'searchOrdersHint')}
              value={search}
              onChange={(e) => patchParams({ search: e.target.value, page: 1 })}
            />
          </label>
          <button className="btn ghost btn-sm" type="button" onClick={clearAllFilters}>
            {t(lang, 'clearFilters')}
          </button>
        </div>

        <OrderFilterPanel
          lang={lang}
          sheetStatus={status}
          options={options}
          selectedStatuses={statusTexts}
          selectedStages={stages}
          onToggleStatus={(v) => toggleInList('statusTexts', v)}
          onToggleStage={(v) => toggleInList('stages', v)}
          onClear={() => patchParams({ statusTexts: '', stages: '', page: 1 })}
        />
      </div>

      <div className="card table-wrap">
        {loading ? (
          <Skeleton height={240} />
        ) : !data || data.items.length === 0 ? (
          <p className="empty-state">{t(lang, 'empty')}</p>
        ) : (
          <table className="data-table sortable">
            <thead>
              <tr>
                {[
                  ['companyName', t(lang, 'colCompany')],
                  ['orderIdentifier', t(lang, 'colOrder')],
                  [null, t(lang, 'colAuthorizedName')],
                  [null, t(lang, 'colAuthorizedMobile')],
                  [null, 'KAM'],
                  [null, 'MSISDN'],
                  ['revenue', t(lang, 'appliedRevenue')],
                  ['statusText', t(lang, 'filterStatus')],
                  ['stage', t(lang, 'filterStage')],
                  ['month', t(lang, 'filterMonth')],
                ].map(([key, label]) => (
                  <th key={label}>
                    {key ? (
                      <button type="button" className="th-sort" onClick={() => toggleSort(key)}>
                        {label} {sortBy === key ? <ArrowDownUp size={14} /> : null}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => {
                const tel = telHref(row.authorizedMobile);
                const wa = whatsAppHref(row.authorizedMobile);
                return (
                  <tr key={row.id}>
                    <td>{display(row.companyName)}</td>
                    <td>{display(row.orderIdentifier)}</td>
                    <td>{display(row.authorizedName)}</td>
                    <td>
                      {row.authorizedMobile ? (
                        <span className="phone-links">
                          <a href={tel}>{display(row.authorizedMobile)}</a>
                          {wa ? (
                            <a href={wa} target="_blank" rel="noreferrer" className="wa-link">
                              WA
                            </a>
                          ) : null}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{display(row.kamName)}</td>
                    <td>{display(row.msisdn)}</td>
                    <td>{formatCurrency(lang, row.revenue, metadata)}</td>
                    <td>{display(row.statusText)}</td>
                    <td>{display(row.stage)}</td>
                    <td>{row.month ? months[row.month] : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {data ? (
        <div className="pagination-bar">
          <button className="btn ghost" type="button" disabled={page <= 1} onClick={() => patchParams({ page: page - 1 })}>
            {t(lang, 'prev')}
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            className="btn ghost"
            type="button"
            disabled={page * data.pageSize >= data.total}
            onClick={() => patchParams({ page: page + 1 })}
          >
            {t(lang, 'next')}
          </button>
        </div>
      ) : null}
    </>
  );
}

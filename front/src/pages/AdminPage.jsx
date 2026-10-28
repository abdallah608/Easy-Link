import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { Tabs } from '../components/ui/Tabs.jsx';
import TempPasswordModal from '../components/TempPasswordModal.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { defaultReportingMonth } from '../utils/monthDefaults.js';

export default function AdminPage() {
  const { lang, refreshMe, metadata } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('users');
  const [peopleData, setPeopleData] = useState(null);
  const [config, setConfig] = useState(null);
  const [uploadHistory, setUploadHistory] = useState(null);
  const [targets, setTargets] = useState([]);
  const [tempPassword, setTempPassword] = useState(null);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [uploadProgress, setUploadProgress] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const targetMonth = useMemo(
    () => defaultReportingMonth(metadata?.reportingYear, metadata?.availableMonths || []),
    [metadata],
  );
  const [targetForm, setTargetForm] = useState({ personId: '', month: targetMonth, revenueTarget: '', ordersTarget: '' });
  const [createUserForm, setCreateUserForm] = useState({
    displayName: '',
    username: '',
    role: 'employee',
    group: 'independent',
    managerId: '',
    activate: true,
  });
  const [creatingUser, setCreatingUser] = useState(false);

  async function loadAll() {
    const [p, c, h, tg] = await Promise.all([
      api('/admin/people'),
      api('/admin/config'),
      api('/admin/upload-history'),
      api(`/admin/targets?year=${metadata?.reportingYear || 2026}&month=${targetMonth}`),
    ]);
    setPeopleData(p.data);
    setConfig(c.data);
    setUploadHistory(h.data);
    setTargets(tg.data);
  }

  useEffect(() => {
    loadAll().catch(() => toast.push(t(lang, 'loadFailed'), 'error'));
  }, [targetMonth]);

  useEffect(() => {
    if (targetForm.month !== targetMonth) {
      setTargetForm((f) => ({ ...f, month: targetMonth }));
    }
  }, [targetMonth]);

  const filteredPeople = useMemo(() => {
    if (!peopleData) return [];
    return peopleData.people.filter((p) => {
      const user = peopleData.users.find((u) => u.personId === p.id);
      const role = user?.role || p.orgRole;
      if (roleFilter !== 'all' && role !== roleFilter) return false;
      if (!userSearch) return true;
      const q = userSearch.toLowerCase();
      return p.displayName.toLowerCase().includes(q) || (user?.username || '').toLowerCase().includes(q);
    });
  }, [peopleData, userSearch, roleFilter]);

  async function runUpload(file) {
    if (!file) return;
    if (!window.confirm(t(lang, 'uploadConfirmReplace'))) return;
    setUploadProgress(`${file.name} (${Math.round(file.size / 1024)} KB)`);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api('/admin/upload', { method: 'POST', formData: fd });
      toast.push(t(lang, 'uploadSuccess'), 'success');
      const lines = [JSON.stringify(res.data, null, 2)];
      if (res.data?.commentStats) {
        lines.push(
          t(lang, 'uploadCommentStats', {
            orders: res.data.commentStats.pendingSdmOrdersWithComments,
            hidden: res.data.commentStats.hiddenCommentRows,
          }),
        );
      }
      setUploadProgress(lines.join('\n\n'));
      await refreshMe();
      await loadAll();
    } catch (err) {
      toast.push(err.code || 'UPLOAD_FAILED', 'error');
      setUploadProgress('');
    }
  }

  async function activatePerson(personId) {
    const res = await api(`/admin/people/${personId}/activate`, { method: 'POST' });
    setTempPassword(res.data.tempPassword);
    await loadAll();
  }

  async function resetPassword(userId) {
    const res = await api(`/admin/people/${userId}/reset-password`, { method: 'POST' });
    setTempPassword(res.data.tempPassword);
    await loadAll();
  }

  async function createUser(e) {
    e.preventDefault();
    if (!createUserForm.displayName.trim() || !createUserForm.username.trim()) return;
    setCreatingUser(true);
    try {
      const body = {
        displayName: createUserForm.displayName.trim(),
        username: createUserForm.username.trim(),
        role: createUserForm.role,
        group: createUserForm.group,
        activate: createUserForm.activate,
      };
      if (createUserForm.managerId) body.managerId = createUserForm.managerId;
      const res = await api('/admin/users', { method: 'POST', body });
      if (res.data.tempPassword) setTempPassword(res.data.tempPassword);
      toast.push(t(lang, 'userCreated'), 'success');
      setCreateUserForm({
        displayName: '',
        username: '',
        role: 'employee',
        group: 'independent',
        managerId: '',
        activate: true,
      });
      await loadAll();
    } catch (err) {
      toast.push(t(lang, err.code) || t(lang, 'userCreateFailed'), 'error');
    } finally {
      setCreatingUser(false);
    }
  }

  const managerOptions = useMemo(() => {
    if (!peopleData) return [];
    return peopleData.people.filter((p) => {
      const u = peopleData.users.find((x) => x.personId === p.id);
      const r = u?.role || p.orgRole;
      return r === 'manager' || r === 'top' || r === 'admin';
    });
  }, [peopleData]);

  async function saveConfig() {
    try {
      await api('/admin/config', { method: 'PUT', body: config });
      toast.push(t(lang, 'saved'), 'success');
      await refreshMe();
    } catch (err) {
      toast.push(err.code || 'SAVE_FAILED', 'error');
    }
  }

  async function saveTarget() {
    if (!targetForm.personId) return;
    await api('/admin/targets', {
      method: 'POST',
      body: {
        personId: targetForm.personId,
        year: metadata?.reportingYear || 2026,
        month: Number(targetForm.month),
        revenueTarget: targetForm.revenueTarget === '' ? null : Number(targetForm.revenueTarget),
        ordersTarget: targetForm.ordersTarget === '' ? null : Number(targetForm.ordersTarget),
      },
    });
    toast.push(t(lang, 'saved'), 'success');
    await loadAll();
  }

  async function copyTargetsFromLastMonth() {
    const prev = Number(targetForm.month) - 1;
    if (prev < 1) return;
    const prevTargets = await api(`/admin/targets?year=${metadata?.reportingYear || 2026}&month=${prev}`);
    for (const row of prevTargets.data) {
      await api('/admin/targets', {
        method: 'POST',
        body: {
          personId: row.personId,
          year: row.year,
          month: Number(targetForm.month),
          revenueTarget: row.revenueTarget,
          ordersTarget: row.ordersTarget,
        },
      });
    }
    toast.push(t(lang, 'targetsCopied'), 'success');
    await loadAll();
  }

  if (!peopleData || !config) return <div>{t(lang, 'loading')}</div>;

  const tabs = [
    { id: 'users', label: t(lang, 'adminTabUsers') },
    { id: 'upload', label: t(lang, 'adminTabUpload') },
    { id: 'targets', label: t(lang, 'adminTabTargets') },
    { id: 'settings', label: t(lang, 'adminTabSettings') },
  ];

  return (
    <>
      <h2 style={{ marginTop: 0 }}>{t(lang, 'admin')}</h2>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'users' ? (
        <>
        <div className="card admin-create-user">
          <h3 style={{ marginTop: 0 }}>{t(lang, 'createUser')}</h3>
          <p className="filters-meta">{t(lang, 'createUserHint')}</p>
          <form className="admin-create-user-form" onSubmit={createUser}>
            <label className="filter-field">
              <span>{t(lang, 'colName')}</span>
              <input
                className="input"
                required
                value={createUserForm.displayName}
                onChange={(e) => setCreateUserForm((f) => ({ ...f, displayName: e.target.value }))}
              />
            </label>
            <label className="filter-field">
              <span>{t(lang, 'username')}</span>
              <input
                className="input"
                required
                autoComplete="off"
                dir="ltr"
                value={createUserForm.username}
                onChange={(e) => setCreateUserForm((f) => ({ ...f, username: e.target.value }))}
              />
            </label>
            <label className="filter-field">
              <span>{t(lang, 'role')}</span>
              <select
                className="input"
                value={createUserForm.role}
                onChange={(e) => setCreateUserForm((f) => ({ ...f, role: e.target.value }))}
              >
                {['employee', 'manager', 'ict', 'top', 'admin'].map((r) => (
                  <option key={r} value={r}>
                    {t(lang, `roles.${r}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>{t(lang, 'userGroup')}</span>
              <select
                className="input"
                value={createUserForm.group}
                onChange={(e) => setCreateUserForm((f) => ({ ...f, group: e.target.value }))}
              >
                <option value="independent">{t(lang, 'groupIndependent')}</option>
                <option value="outsource">{t(lang, 'groupOutsource')}</option>
                <option value="ict">{t(lang, 'groupIct')}</option>
              </select>
            </label>
            <label className="filter-field">
              <span>{t(lang, 'manager')}</span>
              <select
                className="input"
                value={createUserForm.managerId}
                onChange={(e) => setCreateUserForm((f) => ({ ...f, managerId: e.target.value }))}
              >
                <option value="">—</option>
                {managerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field admin-create-user-check">
              <input
                type="checkbox"
                checked={createUserForm.activate}
                onChange={(e) => setCreateUserForm((f) => ({ ...f, activate: e.target.checked }))}
              />
              <span>{t(lang, 'createUserActivate')}</span>
            </label>
            <button type="submit" className="btn" disabled={creatingUser}>
              {t(lang, 'createUserSubmit')}
            </button>
          </form>
        </div>
        <div className="card table-wrap">
          <div className="filters-row">
            <input
              className="input"
              placeholder={t(lang, 'search')}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
            />
            <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="all">{t(lang, 'filterAll')}</option>
              {['employee', 'manager', 'ict', 'top', 'admin'].map((r) => (
                <option key={r} value={r}>
                  {t(lang, `roles.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t(lang, 'colName')}</th>
                <th>{t(lang, 'filterStatus')}</th>
                <th>{t(lang, 'role')}</th>
                <th>{t(lang, 'actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredPeople.map((p) => {
                const user = peopleData.users.find((u) => u.personId === p.id);
                const role = user?.role || p.orgRole;
                return (
                  <tr key={p.id}>
                    <td>{p.displayName}</td>
                    <td>
                      <span className={`badge ${user?.active ? 'badge-success' : 'badge-muted'}`}>
                        {user?.active ? t(lang, 'active') : t(lang, 'inactive')}
                      </span>
                    </td>
                    <td>
                      {user ? (
                        <select
                          className="input"
                          value={role}
                          onChange={(e) =>
                            api(`/admin/users/${user.id}`, { method: 'PUT', body: { role: e.target.value } }).then(loadAll)
                          }
                        >
                          {['employee', 'manager', 'ict', 'top', 'admin'].map((r) => (
                            <option key={r} value={r}>
                              {t(lang, `roles.${r}`)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="badge badge-role">{t(lang, `roles.${role}`)}</span>
                      )}
                    </td>
                    <td className="actions-cell">
                      {!user?.active ? (
                        <button type="button" className="btn" onClick={() => activatePerson(p.id)}>
                          {t(lang, 'activate')}
                        </button>
                      ) : (
                        <>
                          <button type="button" className="btn ghost" onClick={() => resetPassword(user.id)}>
                            {t(lang, 'resetPassword')}
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => api(`/admin/people/${user.id}/deactivate`, { method: 'POST' }).then(loadAll)}
                          >
                            {t(lang, 'deactivate')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      ) : null}

      {tab === 'upload' ? (
        <div className="card">
          <div
            className={`dropzone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              runUpload(e.dataTransfer.files?.[0]);
            }}
          >
            <p>{t(lang, 'dropzoneHint')}</p>
            <input type="file" accept=".xlsx" onChange={(e) => runUpload(e.target.files?.[0])} />
          </div>
          {uploadHistory?.current ? (
            <div className="upload-summary">
              <strong>{t(lang, 'currentReport')}</strong>
              <div>{uploadHistory.current.reportNumber || '—'}</div>
              <div>{uploadHistory.current.fileName}</div>
              <div>{uploadHistory.current.lastUploadAt}</div>
            </div>
          ) : null}
          {uploadProgress ? <pre className="upload-log">{uploadProgress}</pre> : null}
          {uploadHistory?.history?.length ? (
            <div className="table-wrap">
              <h4>{t(lang, 'uploadHistory')}</h4>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t(lang, 'reportId')}</th>
                    <th>{t(lang, 'file')}</th>
                    <th>{t(lang, 'date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadHistory.history.slice(0, 10).map((h) => (
                    <tr key={h.at}>
                      <td>{h.reportNumber}</td>
                      <td>{h.fileName}</td>
                      <td>{h.at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'targets' ? (
        <div className="card">
          <div className="filters-row">
            <select
              className="input"
              value={targetForm.personId}
              onChange={(e) => setTargetForm({ ...targetForm, personId: e.target.value })}
            >
              <option value="">{t(lang, 'selectPerson')}</option>
              {peopleData.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <input
              className="input"
              type="number"
              min={1}
              max={12}
              value={targetForm.month}
              onChange={(e) => setTargetForm({ ...targetForm, month: Number(e.target.value) })}
            />
            <input
              className="input"
              placeholder={t(lang, 'revenueTarget')}
              value={targetForm.revenueTarget}
              onChange={(e) => setTargetForm({ ...targetForm, revenueTarget: e.target.value })}
            />
            <input
              className="input"
              placeholder={t(lang, 'ordersTarget')}
              value={targetForm.ordersTarget}
              onChange={(e) => setTargetForm({ ...targetForm, ordersTarget: e.target.value })}
            />
            <button type="button" className="btn" onClick={saveTarget}>
              {t(lang, 'save')}
            </button>
            <button type="button" className="btn ghost" onClick={copyTargetsFromLastMonth}>
              {t(lang, 'copyFromPrevMonth')}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t(lang, 'colName')}</th>
                <th>{t(lang, 'revenueTarget')}</th>
                <th>{t(lang, 'ordersTarget')}</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((row) => {
                const person = peopleData.people.find((p) => p.id === row.personId);
                return (
                  <tr key={`${row.personId}-${row.month}`}>
                    <td>{person?.displayName || row.personId}</td>
                    <td>{row.revenueTarget ?? '—'}</td>
                    <td>{row.ordersTarget ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'settings' ? (
        <div className="card form-stack">
          <label>
            {t(lang, 'reportingYear')}
            <span className="help-text">{t(lang, 'reportingYearHelp')}</span>
            <input
              className="input"
              type="number"
              value={config.reportingYear}
              onChange={(e) => setConfig({ ...config, reportingYear: Number(e.target.value) })}
            />
          </label>
          <label>
            {t(lang, 'appNameLabel')}
            <input
              className="input"
              value={config.applicationName}
              onChange={(e) => setConfig({ ...config, applicationName: e.target.value })}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={!!config.leaderboardShowRevenue}
              onChange={(e) => setConfig({ ...config, leaderboardShowRevenue: e.target.checked })}
            />
            <span>{t(lang, 'leaderboardRevenueToggle')}</span>
          </label>
          <button type="button" className="btn" onClick={saveConfig}>
            {t(lang, 'save')}
          </button>
        </div>
      ) : null}

      <TempPasswordModal
        open={!!tempPassword}
        password={tempPassword}
        lang={lang}
        onClose={() => setTempPassword(null)}
      />
    </>
  );
}

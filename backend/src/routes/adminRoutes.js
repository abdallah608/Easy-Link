import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { attachAuth, requireAuth, requirePasswordChanged, requireRoles } from '../middleware/auth.js';
import { validateOrigin } from '../middleware/csrf.js';
import { paths, serverConfig } from '../config.js';
import {
  loadPeople,
  savePeople,
  loadUsers,
  saveUsers,
  loadConfig,
  saveConfig,
} from '../services/store.js';
import { ensureDir } from '../utils/atomicWrite.js';
import { commitWorkbookReplacement, getReportCache, refreshIdentityOnPeopleChange } from '../services/reportCache.js';
import { buildAliasMap, resolveKamPersonId } from '../services/identity.js';
import { activateUserAccount, countActiveAdmins } from '../services/authService.js';
import { wouldCreateCycle } from '../services/permissions.js';
import { normalizeKey } from '../utils/normalize.js';
import { hashPassword } from '../utils/passwords.js';
import {
  loadTargets,
  upsertTarget,
  bulkUpsertTarget,
  deleteTarget,
} from '../services/targetsService.js';
import { rebuildCacheFromDisk } from '../services/reportCache.js';
import { loadMetadata } from '../services/store.js';

const router = Router();
router.use(attachAuth, requireAuth, requirePasswordChanged, requireRoles('admin'));

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await ensureDir(paths.uploadsTmp);
        cb(null, paths.uploadsTmp);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, _file, cb) => {
      cb(null, `upload-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.xlsx`);
    },
  }),
  limits: { fileSize: serverConfig.maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx') return cb(new Error('INVALID_FILE_TYPE'));
    cb(null, true);
  },
});

router.post('/upload', validateOrigin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, code: 'FILE_REQUIRED' });
  try {
    const result = await commitWorkbookReplacement(req.file.path, {
      originalFileName: req.file.originalname,
    });
    return res.json({ ok: true, data: result });
  } catch (err) {
    try {
      await fs.unlink(req.file.path);
    } catch {
      /* ignore */
    }
    return res.status(400).json({ ok: false, code: err.code || 'IMPORT_FAILED', message: err.message });
  }
});

router.get('/people', async (_req, res) => {
  const people = await loadPeople();
  const users = await loadUsers();
  return res.json({ ok: true, data: { people, users: users.map(safeUser) } });
});

router.post('/people', validateOrigin, async (req, res) => {
  const people = await loadPeople();
  const body = req.body || {};
  const id = body.id || `p-${crypto.randomBytes(4).toString('hex')}`;
  if (people.some((p) => p.id === id)) return res.status(400).json({ ok: false, code: 'DUPLICATE_ID' });
  const managerId = body.managerId || null;
  if (managerId && wouldCreateCycle(people, id, managerId)) {
    return res.status(400).json({ ok: false, code: 'MANAGER_CYCLE' });
  }
  const person = {
    id,
    displayName: body.displayName,
    username: body.username || id.replace(/^p-/, ''),
    aliases: (body.aliases || [body.displayName]).map((a) => normalizeKey(a)),
    managerId,
    group: body.group || 'independent',
    orgRole: body.orgRole || 'employee',
  };
  people.push(person);
  await savePeople(people);
  const config = await loadConfig();
  refreshIdentityOnPeopleChange(people, config);
  return res.json({ ok: true, data: person });
});

router.put('/people/:id', validateOrigin, async (req, res) => {
  const people = await loadPeople();
  const idx = people.findIndex((p) => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ ok: false, code: 'NOT_FOUND' });
  const body = req.body || {};
  const managerId = body.managerId !== undefined ? body.managerId : people[idx].managerId;
  if (managerId && wouldCreateCycle(people, req.params.id, managerId)) {
    return res.status(400).json({ ok: false, code: 'MANAGER_CYCLE' });
  }
  people[idx] = {
    ...people[idx],
    displayName: body.displayName ?? people[idx].displayName,
    username: body.username ?? people[idx].username,
    aliases: body.aliases ? body.aliases.map((a) => normalizeKey(a)) : people[idx].aliases,
    managerId,
    group: body.group ?? people[idx].group,
    orgRole: body.orgRole ?? people[idx].orgRole,
  };
  await savePeople(people);
  const config = await loadConfig();
  refreshIdentityOnPeopleChange(people, config);
  return res.json({ ok: true, data: people[idx] });
});

router.delete('/people/:id', validateOrigin, async (req, res) => {
  const people = await loadPeople();
  const users = await loadUsers();
  if (people.some((p) => p.managerId === req.params.id)) {
    return res.status(400).json({ ok: false, code: 'HAS_TEAM_MEMBERS' });
  }
  const filtered = people.filter((p) => p.id !== req.params.id);
  if (filtered.length === people.length) return res.status(404).json({ ok: false, code: 'NOT_FOUND' });
  await savePeople(filtered);
  const newUsers = users.filter((u) => u.personId !== req.params.id);
  await saveUsers(newUsers);
  return res.json({ ok: true });
});

router.post('/people/:id/activate', validateOrigin, async (req, res) => {
  const users = await loadUsers();
  let user = users.find((u) => u.personId === req.params.id || u.id === req.params.id);
  if (!user) {
    const people = await loadPeople();
    const person = people.find((p) => p.id === req.params.id);
    if (!person) return res.status(404).json({ ok: false, code: 'NOT_FOUND' });
    user = {
      id: `u-${crypto.randomBytes(4).toString('hex')}`,
      username: person.username,
      personId: person.id,
      role:
        person.orgRole === 'manager'
          ? 'manager'
          : person.orgRole === 'ict'
            ? 'ict'
            : person.orgRole === 'top'
              ? 'top'
              : 'employee',
      active: false,
      tokenVersion: 0,
      mustChangePassword: false,
      passwordHash: await hashPassword(crypto.randomBytes(16).toString('hex')),
    };
    users.push(user);
    await saveUsers(users);
  }
  const result = await activateUserAccount(user.id, req.auth.user.id);
  if (result.error) return res.status(400).json({ ok: false, code: result.error });
  return res.json({ ok: true, data: { user: safeUser(result.user), tempPassword: result.tempPassword } });
});

router.post('/people/:id/deactivate', validateOrigin, async (req, res) => {
  const users = await loadUsers();
  const idx = users.findIndex((u) => u.id === req.params.id || u.personId === req.params.id);
  if (idx < 0) return res.status(404).json({ ok: false, code: 'NOT_FOUND' });
  if (users[idx].role === 'admin' && users[idx].active) {
    if (countActiveAdmins(users) <= 1) return res.status(400).json({ ok: false, code: 'LAST_ADMIN' });
  }
  users[idx] = { ...users[idx], active: false, tokenVersion: (users[idx].tokenVersion || 0) + 1 };
  await saveUsers(users);
  return res.json({ ok: true, data: safeUser(users[idx]) });
});

router.post('/people/:id/reset-password', validateOrigin, async (req, res) => {
  const users = await loadUsers();
  const user = users.find((u) => u.id === req.params.id || u.personId === req.params.id);
  if (!user) return res.status(404).json({ ok: false, code: 'NOT_FOUND' });
  const result = await activateUserAccount(user.id, req.auth.user.id);
  return res.json({ ok: true, data: { user: safeUser(result.user), tempPassword: result.tempPassword } });
});

router.get('/unassigned-names', async (_req, res) => {
  const cache = getReportCache();
  const people = await loadPeople();
  const config = await loadConfig();
  const aliasMap = buildAliasMap(people, config.kamAliases);
  const suggestions = cache.unassignedNames.map((name) => {
    const key = normalizeKey(name);
    const suggested = people
      .map((p) => ({
        personId: p.id,
        displayName: p.displayName,
        score: similarity(key, normalizeKey(p.displayName)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return { name, suggested, mappedPersonId: resolveKamPersonId(name, aliasMap) };
  });
  return res.json({ ok: true, data: suggestions });
});

router.get('/upload-history', async (_req, res) => {
  const meta = await loadMetadata();
  return res.json({
    ok: true,
    data: {
      current: {
        reportNumber: meta.reportNumber,
        reportStatus: meta.reportStatus,
        lastUploadAt: meta.lastUploadAt,
        fileName: meta.fileName,
        rowCounts: meta.rowCounts,
      },
      history: meta.uploadHistory || [],
    },
  });
});

router.post('/rebuild-cache', validateOrigin, async (_req, res) => {
  await rebuildCacheFromDisk();
  return res.json({ ok: true });
});

router.get('/targets', async (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  let targets = await loadTargets();
  if (year) targets = targets.filter((t) => t.year === year);
  if (month) targets = targets.filter((t) => t.month === month);
  return res.json({ ok: true, data: targets });
});

router.post('/targets', validateOrigin, async (req, res) => {
  const body = req.body || {};
  if (Array.isArray(body.items)) {
    await bulkUpsertTarget(body.items);
    return res.json({ ok: true, data: await loadTargets() });
  }
  const row = await upsertTarget(body);
  return res.json({ ok: true, data: row });
});

router.delete('/targets/:personId/:year/:month', validateOrigin, async (req, res) => {
  const data = await deleteTarget(req.params.personId, req.params.year, req.params.month);
  return res.json({ ok: true, data });
});

const VALID_USER_ROLES = ['employee', 'manager', 'ict', 'top', 'admin'];

router.post('/users', validateOrigin, async (req, res) => {
  const body = req.body || {};
  const displayName = String(body.displayName || '').trim();
  const username = String(body.username || '').trim();
  const role = String(body.role || 'employee');
  if (!displayName || !username) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELDS' });
  }
  if (!VALID_USER_ROLES.includes(role)) {
    return res.status(400).json({ ok: false, code: 'INVALID_ROLE' });
  }
  const users = await loadUsers();
  const usernameKey = username.toLowerCase();
  if (users.some((u) => u.username.toLowerCase() === usernameKey)) {
    return res.status(400).json({ ok: false, code: 'DUPLICATE_USERNAME' });
  }
  const people = await loadPeople();
  if (people.some((p) => String(p.username || '').toLowerCase() === usernameKey)) {
    return res.status(400).json({ ok: false, code: 'DUPLICATE_USERNAME' });
  }
  const managerId = body.managerId || null;
  const personId = `p-${crypto.randomBytes(4).toString('hex')}`;
  if (managerId && wouldCreateCycle(people, personId, managerId)) {
    return res.status(400).json({ ok: false, code: 'MANAGER_CYCLE' });
  }
  const orgRole = role === 'admin' ? 'employee' : role;
  const person = {
    id: personId,
    displayName,
    username,
    aliases: (body.aliases?.length ? body.aliases : [displayName]).map((a) => normalizeKey(a)),
    managerId,
    group: body.group || 'independent',
    orgRole,
  };
  people.push(person);
  await savePeople(people);

  let user = {
    id: `u-${crypto.randomBytes(4).toString('hex')}`,
    username,
    personId: person.id,
    role,
    active: false,
    tokenVersion: 0,
    mustChangePassword: false,
    passwordHash: await hashPassword(crypto.randomBytes(16).toString('hex')),
  };
  users.push(user);
  await saveUsers(users);

  const config = await loadConfig();
  refreshIdentityOnPeopleChange(people, config);

  let tempPassword = null;
  if (body.activate !== false) {
    const result = await activateUserAccount(user.id, req.auth.user.id);
    if (result.error) return res.status(400).json({ ok: false, code: result.error });
    user = result.user;
    tempPassword = result.tempPassword;
  }

  return res.json({
    ok: true,
    data: { person, user: safeUser(user), tempPassword },
  });
});

router.put('/users/:id', validateOrigin, async (req, res) => {
  const users = await loadUsers();
  const idx = users.findIndex((u) => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ ok: false, code: 'NOT_FOUND' });
  const body = req.body || {};
  if (body.role) users[idx].role = body.role;
  if (body.username) users[idx].username = body.username;
  await saveUsers(users);
  return res.json({ ok: true, data: safeUser(users[idx]) });
});

router.get('/config', async (_req, res) => {
  const config = await loadConfig();
  return res.json({ ok: true, data: config });
});

router.put('/config', validateOrigin, async (req, res) => {
  const current = await loadConfig();
  const next = { ...current, ...req.body, bootstrapCompleted: current.bootstrapCompleted };
  await saveConfig(next);
  const people = await loadPeople();
  refreshIdentityOnPeopleChange(people, next);
  return res.json({ ok: true, data: next });
});

router.get('/comments-health', async (_req, res) => {
  try {
    const { getCommentsStorageInfo } = await import('../services/commentsDb.js');
    const info = await getCommentsStorageInfo();
    return res.json({ ok: true, data: info });
  } catch (err) {
    return res.status(500).json({ ok: false, code: 'COMMENTS_HEALTH_FAILED', message: err.message });
  }
});

function safeUser(u) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    personId: u.personId,
    active: u.active,
    mustChangePassword: u.mustChangePassword,
    tempPasswordExpiresAt: u.tempPasswordExpiresAt,
  };
}

function similarity(a, b) {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.7;
  return 0;
}

export default router;

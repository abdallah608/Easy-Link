import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

test('POST /admin/users creates person and active login', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'easylink-admin-'));
  process.env.EASYLINK_DATA_DIR = tmp;
  await import('../src/services/store.js').then((m) => m.initDataDirs());
  const { loadPeople, loadUsers, saveUsers } = await import('../src/services/store.js');
  const { hashPassword } = await import('../src/utils/passwords.js');

  const admin = {
    id: 'u-admin',
    username: 'admin',
    personId: null,
    role: 'admin',
    active: true,
    tokenVersion: 0,
    mustChangePassword: false,
    passwordHash: await hashPassword('AdminPass1'),
  };
  await saveUsers([admin]);

  const { createApp } = await import('../src/app.js');
  const app = createApp();

  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'AdminPass1' }),
  });
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  const createRes = await fetch(`${base}/api/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost:5173' },
    body: JSON.stringify({
      displayName: 'New Employee',
      username: 'newemp',
      role: 'employee',
      activate: true,
    }),
  });
  assert.equal(createRes.status, 200);
  const body = await createRes.json();
  assert.ok(body.data.tempPassword);
  assert.equal(body.data.user.username, 'newemp');

  const people = await loadPeople();
  assert.ok(people.some((p) => p.displayName === 'New Employee'));
  const users = await loadUsers();
  assert.ok(users.some((u) => u.username === 'newemp' && u.active));

  server.close();
  delete process.env.EASYLINK_DATA_DIR;
});

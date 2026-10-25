import { createApp } from './app.js';
import { serverConfig } from './config.js';
import { initDataDirs, ensurePeopleSeed } from './services/store.js';
import { rebuildCacheFromDisk } from './services/reportCache.js';
import { initCommentsDb, backupCommentsStore, getCommentsStorageInfo } from './services/commentsDb.js';

await initDataDirs();
await ensurePeopleSeed();
await initCommentsDb();
await rebuildCacheFromDisk();

try {
  await backupCommentsStore();
  const info = await getCommentsStorageInfo();
  console.log(
    `[comments] backend=${info.backend} path=${info.path} writable=${info.writable} total=${info.totalComments}`,
  );
  if (info.ephemeralWarning) {
    console.warn('[comments] WARNING: DATA_DIR looks ephemeral — comments may be lost on redeploy');
  }
} catch (err) {
  console.warn('[comments] startup backup/info failed:', err.message);
}

const app = createApp();
app.listen(serverConfig.port, serverConfig.host, () => {
  console.log(`EasyLink backend listening on http://${serverConfig.host}:${serverConfig.port}`);
});

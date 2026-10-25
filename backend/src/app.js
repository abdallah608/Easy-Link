import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { serverConfig, paths } from './config.js';
import authRoutes from './routes/authRoutes.js';
import apiRoutes from './routes/apiRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import pendingSdmRoutes from './routes/pendingSdmRoutes.js';
import { attachAuth, requireAuth, requirePasswordChanged } from './middleware/auth.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  if (serverConfig.nodeEnv === 'development') {
    app.use(
      cors({
        origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
        credentials: true,
      }),
    );
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);

  app.use('/api', attachAuth);
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth')) return next();
    if (req.auth?.passwordChangeOnly) {
      return res.status(403).json({ ok: false, code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    return next();
  });

  app.use('/api/admin', adminRoutes);
  app.use('/api', pendingSdmRoutes);
  app.use('/api', apiRoutes);

  const dist = paths.frontDist;
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      return res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use((err, _req, res, _next) => {
    const code = err.message === 'INVALID_FILE_TYPE' ? 'INVALID_FILE_TYPE' : 'SERVER_ERROR';
    res.status(500).json({ ok: false, code, message: err.message });
  });

  return app;
}

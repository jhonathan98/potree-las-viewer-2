import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initDb } from './db.js';
import { cleanupStaleUploads } from './cleanup.js';
import uploadsRouter from './routes/uploads.js';
import jobsRouter from './routes/jobs.js';

const app = express();

// Detras de nginx: usa X-Forwarded-For para el rate limiting e IP real en logs.
app.set('trust proxy', 1);

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:8080')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(helmet());
app.use(express.json());

// Limite general de la API.
app.use(
  '/api',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false })
);
// Limite mas estricto para pedir URLs de subida (evita abuso de creacion de jobs).
app.use(
  '/api/uploads/presign',
  rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false })
);

app.use('/api/uploads', uploadsRouter);
app.use('/api/jobs', jobsRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

async function start() {
  await initDb();
  app.listen(port, () => console.log(`API escuchando en puerto ${port}`));

  setInterval(() => {
    cleanupStaleUploads().catch((err) => console.error('Error en limpieza de uploads', err));
  }, CLEANUP_INTERVAL_MS);
}

start().catch((err) => {
  console.error('Error al iniciar la API', err);
  process.exit(1);
});

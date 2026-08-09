import express from 'express';
import cors from 'cors';
import { initDb } from './db.js';
import uploadsRouter from './routes/uploads.js';
import jobsRouter from './routes/jobs.js';

const app = express();
app.use(cors());

app.use('/api/uploads', uploadsRouter);
app.use('/api/jobs', jobsRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;

async function start() {
  await initDb();
  app.listen(port, () => console.log(`API escuchando en puerto ${port}`));
}

start().catch((err) => {
  console.error('Error al iniciar la API', err);
  process.exit(1);
});

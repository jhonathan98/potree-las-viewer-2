import { Router } from 'express';
import { getJob, listJobs } from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const jobs = await listJobs();
  res.json(jobs);
});

router.get('/:id', async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'No encontrado' });
    return;
  }
  res.json(job);
});

export default router;

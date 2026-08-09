import { Router } from 'express';
import { getJob, listJobs } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const jobs = await listJobs(req.userId);
  res.json(jobs);
});

router.get('/:id', async (req, res) => {
  const job = await getJob(req.params.id, req.userId);
  if (!job) {
    res.status(404).json({ error: 'No encontrado' });
    return;
  }
  res.json(job);
});

export default router;

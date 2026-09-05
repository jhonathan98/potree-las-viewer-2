import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { minioClient, RAW_BUCKET } from '../minio.js';
import { createJob, getJob, updateJobStatus } from '../db.js';
import { conversionQueue } from '../queue.js';
import { requireAuth } from '../auth.js';

const router = Router();

router.use(requireAuth);

// Suficiente margen para archivos grandes en redes lentas.
const PRESIGN_EXPIRY_SECONDS = 60 * 60;

// Paso 1: el navegador pide una URL prefirmada y sube el archivo directo a
// MinIO (via el proxy /raw-las/ de nginx), sin que pase por esta API.
router.post('/presign', async (req, res) => {
  const { filename } = req.body || {};
  if (!filename || typeof filename !== 'string') {
    res.status(400).json({ error: 'Falta "filename"' });
    return;
  }

  const jobId = uuidv4();
  const ext = filename.toLowerCase().endsWith('.laz') ? 'laz' : 'las';
  const rawKey = `${jobId}/input.${ext}`;
  const outputPrefix = `${jobId}/`;

  try {
    const presignedUrl = await minioClient.presignedPutObject(
      RAW_BUCKET,
      rawKey,
      PRESIGN_EXPIRY_SECONDS
    );
    // La URL firmada apunta al host interno "minio:9000". nginx expone el
    // mismo path bajo /raw-las/ reenviando con el mismo Host, asi que el
    // navegador solo necesita path+query para que la firma siga siendo valida.
    // BACKEND_PUBLIC_URL antepone el origen publico de la API cuando el
    // frontend vive en otro dominio (ej. Cloudflare Pages); vacio en local,
    // donde frontend y API comparten origen via el nginx del docker-compose.
    const { pathname, search } = new URL(presignedUrl);
    const uploadUrl = `${process.env.BACKEND_PUBLIC_URL || ''}${pathname}${search}`;

    await createJob({ id: jobId, originalFilename: filename, rawKey, outputPrefix, userId: req.userId });

    res.json({ jobId, uploadUrl });
  } catch (err) {
    console.error('Error generando URL prefirmada', err);
    res.status(500).json({ error: 'No se pudo preparar la subida' });
  }
});

// Paso 2: el navegador confirma que ya subio el archivo directo a MinIO;
// la API verifica que el objeto exista y recien ahi encola la conversion.
router.post('/:jobId/complete', async (req, res) => {
  const { jobId } = req.params;
  const job = await getJob(jobId, req.userId);
  if (!job) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }

  try {
    await minioClient.statObject(RAW_BUCKET, job.raw_key);
  } catch (err) {
    res.status(400).json({ error: 'El archivo no llego a MinIO' });
    return;
  }

  await updateJobStatus(jobId, 'queued');
  await conversionQueue.add('convert', {
    jobId,
    rawKey: job.raw_key,
    outputPrefix: job.output_prefix,
    originalFilename: job.original_filename,
  });

  res.json({ jobId, status: 'queued' });
});

export default router;

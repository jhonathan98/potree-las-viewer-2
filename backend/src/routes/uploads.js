import { Router } from 'express';
import Busboy from 'busboy';
import { v4 as uuidv4 } from 'uuid';
import { minioClient, RAW_BUCKET } from '../minio.js';
import { createJob } from '../db.js';
import { conversionQueue } from '../queue.js';

const router = Router();

// Sube el LAS/LAZ en streaming (sin bufferizarlo entero en memoria) directo a MinIO,
// crea el registro del trabajo y lo encola para el worker.
router.post('/', (req, res) => {
  const maxBytes = parseInt(process.env.MAX_UPLOAD_GB || '200', 10) * 1024 * 1024 * 1024;

  const busboy = Busboy({
    headers: req.headers,
    limits: { files: 1, fileSize: maxBytes },
  });

  const jobId = uuidv4();
  let originalFilename = 'upload.las';
  let uploadPromise = null;
  let fileReceived = false;

  busboy.on('file', (_fieldName, fileStream, info) => {
    fileReceived = true;
    originalFilename = info.filename || originalFilename;
    const ext = originalFilename.toLowerCase().endsWith('.laz') ? 'laz' : 'las';
    const rawKey = `${jobId}/input.${ext}`;

    // minioClient.putObject acepta un stream y hace multipart upload internamente
    uploadPromise = minioClient
      .putObject(RAW_BUCKET, rawKey, fileStream)
      .then(async () => {
        const outputPrefix = `${jobId}/`;
        await createJob({ id: jobId, originalFilename, rawKey, outputPrefix });
        await conversionQueue.add('convert', {
          jobId,
          rawKey,
          outputPrefix,
          originalFilename,
        });
      });
  });

  busboy.on('finish', async () => {
    if (!fileReceived) {
      res.status(400).json({ error: 'No se recibio ningun archivo' });
      return;
    }
    try {
      await uploadPromise;
      res.status(202).json({ jobId, status: 'queued' });
    } catch (err) {
      console.error('Error subiendo archivo a MinIO', err);
      res.status(500).json({ error: 'Fallo al subir el archivo' });
    }
  });

  req.pipe(busboy);
});

export default router;

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import * as Minio from 'minio';
import pg from 'pg';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT, 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

const RAW_BUCKET = process.env.RAW_BUCKET;
const POINTCLOUDS_BUCKET = process.env.POINTCLOUDS_BUCKET;
const SCRATCH_DIR = process.env.SCRATCH_DIR || '/scratch';
const POTREE_CONVERTER_BIN =
  process.env.POTREE_CONVERTER_BIN || '/usr/local/bin/PotreeConverter';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function updateJobStatus(id, status, error = null) {
  await pool.query(
    `UPDATE jobs SET status = $2, error = $3, updated_at = now() WHERE id = $1`,
    [id, status, error]
  );
}

async function uploadDirectory(localDir, bucket, prefix) {
  const entries = await fs.readdir(localDir, { withFileTypes: true });
  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    const remoteKey = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      await uploadDirectory(localPath, bucket, `${remoteKey}/`);
    } else {
      await minioClient.fPutObject(bucket, remoteKey, localPath);
    }
  }
}

function runPotreeConverter(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    // -m poisson: muestreo por defecto de PotreeConverter (buena calidad visual).
    // Usa "-m random" si priorizas velocidad de conversion sobre calidad de LOD.
    const proc = spawn(POTREE_CONVERTER_BIN, [
      inputPath,
      '-o',
      outputDir,
      '-m',
      'poisson',
    ]);

    proc.stdout.on('data', (d) => process.stdout.write(`[PotreeConverter] ${d}`));
    proc.stderr.on('data', (d) => process.stderr.write(`[PotreeConverter] ${d}`));

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`PotreeConverter termino con codigo ${code}`));
    });
  });
}

const worker = new Worker(
  'conversion',
  async (job) => {
    const { jobId, rawKey, outputPrefix, originalFilename } = job.data;
    const workDir = path.join(SCRATCH_DIR, jobId);
    const inputExt = rawKey.toLowerCase().endsWith('.laz') ? 'laz' : 'las';
    const inputPath = path.join(workDir, `input.${inputExt}`);
    const outputDir = path.join(workDir, 'output');

    try {
      await fs.mkdir(workDir, { recursive: true });

      await updateJobStatus(jobId, 'downloading');
      await minioClient.fGetObject(RAW_BUCKET, rawKey, inputPath);

      await updateJobStatus(jobId, 'converting');
      await fs.mkdir(outputDir, { recursive: true });
      await runPotreeConverter(inputPath, outputDir);

      await updateJobStatus(jobId, 'uploading_result');
      await uploadDirectory(outputDir, POINTCLOUDS_BUCKET, outputPrefix);

      await updateJobStatus(jobId, 'ready');
      console.log(`Job ${jobId} (${originalFilename}) listo`);
    } catch (err) {
      console.error(`Job ${jobId} fallo:`, err);
      await updateJobStatus(jobId, 'failed', err.message);
      throw err;
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  },
  { connection, concurrency: 1 }
);

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} fallo definitivamente:`, err);
});

console.log('Worker de conversion escuchando trabajos...');

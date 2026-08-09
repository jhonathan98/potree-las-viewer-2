import { minioClient, RAW_BUCKET } from './minio.js';
import { pool } from './db.js';

// Margen sobre los 60 min de expiracion de la URL prefirmada (ver
// PRESIGN_EXPIRY_SECONDS en routes/uploads.js): si un job sigue en
// "uploading" pasado este tiempo, la subida nunca se confirmo (el usuario
// cerro la pestana, se corto la red, etc.) y no va a completarse sola.
const STALE_UPLOAD_MINUTES = parseInt(process.env.STALE_UPLOAD_MINUTES || '90', 10);

// Marca como "failed" los jobs con subida abandonada, y borra el objeto en
// MinIO si alcanzo a subirse antes de que el usuario abandonara el flujo.
export async function cleanupStaleUploads() {
  const { rows } = await pool.query(
    `SELECT id, raw_key FROM jobs
     WHERE status = 'uploading' AND created_at < now() - make_interval(mins => $1)`,
    [STALE_UPLOAD_MINUTES]
  );

  for (const job of rows) {
    try {
      await minioClient.removeObject(RAW_BUCKET, job.raw_key);
    } catch (err) {
      // No hay objeto que borrar si la subida nunca llego a MinIO; no es un error.
    }
    await pool.query(
      `UPDATE jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
      [job.id, 'Subida no completada a tiempo (URL prefirmada expirada)']
    );
    console.log(`Job ${job.id} marcado como failed por subida incompleta`);
  }

  return rows.length;
}

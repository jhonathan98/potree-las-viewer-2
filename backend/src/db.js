import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id UUID PRIMARY KEY,
      original_filename TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploading',
      raw_key TEXT NOT NULL,
      output_prefix TEXT NOT NULL,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// El status arranca en el default de la tabla ('uploading'): el job pasa a
// 'queued' recien cuando /api/uploads/:jobId/complete confirma que el
// archivo ya llego a MinIO (ver routes/uploads.js).
export async function createJob({ id, originalFilename, rawKey, outputPrefix }) {
  await pool.query(
    `INSERT INTO jobs (id, original_filename, raw_key, output_prefix)
     VALUES ($1, $2, $3, $4)`,
    [id, originalFilename, rawKey, outputPrefix]
  );
}

export async function updateJobStatus(id, status, error = null) {
  await pool.query(
    `UPDATE jobs SET status = $2, error = $3, updated_at = now() WHERE id = $1`,
    [id, status, error]
  );
}

export async function getJob(id) {
  const { rows } = await pool.query(`SELECT * FROM jobs WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function listJobs() {
  const { rows } = await pool.query(
    `SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100`
  );
  return rows;
}

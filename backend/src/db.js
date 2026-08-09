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
  // Dueno del job (Supabase Auth). REFERENCES auth.users porque corre en el
  // mismo Postgres de Supabase.
  await pool.query(`
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
  `);
}

// El status arranca en el default de la tabla ('uploading'): el job pasa a
// 'queued' recien cuando /api/uploads/:jobId/complete confirma que el
// archivo ya llego a MinIO (ver routes/uploads.js).
export async function createJob({ id, originalFilename, rawKey, outputPrefix, userId }) {
  await pool.query(
    `INSERT INTO jobs (id, original_filename, raw_key, output_prefix, user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, originalFilename, rawKey, outputPrefix, userId]
  );
}

export async function updateJobStatus(id, status, error = null) {
  await pool.query(
    `UPDATE jobs SET status = $2, error = $3, updated_at = now() WHERE id = $1`,
    [id, status, error]
  );
}

// Los jobs son privados: se filtran siempre por dueno, para que un usuario
// no pueda ver ni completar los jobs de otro (aunque adivine el UUID).
export async function getJob(id, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM jobs WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return rows[0] || null;
}

export async function listJobs(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [userId]
  );
  return rows;
}

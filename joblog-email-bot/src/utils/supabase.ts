import pg from 'pg';

const { Pool } = pg;

// Use the session pooler URL (port 5432) for direct connections from Botpress Cloud.
// The transaction pooler (port 6543) has pgbouncer limitations.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/** Run a SQL query and return rows. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

/** Run a SQL query and return the first row or null. */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

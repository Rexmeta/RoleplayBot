import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL || '';
if (!databaseUrl) {
  console.error('WARNING: DATABASE_URL is not set. Database operations will fail.');
}

function buildPoolConfig(url: string): import('pg').PoolConfig {
  if (!url) return {};

  try {
    const parsed = new URL(url);
    const hostParam = parsed.searchParams.get('host');

    if (hostParam && hostParam.startsWith('/cloudsql/')) {
      console.log(`Using Cloud SQL Unix socket: ${hostParam}`);
      return {
        host: hostParam,
        user: parsed.username,
        password: parsed.password,
        database: parsed.pathname.slice(1),
        ssl: false,
      };
    }
  } catch {
    // URL parsing failed – fall through to connection-string path
  }

  const isUnixSocket = url.includes('/cloudsql/');
  const disableSsl = url.includes('sslmode=disable') || isUnixSocket;

  return {
    connectionString: url,
    ssl: disableSsl ? false : { rejectUnauthorized: false },
  };
}

export const pool = new Pool({
  ...buildPoolConfig(databaseUrl),
  max: 25,
  min: 0,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 10000,
  idle_in_transaction_session_timeout: 30000,
  allowExitOnIdle: false,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

export const db = drizzle(pool);

export async function checkDatabaseConnection(): Promise<boolean> {
  await pool.query('SELECT 1');
  return true;
}

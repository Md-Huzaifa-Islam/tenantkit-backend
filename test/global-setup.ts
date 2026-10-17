import { execSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Creates the test database and the restricted app role if needed, then applies
 * migrations. Runs once before the whole Jest suite.
 */
export default async function globalSetup() {
  require('./setup-env');
  const migrationUrl = new URL(process.env.DATABASE_MIGRATION_URL!);
  const appUrl = new URL(process.env.DATABASE_URL!);
  const dbName = migrationUrl.pathname.slice(1);

  const serverUrl = new URL(migrationUrl.toString());
  serverUrl.pathname = '/postgres';
  const client = new Client({ connectionString: serverUrl.toString() });
  await client.connect();
  try {
    const db = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (db.rowCount === 0) await client.query(`CREATE DATABASE "${dbName}"`);

    const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'tenantkit_app'");
    if (role.rowCount === 0) {
      const password = decodeURIComponent(appUrl.password).replace(/'/g, "''");
      await client.query(
        `CREATE ROLE tenantkit_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${password}'`,
      );
    }
  } finally {
    await client.end();
  }

  execSync('pnpm exec prisma migrate deploy', { stdio: 'inherit', env: process.env });
}

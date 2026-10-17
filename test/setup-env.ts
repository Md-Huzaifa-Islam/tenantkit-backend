// Defaults for local test runs against the docker compose Postgres (host port 5433).
// CI overrides these through real environment variables.
const owner = process.env.TEST_DB_OWNER_URL ?? 'postgresql://tenantkit:tenantkit@localhost:5433';
const appPassword = process.env.APP_DB_PASSWORD ?? 'tenantkit_app';
const host = owner.replace(/^postgresql:\/\/[^@]+@/, '');

process.env.NODE_ENV = 'test';
process.env.DATABASE_MIGRATION_URL ??= `${owner}/tenantkit_test`;
process.env.DATABASE_URL ??= `postgresql://tenantkit_app:${appPassword}@${host}/tenantkit_test`;
process.env.JWT_ACCESS_SECRET ??= 'test-secret-test-secret-test-secret-123';
process.env.LOG_LEVEL ??= 'silent';
process.env.AUTH_RATE_LIMIT_PER_MINUTE ??= '1000';
process.env.UPLOAD_DIR ??= 'uploads-test';
process.env.BILLING_PROVIDER ??= 'mock';
process.env.EMAIL_PROVIDER ??= 'mock';

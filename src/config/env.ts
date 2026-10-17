import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool.default('false'),

  /** Public URL of the web app, used in email links and Stripe redirects. */
  APP_URL: z.string().url().default('http://localhost:3000'),
  /** Comma-separated CORS allowlist. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  TRUST_PROXY: bool.default('true'),

  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),

  BILLING_PROVIDER: z.enum(['mock', 'stripe']).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_BUSINESS: z.string().optional(),

  EMAIL_PROVIDER: z.enum(['mock', 'resend']).optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('TenantKit <no-reply@tenantkit.dev>'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('uploads'),
  /** Public base URL under which uploaded files are served. */
  PUBLIC_UPLOAD_BASE_URL: z.string().default('/uploads'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),

  ENABLE_DEV_MAILBOX: bool.optional(),
});

export type Env = z.infer<typeof envSchema> & {
  billingProvider: 'mock' | 'stripe';
  emailProvider: 'mock' | 'resend';
  devMailboxEnabled: boolean;
  corsOrigins: string[];
};

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty strings (e.g. `STRIPE_SECRET_KEY=` in .env) as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  return {
    ...e,
    // Real providers switch on only when their keys are present.
    billingProvider: e.BILLING_PROVIDER ?? (e.STRIPE_SECRET_KEY ? 'stripe' : 'mock'),
    emailProvider: e.EMAIL_PROVIDER ?? (e.RESEND_API_KEY ? 'resend' : 'mock'),
    devMailboxEnabled: e.ENABLE_DEV_MAILBOX ?? e.NODE_ENV !== 'production',
    corsOrigins: e.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

export const ENV = Symbol('ENV');

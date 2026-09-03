import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { z } from 'zod';

/**
 * Collects every `.env` from the working directory up to the filesystem root,
 * nearest first — which is the precedence ConfigModule already applies to
 * `envFilePath` (first file to define a key wins).
 *
 * In a monorepo the same command gets run from the repo root (`npm run dev`),
 * from the app directory, and from a test runner's cwd. A fixed relative path
 * silently resolves to nothing in two of those three, so this searches instead.
 */
export function findEnvFiles(startDir: string = process.cwd()): string[] {
  const found: string[] = [];
  const { root } = parse(startDir);
  let dir = startDir;

  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) found.push(candidate);
    if (dir === root) break;
    dir = dirname(dir);
  }

  return found;
}

/**
 * Environment contract for the API.
 *
 * The Express app this is ported from fell back to hardcoded defaults when vars
 * were missing — most notably two *different* JWT signing secrets
 * ('fallback-super-secret-key' in utils/auth.ts, 'fallback-secret' in
 * lambda/authUtils.ts), so a token minted by one code path failed verification
 * in the other. Requiring JWT_SECRET here deletes that whole class of bug:
 * there is no fallback left to disagree about.
 */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().default(5001),

    JWT_SECRET: z.string().min(1),

    DB_HOST: z.string().min(1),
    DB_NAME: z.string().min(1),
    DB_PORT: z.coerce.number().default(5432),
    // Credentials come from Secrets Manager when DATABASE_SECRET_ARN is set
    // (deployed Aurora), and from the environment otherwise (local Postgres).
    DATABASE_SECRET_ARN: z.string().optional(),
    DB_USER: z.string().optional(),
    DB_PASSWORD: z.string().optional(),
    // A paused Aurora Serverless v2 cluster takes ~15s to resume on the first
    // connection, so the default must comfortably exceed that.
    DB_CONNECT_TIMEOUT_MS: z.coerce.number().default(30000),

    AWS_REGION: z.string().default('us-east-1'),
    FRONTEND_URL: z.string().default('http://localhost:5173'),

    SES_FROM_EMAIL: z.string().optional(),
    S3_ENDPOINT: z.string().default('http://localhost:4566'),
    S3_BUCKET_NAME: z.string().optional(),
    ADMIN_SEED_PASSWORD_PARAM: z.string().optional(),

    FEEDBACK_ENABLED: z.enum(['true', 'false']).default('true'),
  })
  .superRefine((env, ctx) => {
    if (env.DATABASE_SECRET_ARN) return;
    for (const key of ['DB_USER', 'DB_PASSWORD'] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required unless DATABASE_SECRET_ARN is set`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and applies defaults, reporting *every* problem at once rather than
 * failing on the first. Used both by ConfigModule's `validate` hook (so boot
 * fails fast with a readable message) and by the config factory below.
 */
export function parseEnv(source: Record<string, unknown>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

/**
 * ConfigModule `validate` hook. Spreads the parsed values back over the raw
 * environment so defaults are applied without stripping the unrelated keys
 * (PATH, HOME, AWS_*) that a bare schema parse would drop.
 */
export function validate(config: Record<string, unknown>) {
  return { ...config, ...parseEnv(config) };
}

export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user?: string;
  password?: string;
  secretArn?: string;
  connectTimeoutMs: number;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  jwtSecret: string;
  frontendUrl: string;
  awsRegion: string;
  feedbackEnabled: boolean;
  adminSeedPasswordParam?: string;
  database: DatabaseConfig;
}

/**
 * Re-parses process.env rather than trusting that `validate`'s return value was
 * written back, so defaults hold regardless of ConfigModule's internal ordering.
 */
export const configuration = (): AppConfig => {
  const env = parseEnv(process.env);

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    jwtSecret: env.JWT_SECRET,
    frontendUrl: env.FRONTEND_URL,
    awsRegion: env.AWS_REGION,
    // Compared as a string, matching the Express app: only the literal 'false'
    // disables the feedback module; anything else leaves it on.
    feedbackEnabled: env.FEEDBACK_ENABLED !== 'false',
    adminSeedPasswordParam: env.ADMIN_SEED_PASSWORD_PARAM,
    database: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      name: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      secretArn: env.DATABASE_SECRET_ARN,
      connectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
    },
  };
};

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pkg from 'pg';
import type { Pool as PoolType, QueryResult, QueryResultRow } from 'pg';
import type { DatabaseConfig } from '../config/configuration.js';

const { Pool } = pkg;

/**
 * Postgres error code for "password authentication failed" — thrown when a
 * cached Pool's credentials have gone stale (e.g. Secrets Manager rotated the
 * Aurora master password out from under an already-warm Lambda).
 */
const INVALID_PASSWORD = '28P01';

/**
 * Port of the Express app's `src/db.ts`.
 *
 * Two behaviours here are load-bearing and must not be "simplified" away:
 *
 * 1. The pool is created lazily and cached. Under Lambda the module-level cache
 *    is what makes warm invocations cheap.
 * 2. AWS auto-rotates the Aurora master password every 7 days. A warm container
 *    keeps authenticating with the old password until it happens to cold-start,
 *    which surfaced as "Internal server error" on login. `query()` catches
 *    28P01, tears the pool down, refetches the secret, and retries once.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: PoolType | null = null;
  private readonly config: DatabaseConfig;

  constructor(configService: ConfigService) {
    this.config = configService.get<DatabaseConfig>('database')!;
  }

  private async resolveCredentials(): Promise<{
    user?: string;
    password?: string;
  }> {
    if (!this.config.secretArn) {
      return { user: this.config.user, password: this.config.password };
    }

    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    );
    const client = new SecretsManagerClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: this.config.secretArn }),
    );
    const secret = JSON.parse(response.SecretString!);
    return { user: secret.username, password: secret.password };
  }

  private async getPool(): Promise<PoolType> {
    if (this.pool) return this.pool;

    const { user, password } = await this.resolveCredentials();

    this.pool = new Pool({
      user,
      password,
      host: this.config.host,
      database: this.config.name,
      port: this.config.port,
      // Aurora/RDS Postgres enforces SSL (rds.force_ssl); the RDS CA isn't in
      // Node's trust store, so skip chain verification rather than bundle it.
      ssl: this.config.secretArn ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: this.config.connectTimeoutMs,
      idleTimeoutMillis: 30000,
    });

    this.pool.on('connect', () =>
      this.logger.log('Connected to PostgreSQL database.'),
    );
    this.pool.on('error', (err: Error) =>
      this.logger.error(`Unexpected error on idle database client: ${err.message}`),
    );

    return this.pool;
  }

  async query<T extends QueryResultRow = any>(
    text: string,
    params: any[] = [],
  ): Promise<QueryResult<T>> {
    const pool = await this.getPool();

    try {
      return await pool.query<T>(text, params);
    } catch (error: any) {
      if (error?.code === INVALID_PASSWORD && this.config.secretArn) {
        this.logger.warn(
          'DB credentials appear stale (28P01); refetching secret and retrying once.',
        );
        const stale = this.pool;
        this.pool = null;
        // Don't await — a pool whose credentials are rejected has no usable
        // connections to drain, and end() can hang waiting for one.
        void stale?.end().catch(() => {});
        const fresh = await this.getPool();
        return fresh.query<T>(text, params);
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    await pool?.end().catch(() => {});
  }
}

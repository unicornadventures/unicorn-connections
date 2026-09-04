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
  /**
   * The in-flight *promise*, not the resolved pool.
   *
   * Caching the resolved value would leave an `await` between the "do we have
   * one?" check and the assignment, so two concurrent first queries would each
   * build a Pool and the loser's would leak — never assigned, never `end()`ed,
   * holding its connections until they idled out. Any handler that issues two
   * queries with `Promise.all` triggers it on the first request after boot,
   * which under Lambda means once per cold start.
   */
  private pool: Promise<PoolType> | null = null;
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

  /**
   * Assigns the promise synchronously, before the first `await`, so concurrent
   * callers all receive the same one. On failure the slot is cleared so the
   * next caller retries rather than inheriting a rejected promise forever.
   */
  private getPool(): Promise<PoolType> {
    this.pool ??= this.createPool().catch((error: unknown) => {
      this.pool = null;
      throw error;
    });
    return this.pool;
  }

  private async createPool(): Promise<PoolType> {
    const { user, password } = await this.resolveCredentials();

    const pool = new Pool({
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

    pool.on('connect', () =>
      this.logger.log('Connected to PostgreSQL database.'),
    );
    pool.on('error', (err: Error) =>
      this.logger.error(`Unexpected error on idle database client: ${err.message}`),
    );

    return pool;
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
        void stale?.then((p) => p.end()).catch(() => {});
        const fresh = await this.getPool();
        return fresh.query<T>(text, params);
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    await pool?.then((p) => p.end()).catch(() => {});
  }
}

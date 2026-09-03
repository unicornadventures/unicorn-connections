import { Injectable, Logger } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { DatabaseService } from './database.service.js';

const SALT_ROUNDS = 10;
const ADMIN_EMAIL = 'admin@reunion.com';

/**
 * Port of the Express app's `src/seed.ts` and the SSM password fetch from
 * `src/lambda/init.ts`.
 *
 * The seed password lives in an SSM SecureString parameter so it never appears
 * in the repo, the SAM template, or the Lambda environment. Seeding is a no-op
 * when the admin already exists — it never overwrites an existing password.
 */
@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Returns the seed password from SSM, or null if not configured/present. */
  async fetchAdminSeedPassword(paramName?: string): Promise<string | null> {
    if (!paramName) return null;

    try {
      const { SSMClient, GetParameterCommand } = await import(
        '@aws-sdk/client-ssm'
      );
      const client = new SSMClient({
        region: process.env.AWS_REGION ?? 'us-east-1',
      });
      const response = await client.send(
        new GetParameterCommand({ Name: paramName, WithDecryption: true }),
      );
      return response.Parameter?.Value ?? null;
    } catch (err: any) {
      if (err.name === 'ParameterNotFound') {
        this.logger.warn(
          `Admin seed parameter ${paramName} not found. Skipping seeding.`,
        );
        return null;
      }
      throw err;
    }
  }

  async seedAdminUser(password: string): Promise<void> {
    this.logger.log('🔨 Starting global admin user seeding process...');

    try {
      await this.db.query('BEGIN');

      // 1. Check for duplicates to protect against primary key violations
      const existingUser = await this.db.query(
        'SELECT id FROM users WHERE email = $1',
        [ADMIN_EMAIL],
      );
      if (existingUser.rows.length > 0) {
        this.logger.warn('⚠️ Admin user already exists. Skipping creation.');
        await this.db.query('ROLLBACK');
        return;
      }

      // 2. Hash the incoming password string
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      // 3. Create admin user
      const result = await this.db.query(
        'INSERT INTO users (email, password, is_admin) VALUES ($1, $2, $3) RETURNING id;',
        [ADMIN_EMAIL, hashedPassword, true],
      );

      const adminUserId = result.rows[0].id;

      // 4. Create admin profile
      await this.db.query(
        'INSERT INTO profiles (user_id, first_name, last_name) VALUES ($1, $2, $3);',
        [adminUserId, 'Admin', 'Administrator'],
      );

      await this.db.query('COMMIT');
      this.logger.log(
        `🎉 Global Admin User created successfully! ID: ${adminUserId}`,
      );
    } catch (error: any) {
      await this.db.query('ROLLBACK');
      this.logger.error(`❌ FATAL: Failed to seed admin user. ${error.message}`);
      throw error;
    }
  }
}

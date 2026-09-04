import { Injectable } from '@nestjs/common';
import type { Feedback } from '@classyear/shared-types';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class FeedbackRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(userId: number, comment: string): Promise<Feedback> {
    const result = await this.db.query<Feedback>(
      `INSERT INTO feedback (user_id, comment)
       VALUES ($1, $2)
       RETURNING id, user_id, comment, created_at;`,
      [userId, comment],
    );
    return result.rows[0];
  }

  /**
   * The caller's own feedback only. There is no endpoint that reads anyone
   * else's — not even for an admin — so submitted feedback is currently
   * write-only from the product's point of view.
   */
  async listForUser(userId: number): Promise<Feedback[]> {
    const result = await this.db.query<Feedback>(
      `SELECT id, user_id, comment, created_at
       FROM feedback
       WHERE user_id = $1
       ORDER BY created_at DESC;`,
      [userId],
    );
    return result.rows;
  }
}

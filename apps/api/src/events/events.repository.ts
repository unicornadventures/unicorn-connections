import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

/**
 * An event as the API returns it — note `title`, not `event_name`.
 *
 * The column is `event_name` and every query aliases it to `title`, so the
 * database name never reaches a client. `event_date` is rendered by
 * `to_char(..., 'YYYY-MM-DD')` rather than handed to the driver as a DATE:
 * node-postgres would parse it into a JS Date in the *server's* timezone and
 * `JSON.stringify` would then shift it, which is how a 15 June reunion becomes
 * 14 June for anyone west of UTC. The string is the contract.
 */
export interface EventRow {
  id: number;
  class_id: number;
  school_id: number | null;
  title: string;
  description: string | null;
  /** 'YYYY-MM-DD'. */
  event_date: string;
  /** 'HH:MM:SS' — a TIME column, which pg hands back as a string. */
  event_time: string;
  location: string | null;
  created_at: Date;
  updated_at: Date;
  /** The school's IANA zone, joined in so the client can render local time. */
  timezone: string | null;
}

const EVENT_COLUMNS = `e.id, e.class_id, e.school_id, e.event_name as title, e.description,
              to_char(e.event_date, 'YYYY-MM-DD') as event_date, e.event_time, e.location,
              e.created_at, e.updated_at, s.timezone`;

@Injectable()
export class EventsRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Chronological, and an event with no time sorts last within its day. */
  async listForClassAtSchool(
    classId: string,
    schoolId: string,
  ): Promise<EventRow[]> {
    const result = await this.db.query<EventRow>(
      `SELECT ${EVENT_COLUMNS}
       FROM events e
       LEFT JOIN schools s ON e.school_id = s.id
       WHERE e.class_id = $1 AND e.school_id = $2
       ORDER BY e.event_date ASC, e.event_time ASC NULLS LAST;`,
      [classId, schoolId],
    );
    return result.rows;
  }

  async findEvent(eventId: string): Promise<EventRow | undefined> {
    const result = await this.db.query<EventRow>(
      `SELECT ${EVENT_COLUMNS}
       FROM events e
       LEFT JOIN schools s ON e.school_id = s.id
       WHERE e.id = $1`,
      [eventId],
    );
    return result.rows[0];
  }

  /** Just the class, which is what authorization is scoped on. */
  async findEventClass(
    eventId: string,
  ): Promise<{ id: number; class_id: number } | undefined> {
    const result = await this.db.query<{ id: number; class_id: number }>(
      'SELECT id, class_id FROM events WHERE id = $1',
      [eventId],
    );
    return result.rows[0];
  }

  /**
   * Returns the updated row **without `timezone`** — the UPDATE does not join
   * `schools`, so a PUT response is one field narrower than the GET response
   * for the same event. That asymmetry is the source's and a contract test
   * pins it; adding the join would be a silent contract change.
   */
  async updateEvent(
    eventId: string,
    update: {
      title?: string | null;
      description?: string | null;
      eventDate?: string | null;
      eventTime?: string | null;
      location?: string | null;
    },
  ): Promise<Omit<EventRow, 'timezone'> | undefined> {
    // COALESCE throughout: an omitted field keeps its value, and — as in the
    // profile update — no field can be cleared through this path.
    const result = await this.db.query<Omit<EventRow, 'timezone'>>(
      `UPDATE events
       SET event_name = COALESCE($1, event_name),
           description = COALESCE($2, description),
           event_date = COALESCE($3, event_date),
           event_time = COALESCE($4, event_time),
           location = COALESCE($5, location),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, class_id, school_id, event_name as title, description, to_char(event_date, 'YYYY-MM-DD') as event_date, event_time, location, created_at, updated_at;`,
      [
        update.title,
        update.description,
        update.eventDate,
        update.eventTime,
        update.location,
        eventId,
      ],
    );
    return result.rows[0];
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.db.query('DELETE FROM events WHERE id = $1 RETURNING id;', [
      eventId,
    ]);
  }
}

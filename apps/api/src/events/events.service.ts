import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { ClassScopeService } from '../common/class-scope/class-scope.service.js';
import { rethrowAsInternal } from '../common/http-errors.js';
import { EventsRepository } from './events.repository.js';
import type { UpdateEventDto } from './dto/event.dto.js';

/**
 * `/api/events` and `GET /api/schools/:schoolId/classes/:classId/events`,
 * ported from `lambda/events.ts`.
 *
 * Creating an event is deployed under `/api/admin/schools/…` and lands in
 * phase 5 with the rest of AdminModule, so this module reads, updates and
 * deletes but does not create.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly repo: EventsRepository,
    private readonly scope: ClassScopeService,
  ) {}

  /**
   * Splits an ISO timestamp into the DATE and TIME columns the table actually
   * has. `new Date('nonsense')` yields an Invalid Date and `.toISOString()`
   * throws, which the caller's catch turns into a 500 — the source's behaviour
   * for a malformed `event_date`, preserved rather than turned into a 400.
   *
   * Note this reads the **UTC** components, so a client sending a local-time
   * string with an offset gets the UTC instant stored. Every existing event was
   * written this way, so changing it would misalign new events with old ones.
   */
  private splitDateTime(value: string): { date: string; time: string } {
    const parsed = new Date(value);
    const iso = parsed.toISOString();
    return { date: iso.split('T')[0], time: iso.split('T')[1].substring(0, 8) };
  }

  async listEvents(schoolId: string, classId: string) {
    try {
      return {
        events: await this.repo.listForClassAtSchool(classId, schoolId),
      };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Any authenticated user can read any event by id — there is no class check
   * here, unlike the class directory. Flagged in docs §9.2 rather than
   * tightened: it is what is deployed, and event details are not sensitive in
   * the way a member roster is.
   */
  async getEvent(eventId: string) {
    try {
      const found = await this.repo.findEvent(eventId);
      if (!found) {
        throw new NotFoundException({ error: 'Event not found.' });
      }
      return { event: found };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async updateEvent(
    eventId: string,
    body: UpdateEventDto,
    authUser: AuthUser,
  ) {
    try {
      const { title, description, event_date, location } = body;

      // Existence is checked before authorization, so editing a missing event
      // reports 404 rather than 403 whoever asks.
      const existing = await this.repo.findEventClass(eventId);
      if (!existing) {
        throw new NotFoundException({ error: 'Event not found.' });
      }

      await this.assertCanManage(authUser, String(existing.class_id));

      // One field in, two columns out: `event_date` carries the time too.
      const split = event_date ? this.splitDateTime(event_date) : null;

      const updated = await this.repo.updateEvent(eventId, {
        title,
        description,
        eventDate: split?.date ?? null,
        eventTime: split?.time ?? null,
        location,
      });

      return { event: updated };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async deleteEvent(eventId: string, authUser: AuthUser) {
    try {
      const existing = await this.repo.findEventClass(eventId);
      if (!existing) {
        throw new NotFoundException({ error: 'Event not found.' });
      }

      await this.assertCanManage(authUser, String(existing.class_id));

      await this.repo.deleteEvent(eventId);

      return { message: 'Event deleted successfully.' };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  private async assertCanManage(
    authUser: AuthUser,
    classId: string,
  ): Promise<void> {
    if (!(await this.scope.canManageEvent(authUser, classId))) {
      throw new ForbiddenException({
        error: 'Access denied. You can only manage events for your class.',
      });
    }
  }
}

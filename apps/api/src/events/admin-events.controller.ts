import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { EventsService } from './events.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/auth-user.js';
import type { UpdateEventDto } from './dto/event.dto.js';

/**
 * `POST /api/admin/schools/:schoolId/classes/:classId/events`.
 *
 * The only admin route in the app behind `JwtAuthGuard` rather than
 * `SuperAdminGuard`: a class admin creates events for their own class, and
 * `canManageEvent` inside the service is what enforces that. Putting
 * `SuperAdminGuard` here would lock class admins out of the one admin function
 * they are meant to have.
 *
 * Note the update and delete counterparts live at `/api/events/:eventId`, not
 * under `/api/admin` — creation is the only event route the source filed as
 * administrative, which is a quirk of the route layout rather than of the
 * permission model. Both use the same check.
 */
@Controller('admin/schools')
@UseGuards(JwtAuthGuard)
export class AdminEventsController {
  constructor(private readonly events: EventsService) {}

  @Post(':schoolId/classes/:classId/events')
  create(
    @Param('schoolId') schoolId: string,
    @Param('classId') classId: string,
    @Body() body: UpdateEventDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.events.createEvent(schoolId, classId, body ?? {}, user);
  }
}

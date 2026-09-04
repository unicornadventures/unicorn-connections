import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { EventsService } from './events.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

/**
 * `GET /api/schools/:schoolId/classes/:classId/events` — the class calendar,
 * and the only events route the frontend actually calls (`WelcomePage.tsx`).
 *
 * Owned by EventsModule despite living under `/api/schools`, the same way
 * `SchoolClassesController` is owned by ClassesModule: the path reflects the
 * hierarchy, the module reflects the data. It is four segments deep, so it
 * cannot collide with `SchoolsController`'s `@Get(':schoolId')` or
 * `SchoolClassesController`'s `@Get(':schoolId/classes')`.
 *
 * Unlike the class directory there is no membership check — any authenticated
 * user can list any class's events. That is deployed behaviour; docs §9.2.
 */
@Controller('schools')
@UseGuards(JwtAuthGuard)
export class SchoolClassEventsController {
  constructor(private readonly events: EventsService) {}

  @Get(':schoolId/classes/:classId/events')
  list(
    @Param('schoolId') schoolId: string,
    @Param('classId') classId: string,
  ) {
    return this.events.listEvents(schoolId, classId);
  }
}

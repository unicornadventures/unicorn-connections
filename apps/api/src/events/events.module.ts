import { Module } from '@nestjs/common';
import { EventsController } from './events.controller.js';
import { SchoolClassEventsController } from './school-class-events.controller.js';
import { AdminEventsController } from './admin-events.controller.js';
import { EventsService } from './events.service.js';
import { EventsRepository } from './events.repository.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ClassScopeModule } from '../common/class-scope/class-scope.module.js';

/**
 * Three controllers over one service. Event creation lives under
 * `/api/admin/schools`, while update and delete live at `/api/events/:eventId`
 * — a quirk of the source's route layout, not of the permission model; all
 * three run the same `canManageEvent` check.
 */
@Module({
  imports: [ClassScopeModule],
  controllers: [
    EventsController,
    SchoolClassEventsController,
    AdminEventsController,
  ],
  providers: [EventsService, EventsRepository, JwtAuthGuard],
  exports: [EventsService, EventsRepository],
})
export class EventsModule {}

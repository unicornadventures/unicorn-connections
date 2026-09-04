import { Module } from '@nestjs/common';
import { EventsController } from './events.controller.js';
import { SchoolClassEventsController } from './school-class-events.controller.js';
import { EventsService } from './events.service.js';
import { EventsRepository } from './events.repository.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ClassScopeModule } from '../common/class-scope/class-scope.module.js';

/**
 * `EventsRepository` and `EventsService` are exported for phase 5, where
 * `POST /api/admin/schools/:schoolId/classes/:classId/events` needs the same
 * date-splitting and the same `canManageEvent` check.
 */
@Module({
  imports: [ClassScopeModule],
  controllers: [EventsController, SchoolClassEventsController],
  providers: [EventsService, EventsRepository, JwtAuthGuard],
  exports: [EventsService, EventsRepository],
})
export class EventsModule {}

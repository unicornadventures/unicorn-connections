import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { EventsService } from './events.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/auth-user.js';
import type { UpdateEventDto } from './dto/event.dto.js';

/**
 * `/api/events` — read one, edit one, delete one.
 *
 * PUT and DELETE are guarded per-event rather than by a route-level guard,
 * because the class an event belongs to is only known after the row is
 * fetched. Docs §14 is where that guard became `ClassScopeService`.
 *
 * The Express router also had `GET /class/:classId/events` and
 * `GET /class/:classId/days-until-next`. Neither is deployed and neither is
 * called anywhere in the frontend; see docs §9.4.
 */
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get(':eventId')
  getEvent(@Param('eventId') eventId: string) {
    return this.events.getEvent(eventId);
  }

  @Put(':eventId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('eventId') eventId: string,
    @Body() body: UpdateEventDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.events.updateEvent(eventId, body ?? {}, user);
  }

  @Delete(':eventId')
  @HttpCode(HttpStatus.OK)
  remove(@Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    return this.events.deleteEvent(eventId, user);
  }
}

import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { SuperAdminGuard } from '../common/guards/super-admin.guard.js';
import type { ImportUsersDto, RosterEntryDto } from './dto/admin.dto.js';
import { NumericIdPipe } from '../common/pipes/numeric-id.pipe.js';

/**
 * Roster creation, at `/api/admin/schools/:schoolId/classes/:classId/users`.
 *
 * Separate from `AdminController` only because of the prefix — these are
 * `lambda/admin.ts` handlers like the rest, but their paths hang off a school
 * and a class rather than off `/api/admin` directly.
 *
 * `/import` is declared first so the literal beats `AdminClassesController`'s
 * and this controller's parameterised siblings. It is a segment deeper than
 * the plain create, so they do not actually collide, but the order documents
 * the intent.
 *
 * These are the only two routes under `/api/admin/schools` that AdminModule
 * owns; the school, class and event routes at that prefix belong to their own
 * modules, mirroring the source's file layout.
 */
@Controller('admin/schools')
@UseGuards(SuperAdminGuard)
export class AdminRosterController {
  constructor(private readonly admin: AdminService) {}

  /** 201, and returns `{ created: <count>, skipped: [...] }`. */
  @Post(':schoolId/classes/:classId/users/import')
  importUsers(
    @Param('schoolId', NumericIdPipe) schoolId: string,
    @Param('classId', NumericIdPipe) classId: string,
    @Body() body: ImportUsersDto,
  ) {
    return this.admin.importUsers(schoolId, classId, body ?? {});
  }

  @Post(':schoolId/classes/:classId/users')
  createUser(
    @Param('schoolId', NumericIdPipe) schoolId: string,
    @Param('classId', NumericIdPipe) classId: string,
    @Body() body: RosterEntryDto,
  ) {
    return this.admin.createRosterUser(schoolId, classId, body ?? {});
  }
}

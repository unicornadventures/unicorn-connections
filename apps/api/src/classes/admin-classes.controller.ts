import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClassesService } from './classes.service.js';
import { SuperAdminGuard } from '../common/guards/super-admin.guard.js';

/**
 * `/api/admin/schools/:schoolId/classes` — linking class years to a school.
 *
 * Nothing here creates or deletes a class. Class years are global rows seeded
 * 1950→now by `schema.ts`; these routes manage the `class_school` join, which
 * is why the create body takes a `year` rather than a class id and why the
 * delete is called "unlink".
 *
 * `/bulk` is declared before the parameterised routes so the literal cannot be
 * captured as a `:classId`. It sits one segment shallower than
 * `AdminRosterController`'s `:classId/users` and `AdminEventsController`'s
 * `:classId/events`, so those do not collide either.
 */
@Controller('admin/schools')
@UseGuards(SuperAdminGuard)
export class AdminClassesController {
  constructor(private readonly classes: ClassesService) {}

  /** Links every year from `startYear` to the current one. 201. */
  @Post(':schoolId/classes/bulk')
  bulkLink(
    @Param('schoolId') schoolId: string,
    @Body() body: { startYear?: number },
  ) {
    return this.classes.bulkLinkClasses(schoolId, body?.startYear);
  }

  @Post(':schoolId/classes')
  link(
    @Param('schoolId') schoolId: string,
    @Body() body: { year?: number },
  ) {
    return this.classes.linkClassToSchool(schoolId, body?.year);
  }

  /**
   * `?cascadeUsers=true` also deletes the class's members and their photos.
   * Compared as a string, so only the exact literal triggers the destructive
   * path — anything else, including `1` or `TRUE`, leaves the users alone.
   */
  @Delete(':schoolId/classes/:classId')
  @HttpCode(HttpStatus.OK)
  unlink(
    @Param('schoolId') schoolId: string,
    @Param('classId') classId: string,
    @Query('cascadeUsers') cascadeUsers?: string,
  ) {
    return this.classes.unlinkClassFromSchool(
      schoolId,
      classId,
      cascadeUsers === 'true',
    );
  }
}

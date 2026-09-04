import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { SchoolsService } from './schools.service.js';
import { SuperAdminGuard } from '../common/guards/super-admin.guard.js';

interface SchoolBodyDto {
  name?: string;
  location?: string;
  timezone?: string;
}

/**
 * `/api/admin/schools` — school CRUD.
 *
 * Owned by SchoolsModule rather than AdminModule, matching §3.2's map
 * (`SchoolsModule ← schoolRoutes + adminSchoolRoutes`) and the source, where
 * these are `lambda/schools.ts` handlers alongside the public reads. Three
 * other controllers also mount under `/api/admin/schools` — classes, events,
 * and AdminModule's roster routes — each owning the paths that belong to its
 * own data. All are deeper than the two here, so none collide.
 */
@Controller('admin/schools')
@UseGuards(SuperAdminGuard)
export class AdminSchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Post()
  create(@Body() body: SchoolBodyDto) {
    return this.schools.createSchool(
      body?.name,
      body?.location,
      body?.timezone,
    );
  }

  @Put(':schoolId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('schoolId') schoolId: string,
    @Body() body: SchoolBodyDto,
  ) {
    return this.schools.updateSchool(
      schoolId,
      body?.name,
      body?.location,
      body?.timezone,
    );
  }

  /** Deletes the school, every user at it, and their photos. */
  @Delete(':schoolId')
  @HttpCode(HttpStatus.OK)
  remove(@Param('schoolId') schoolId: string) {
    return this.schools.deleteSchool(schoolId);
  }
}

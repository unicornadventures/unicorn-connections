import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SchoolsService } from './schools.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

/**
 * `/api/schools` — the two deployed read endpoints.
 *
 * The guards are uneven and that is deliberate: `listSchoolsHandler` never
 * calls `getAuthUser`, while `getSchoolHandler` does. The school picker on the
 * signed-out join page depends on the list being public, so locking it down
 * would break signup; requiring a token for a single school when the whole list
 * is public protects nothing but is what is deployed. Both are reproduced
 * exactly, and the inconsistency is recorded in docs §9.2.
 *
 * `POST /api/schools` existed in the Express router — unauthenticated school
 * creation — but was never deployed and is not ported. The deployed way to
 * create a school is `POST /api/admin/schools`, behind an admin check, in
 * phase 5. See docs §9.4.
 *
 * `GET /api/schools/:schoolId/classes` is also under this prefix but is owned
 * by ClassesModule, which is where the source puts it too.
 */
@Controller('schools')
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Get()
  list() {
    return this.schools.listSchools();
  }

  @Get(':schoolId')
  @UseGuards(JwtAuthGuard)
  getSchool(@Param('schoolId') schoolId: string) {
    return this.schools.getSchool(schoolId);
  }
}

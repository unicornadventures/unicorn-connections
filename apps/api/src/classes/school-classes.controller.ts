import { Controller, Get, Param } from '@nestjs/common';
import { ClassesService } from './classes.service.js';

/**
 * `GET /api/schools/:schoolId/classes`.
 *
 * Lives in ClassesModule despite its path, mirroring the source, where this
 * handler is `lambda/classes.ts`'s `listClassesHandler` rather than anything in
 * `schools.ts`. It returns classes, its ordering and member counts belong with
 * the other class queries, and putting it here keeps one repository owning
 * `class_school`.
 *
 * Unauthenticated, like the deployed handler: the join page needs a class list
 * before anyone has a token. Nest resolves this against SchoolsController's
 * `@Get(':schoolId')` by specificity of path depth, so the two do not collide
 * regardless of module import order.
 */
@Controller('schools')
export class SchoolClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get(':schoolId/classes')
  listSchoolClasses(@Param('schoolId') schoolId: string) {
    return this.classes.listSchoolClasses(schoolId);
  }
}

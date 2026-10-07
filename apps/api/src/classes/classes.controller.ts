import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ClassesService } from './classes.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { NumericIdPipe } from '../common/pipes/numeric-id.pipe.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/auth-user.js';

/**
 * `/api/classes` — five deployed read endpoints, all behind a token.
 *
 * `GET /:classId` is declared last on purpose. Nest matches in declaration
 * order, so listing it first would swallow `/members`, `/directory` and
 * `/photos` — the same trap `classRoutes.ts` warns about with its "must come
 * last" comment.
 *
 * The Express router also had `/:id/alumni-count` and `/:id/message-count`.
 * Neither is deployed and neither is referenced anywhere in the frontend, so
 * they are not ported.
 */
@Controller('classes')
@UseGuards(JwtAuthGuard)
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get()
  list() {
    return this.classes.listAllClasses();
  }

  @Get(':classId/members')
  getMembers(@Param('classId', NumericIdPipe) classId: string) {
    return this.classes.getMembers(classId);
  }

  @Get(':classId/directory')
  getDirectory(
    @Param('classId', NumericIdPipe) classId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.classes.getDirectory(classId, user);
  }

  @Get(':classId/photos')
  getPhotos(@Param('classId', NumericIdPipe) classId: string, @CurrentUser() user: AuthUser) {
    return this.classes.getPhotos(classId, user);
  }

  /**
   * The class photo page: gallery uploads only, paginated, oldest or newest
   * first. `/photos` above stays as it is — it feeds the slideshow, which
   * shuffles the whole set and needs then/now portraits that this one cannot
   * order by date. See `getGalleryPhotos`.
   */
  @Get(':classId/gallery-photos')
  getGalleryPhotos(
    @Param('classId', NumericIdPipe) classId: string,
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, string>,
  ) {
    return this.classes.getGalleryPhotos(classId, user, query);
  }

  @Get(':classId')
  getClass(@Param('classId', NumericIdPipe) classId: string) {
    return this.classes.getClass(classId);
  }
}

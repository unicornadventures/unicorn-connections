import { Module } from '@nestjs/common';
import { ClassesController } from './classes.controller.js';
import { SchoolClassesController } from './school-classes.controller.js';
import { AdminClassesController } from './admin-classes.controller.js';
import { ClassesService } from './classes.service.js';
import { ClassesRepository } from './classes.repository.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { SuperAdminGuard } from '../common/guards/super-admin.guard.js';
import { PhotosModule } from '../photos/photos.module.js';

/**
 * Three controllers, one service: the class-scoped routes under `/api/classes`,
 * the school class list under `/api/schools`, and the link management under
 * `/api/admin/schools`. One `ClassesRepository` owns every `class_school` and
 * `class_user` query, which is the point — a second copy of them is how the
 * source ended up with the drift this port is undoing.
 */
@Module({
  imports: [PhotosModule],
  controllers: [
    ClassesController,
    SchoolClassesController,
    AdminClassesController,
  ],
  providers: [
    ClassesService,
    ClassesRepository,
    JwtAuthGuard,
    SuperAdminGuard,
  ],
  exports: [ClassesService, ClassesRepository],
})
export class ClassesModule {}

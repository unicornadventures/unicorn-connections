import { Module } from '@nestjs/common';
import { ClassesController } from './classes.controller.js';
import { SchoolClassesController } from './school-classes.controller.js';
import { ClassesService } from './classes.service.js';
import { ClassesRepository } from './classes.repository.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PhotoUrlModule } from '../photos/photo-url.module.js';

/**
 * Two controllers, one service: the class-scoped routes under `/api/classes`
 * and the one that hangs off `/api/schools`. `ClassesRepository` is exported
 * because phase 3's events and phase 5's admin class management both need the
 * same `class_school` / `class_user` queries, and a second copy of them is how
 * the source ended up with the drift this port is undoing.
 */
@Module({
  imports: [PhotoUrlModule],
  controllers: [ClassesController, SchoolClassesController],
  providers: [ClassesService, ClassesRepository, JwtAuthGuard],
  exports: [ClassesService, ClassesRepository],
})
export class ClassesModule {}

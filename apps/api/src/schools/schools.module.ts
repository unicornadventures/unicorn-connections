import { Module } from '@nestjs/common';
import { SchoolsController } from './schools.controller.js';
import { AdminSchoolsController } from './admin-schools.controller.js';
import { SchoolsService } from './schools.service.js';
import { SchoolsRepository } from './schools.repository.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { SuperAdminGuard } from '../common/guards/super-admin.guard.js';
import { PhotosModule } from '../photos/photos.module.js';

/** `PhotosModule` supplies `S3Service` — deleting a school sweeps its photos. */
@Module({
  imports: [PhotosModule],
  controllers: [SchoolsController, AdminSchoolsController],
  providers: [
    SchoolsService,
    SchoolsRepository,
    JwtAuthGuard,
    SuperAdminGuard,
  ],
  exports: [SchoolsService, SchoolsRepository],
})
export class SchoolsModule {}

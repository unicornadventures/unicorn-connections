import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminRosterController } from './admin-roster.controller.js';
import { AdminService } from './admin.service.js';
import { AdminRepository } from './admin.repository.js';
import { AdminGuard } from '../common/guards/admin.guard.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { SuperAdminGuard } from '../common/guards/super-admin.guard.js';
import { ClassScopeModule } from '../common/class-scope/class-scope.module.js';
import { PhotosModule } from '../photos/photos.module.js';

/**
 * `PhotosModule` is imported for `S3Service` — deleting a user sweeps their
 * profile photos out of the bucket.
 */
@Module({
  imports: [ClassScopeModule, PhotosModule],
  controllers: [AdminController, AdminRosterController],
  providers: [
    AdminService,
    AdminRepository,
    JwtAuthGuard,
    AdminGuard,
    SuperAdminGuard,
  ],
  exports: [AdminService],
})
export class AdminModule {}

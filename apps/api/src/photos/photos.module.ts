import { Module } from '@nestjs/common';
import { PhotosController } from './photos.controller.js';
import { PhotoPresignController } from './photo-presign.controller.js';
import { PhotosService } from './photos.service.js';
import { PhotosRepository } from './photos.repository.js';
import { S3Service } from './s3.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ClassScopeModule } from '../common/class-scope/class-scope.module.js';

/**
 * `S3Service` is exported because Users and Classes resolve photo keys into
 * presigned URLs on their own read paths, and phase 5's school/class deletes
 * will need `deleteFolder`. It is the one place an S3 client is constructed —
 * phase 2's stopgap `PhotoUrlModule` was folded into this module rather than
 * left beside it, which was the phase-3 handover note.
 */
@Module({
  imports: [ClassScopeModule],
  controllers: [PhotosController, PhotoPresignController],
  providers: [PhotosService, PhotosRepository, S3Service, JwtAuthGuard],
  exports: [PhotosService, S3Service],
})
export class PhotosModule {}

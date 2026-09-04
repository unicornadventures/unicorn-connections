import { Module } from '@nestjs/common';
import { PhotoUrlService } from './photo-url.service.js';

/**
 * The read half of the eventual PhotosModule (docs §3.2), split out because
 * Users and Classes need presigned URLs in phase 2 while uploads, deletes and
 * gallery CRUD are phase 4.
 *
 * When PhotosModule arrives it should absorb this rather than sit beside it —
 * two modules owning one S3 client is exactly the duplication this port exists
 * to remove.
 */
@Module({
  providers: [PhotoUrlService],
  exports: [PhotoUrlService],
})
export class PhotoUrlModule {}

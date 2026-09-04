import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PhotosService } from './photos.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

/**
 * `GET /api/photos/presigned?key=…` — a viewing URL for an arbitrary key.
 *
 * Its own controller because it is the only route under `/api/photos`; the rest
 * of the module hangs off `/api/users`.
 *
 * The handler's doc comment in the source calls this
 * `GET /api/photos/{photoKey}/presigned`, but `template.yaml` routes
 * `/api/photos/presigned` and the key arrives as a query parameter. The
 * template is what API Gateway serves, so the query-parameter form is the
 * contract.
 */
@Controller('photos')
@UseGuards(JwtAuthGuard)
export class PhotoPresignController {
  constructor(private readonly photos: PhotosService) {}

  @Get('presigned')
  createViewUrl(@Query('key') key?: string) {
    return this.photos.createViewUrl(key);
  }
}

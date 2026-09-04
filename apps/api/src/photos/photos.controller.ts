import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { PhotosService } from './photos.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/auth-user.js';

/**
 * The photo routes that hang off a user, at `/api/users/:userId/…`.
 *
 * This is the **third** controller mounted at `/api/users`, after
 * `UsersController` and `UserCommentsController` — the source mounted three
 * routers at that prefix too (docs §2.2). Every path here is at least two
 * segments deeper than `UsersController`'s `@Get(':userId')`, so none collide;
 * `PhotosModule` still follows `UsersModule` in AppModule for the §5.3 reason.
 *
 * `POST /:userId/photo/:photoType` does **not** accept a file. It returns a
 * presigned URL the browser then PUTs to directly. The Express router had a
 * multipart handler on this exact path, which is the single most misleading
 * thing in the source: same method, same path, completely different contract.
 * The deployed one wins (§14) — see docs §17.
 *
 * Not ported, neither being deployed nor called by the frontend (docs §9.4):
 * `POST /:userId/photo/upload/:photoType` and `PUT /:userId/photo/:photoType`.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  /** 200, not 201 — it creates a URL, not a resource. */
  @Post(':userId/photo/:photoType')
  @HttpCode(HttpStatus.OK)
  createUploadUrl(
    @Param('userId') userId: string,
    @Param('photoType') photoType: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.photos.createPhotoUploadUrl(userId, photoType, user);
  }

  @Delete(':userId/photo/:photoType')
  @HttpCode(HttpStatus.OK)
  deletePhoto(
    @Param('userId') userId: string,
    @Param('photoType') photoType: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.photos.deletePhoto(userId, photoType, user);
  }

  @Get(':userId/gallery')
  listGallery(
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.photos.listGallery(userId, user);
  }

  /** Also 200 rather than 201, matching the deployed handler. */
  @Post(':userId/gallery')
  @HttpCode(HttpStatus.OK)
  createGalleryUploadUrl(
    @Param('userId') userId: string,
    @Body() body: { caption?: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.photos.createGalleryUploadUrl(userId, body?.caption, user);
  }

  @Put(':userId/gallery/:photoId')
  @HttpCode(HttpStatus.OK)
  updateCaption(
    @Param('userId') userId: string,
    @Param('photoId') photoId: string,
    @Body() body: { caption?: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.photos.updateCaption(userId, photoId, body?.caption, user);
  }

  @Delete(':userId/gallery/:photoId')
  @HttpCode(HttpStatus.OK)
  deleteGalleryPhoto(
    @Param('userId') userId: string,
    @Param('photoId') photoId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.photos.deleteGalleryPhoto(userId, photoId, user);
  }
}

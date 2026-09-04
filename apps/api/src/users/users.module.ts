import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { UsersRepository } from './users.repository.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PhotosModule } from '../photos/photos.module.js';

/**
 * Profiles live here rather than in a separate ProfilesModule (docs §3.2 left
 * that open). There is no endpoint that touches a profile without also touching
 * its user — they are 1:1 and always read through the same join — so splitting
 * them would produce two modules that could never be used apart.
 */
@Module({
  imports: [PhotosModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, JwtAuthGuard],
  exports: [UsersService],
})
export class UsersModule {}

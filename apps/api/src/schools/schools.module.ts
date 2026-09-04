import { Module } from '@nestjs/common';
import { SchoolsController } from './schools.controller.js';
import { SchoolsService } from './schools.service.js';
import { SchoolsRepository } from './schools.repository.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@Module({
  controllers: [SchoolsController],
  providers: [SchoolsService, SchoolsRepository, JwtAuthGuard],
  exports: [SchoolsService, SchoolsRepository],
})
export class SchoolsModule {}

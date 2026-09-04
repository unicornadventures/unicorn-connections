import { Module } from '@nestjs/common';
import { ClassScopeService } from './class-scope.service.js';

/**
 * Shared by CommentsModule and EventsModule in phase 3, and by AdminModule's
 * per-user checks in phase 5 (docs §14's `UserAdminGuard` replacement).
 */
@Module({
  providers: [ClassScopeService],
  exports: [ClassScopeService],
})
export class ClassScopeModule {}

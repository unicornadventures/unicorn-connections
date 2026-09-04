import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  configuration,
  findEnvFiles,
  validate,
} from './config/configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { TokensModule } from './tokens/tokens.module.js';
import { EmailModule } from './email/email.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { SchoolsModule } from './schools/schools.module.js';
import { ClassesModule } from './classes/classes.module.js';
import { CommentsModule } from './comments/comments.module.js';
import { EventsModule } from './events/events.module.js';
import { FeedbackModule } from './feedback/feedback.module.js';
import { PhotosModule } from './photos/photos.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // Fail the boot rather than start with a half-configured app. The Express
      // version silently fell back to defaults, which is how two different JWT
      // fallback secrets ended up in the codebase. `validate` reports every
      // missing/invalid var at once.
      validate,
      // A single .env at the monorepo root, with an optional app-local override
      // taking precedence. Searched upward from cwd rather than hardcoded to a
      // fixed depth — see findEnvFiles.
      envFilePath: findEnvFiles(),
    }),
    DatabaseModule,
    TokensModule,
    EmailModule,
    HealthModule,
    AuthModule,
    // UsersModule must stay ahead of the comments-owned controller that phase 3
    // mounts at this same `/api/users` prefix: Express matched
    // `GET /api/users/pending` against userRoutes' `GET /:id` because that
    // router was mounted first, and Nest resolves cross-controller collisions
    // by module import order too (docs §5.3).
    UsersModule,
    SchoolsModule,
    ClassesModule,
    // CommentsModule mounts controllers at /api/users as well as /api/comments,
    // which is why it follows UsersModule rather than sitting anywhere.
    CommentsModule,
    EventsModule,
    FeedbackModule,
    // The third module mounting controllers at /api/users, after UsersModule
    // and CommentsModule. Same §5.3 ordering reason.
    PhotosModule,
    // Remaining feature module lands here in phase 5:
    // AdminModule
  ],
})
export class AppModule {}

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
    // Remaining feature modules land here in phases 2–5:
    // UsersModule, SchoolsModule, ClassesModule,
    // CommentsModule, EventsModule, PhotosModule, FeedbackModule, AdminModule
  ],
})
export class AppModule {}

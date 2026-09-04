import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { PasswordResetDispatcher } from './password-reset-dispatcher.service.js';

@Global()
@Module({
  providers: [EmailService, PasswordResetDispatcher],
  exports: [EmailService, PasswordResetDispatcher],
})
export class EmailModule {}

import { Global, Module } from '@nestjs/common';
import { TokenService } from './token.service.js';

@Global()
@Module({
  providers: [TokenService],
  exports: [TokenService],
})
export class TokensModule {}

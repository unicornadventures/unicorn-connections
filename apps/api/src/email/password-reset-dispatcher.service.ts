import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service.js';

/**
 * Gets a password-reset link to a user.
 *
 * The deployed app does this asynchronously: `forgotPassword.ts` enqueues to
 * SQS and `emailWorker.ts` does the SES send. The queue exists because SES
 * sends were slowing the forgot-password response, and that reason still
 * holds, so the queue is kept.
 *
 * Locally there is no queue, so the send happens inline — which in turn hits
 * EmailService's development mode and logs the link to the console. Either way
 * the endpoint's HTTP response is identical, which is what the contract
 * requires; only the delivery path differs.
 */
@Injectable()
export class PasswordResetDispatcher {
  private readonly logger = new Logger(PasswordResetDispatcher.name);

  constructor(
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  async dispatch(email: string, token: string): Promise<void> {
    const queueUrl = this.config.get<string>('passwordResetQueueUrl');

    if (!queueUrl) {
      await this.email.sendPasswordResetEmail(email, token);
      return;
    }

    const { SQSClient, SendMessageCommand } = await import(
      '@aws-sdk/client-sqs'
    );
    // The function's only way out of the VPC is IPv6 (see "Outbound IPv6" in
    // template.yaml), and SQS answers on IPv6 only at its dual-stack hostname.
    // The SDK otherwise sends to the queue URL's own host, which is IPv4-only,
    // so that has to be switched off for the dual-stack endpoint to be used.
    const client = new SQSClient({
      region: this.config.get<string>('awsRegion') ?? 'us-east-1',
      useDualstackEndpoint: true,
      useQueueUrlAsEndpoint: false,
    });

    await client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ email, token }),
      }),
    );

    this.logger.log('Password reset email enqueued.');
  }
}

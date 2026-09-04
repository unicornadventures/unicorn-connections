import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * Port of the source's `services/emailService.ts`.
 *
 * Real sends need a verified SES sender identity, which local development does
 * not have — so when SES_FROM_EMAIL is unset the email is logged to the console
 * instead. That fallback is what makes password reset testable locally, and it
 * is deliberately kept.
 *
 * Credentials come from the default provider chain (Lambda execution role,
 * shared config). Never hardcode static keys here.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  private get fromAddress(): string | undefined {
    return process.env.SES_FROM_EMAIL;
  }

  /** True when no verified sender is configured, i.e. local development. */
  get isDevelopmentMode(): boolean {
    return !this.fromAddress;
  }

  async send(options: EmailOptions): Promise<void> {
    if (this.isDevelopmentMode) {
      this.logger.log(
        `\n📧 EMAIL SERVICE (Development Mode - AWS SES Disabled)\n` +
          `To: ${options.to}\n` +
          `Subject: ${options.subject}\n` +
          `---\n${options.html}\n---\n`,
      );
      return;
    }

    try {
      const { SESClient, SendEmailCommand } = await import(
        '@aws-sdk/client-ses'
      );
      const client = new SESClient({
        region: this.config.get<string>('awsRegion') ?? 'us-east-1',
      });

      await client.send(
        new SendEmailCommand({
          Source: this.fromAddress,
          Destination: { ToAddresses: [options.to] },
          Message: {
            Subject: { Data: options.subject, Charset: 'UTF-8' },
            Body: { Html: { Data: options.html, Charset: 'UTF-8' } },
          },
        }),
      );

      this.logger.log(`✅ Email sent to ${options.to}`);
    } catch (error) {
      this.logger.error('❌ Failed to send email', error as Error);
      throw new Error('Failed to send email');
    }
  }

  async sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
    const frontendUrl = this.config.get<string>('frontendUrl');
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    await this.send({
      to: email,
      subject: 'ClassYear - Password Reset',
      html: `
    <h2>Password Reset Request</h2>
    <p>You requested a password reset for your ClassYear account.</p>
    <p>Click the link below to reset your password (valid for 1 hour):</p>
    <p><a href="${resetLink}">${resetLink}</a></p>
    <p>If you didn't request this, you can safely ignore this email.</p>
  `,
    });
  }

  async sendVerificationEmail(
    email: string,
    verificationToken: string,
  ): Promise<void> {
    const frontendUrl = this.config.get<string>('frontendUrl');
    const verificationLink = `${frontendUrl}/verify-email?token=${verificationToken}`;

    await this.send({
      to: email,
      subject: 'ClassYear - Verify Your Email',
      html: `
    <h2>Verify Your Email</h2>
    <p>Welcome to ClassYear! Click the link below to verify your email address:</p>
    <p><a href="${verificationLink}">${verificationLink}</a></p>
    <p>This link is valid for 24 hours.</p>
  `,
    });
  }
}

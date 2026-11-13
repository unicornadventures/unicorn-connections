import { NestFactory } from '@nestjs/core';
import type { SQSHandler } from 'aws-lambda';
import { AppModule } from './app.module.js';
import { EmailService } from './email/email.service.js';

/**
 * The function that sits beside the API proxy: the password-reset email
 * worker. SAM points at its handler by name.
 *
 * There was a warmer here too, pinging the API on a schedule to keep an
 * execution environment alive. It was removed on 2026-11-13: cold starts are
 * acceptable at this site's traffic, and the database pauses regardless.
 */

// ---- password-reset email worker -----------------------------------------

/**
 * A standalone Nest context — not `NestFactory.create`, which would build an
 * HTTP server this function has no use for.
 *
 * Cached at module scope for the same reason the API handler is, and as a
 * promise rather than a resolved value so two concurrent cold invocations
 * cannot each bootstrap one.
 */
let emailContext: Promise<EmailService> | null = null;

async function getEmailService(): Promise<EmailService> {
  emailContext ??= NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
  })
    .then((ctx) => ctx.get(EmailService, { strict: false }))
    .catch((error: unknown) => {
      emailContext = null;
      throw error;
    });

  return emailContext;
}

/**
 * Consumes the queue `PasswordResetDispatcher` writes to.
 *
 * It was an open question whether to keep the queue or send inline under the single-function
 * architecture, and recommended keeping it — the queue exists because SES sends
 * were slowing the forgot-password response, and that reason still holds. This
 * is that decision implemented.
 *
 * It runs **outside the VPC**: SES has no VPC endpoint in this account, so a
 * worker inside the private subnets could not reach it. That is also why this
 * is a separate function rather than another route on the proxy.
 *
 * A throw returns the message to the queue for redelivery and, after the
 * configured attempts, to the DLQ. Swallowing errors here would lose password
 * resets silently, so failures are deliberately allowed to propagate.
 */
export const sendPasswordResetEmailHandler: SQSHandler = async (event) => {
  const email = await getEmailService();

  for (const record of event.Records) {
    const { email: address, token } = JSON.parse(record.body) as {
      email: string;
      token: string;
    };

    await email.sendPasswordResetEmail(address, token);
  }
};

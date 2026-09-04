import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { SQSHandler } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { AppModule } from './app.module.js';
import { EmailService } from './email/email.service.js';

/**
 * The two functions that sit beside the API proxy.
 *
 * They live in one file because they are ten lines each and share the same
 * cold-start caching concern; SAM points at each handler by name.
 */

// ---- warmer ---------------------------------------------------------------

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

/**
 * Keeps the API function's execution environment warm on a schedule.
 *
 * Now has **one** target instead of 59 — the single biggest simplification of
 * the port showing up in the operational layer (docs §3.1).
 *
 * The empty payload matters: the proxy rejects it as a malformed event before
 * anything touches the database, so warming never wakes the deliberately
 * pausable Aurora cluster. That property was load-bearing in the source and is
 * preserved.
 */
export const warmerHandler = async (): Promise<void> => {
  const targets = (process.env.WARM_FUNCTION_NAMES ?? '')
    .split(',')
    .filter(Boolean);

  await Promise.all(
    targets.map((FunctionName) =>
      lambdaClient
        .send(
          new InvokeCommand({
            FunctionName,
            InvocationType: 'Event',
            Payload: Buffer.from('{}'),
          }),
        )
        .catch((error: unknown) =>
          Logger.error(
            `Warm ping failed for ${FunctionName}: ${String(error)}`,
            'Warmer',
          ),
        ),
    ),
  );
};

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
 * §8.3 asked whether to keep the queue or send inline under the single-function
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

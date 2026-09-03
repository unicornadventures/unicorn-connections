import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthModule } from '../src/health/health.module.js';
import { configureApp } from '../src/bootstrap.js';

/**
 * Phase 0 gate. `/pulse` is the only route outside the /api prefix, and its
 * response shape is what the SAM warmer and uptime checks consume.
 *
 * Reference — Express (server.ts) and Lambda (lambda/pulse.ts) both return:
 *   { status: 'ok', timestamp: new Date().toISOString() }
 *
 * HealthModule is mounted alone so this needs no database.
 */
describe('/pulse (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is served at the root, not under /api', async () => {
    await request(app.getHttpServer()).get('/pulse').expect(200);
    await request(app.getHttpServer()).get('/api/pulse').expect(404);
  });

  it('returns exactly { status, timestamp } with status "ok"', async () => {
    const res = await request(app.getHttpServer()).get('/pulse').expect(200);

    expect(Object.keys(res.body).sort()).toEqual(['status', 'timestamp']);
    expect(res.body.status).toBe('ok');
  });

  it('returns an ISO-8601 timestamp', async () => {
    const res = await request(app.getHttpServer()).get('/pulse').expect(200);

    // Matches Date.prototype.toISOString() exactly, as the source produces.
    expect(res.body.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });
});

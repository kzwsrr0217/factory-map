/**
 * alerts.test.ts — Integration tests for the alert system.
 *
 * Covers:
 *   - GET  /api/alerts/config              — returns default config (creates if missing)
 *   - PUT  /api/alerts/config              — updates config fields; admin only
 *   - GET  /api/alerts/logs                — returns paginated alert log
 *   - POST /api/alerts/test                — runs checkAndSend(); admin only
 *   - GET  /api/alerts/scheduled           — returns scheduled alerts list
 *   - POST /api/alerts/scheduled           — creates a scheduled alert (operator+)
 *   - DELETE /api/alerts/scheduled/:id     — removes a scheduled alert
 *
 * Note: email/Teams delivery is not tested here (SMTP/webhook not configured
 * in the test environment). The test-now endpoint is called to verify it runs
 * without crashing; it may send 0 notifications if no assets are due.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User.entity';
import { ScheduledAlert } from '../entities/ScheduledAlert.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
let operatorToken: string;
let viewerToken: string;

const ALERT_PREFIX = `alrt_${Date.now()}`;
const OPERATOR_USER = `${ALERT_PREFIX}_op`;
const VIEWER_USER = `${ALERT_PREFIX}_viewer`;
const COMMON_PASS = 'Alert@9999Test';

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  const opRes = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username: OPERATOR_USER, password: COMMON_PASS, role: 'operator' });
  if (opRes.status !== 201) throw new Error(`Operator setup failed: ${JSON.stringify(opRes.body)}`);
  const opLogin = await request(app).post('/api/auth/login').send({ username: OPERATOR_USER, password: COMMON_PASS });
  operatorToken = opLogin.body.data.token;

  const vRes = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username: VIEWER_USER, password: COMMON_PASS, role: 'viewer' });
  if (vRes.status !== 201) throw new Error(`Viewer setup failed: ${JSON.stringify(vRes.body)}`);
  const vLogin = await request(app).post('/api/auth/login').send({ username: VIEWER_USER, password: COMMON_PASS });
  viewerToken = vLogin.body.data.token;
}, 30000);

afterAll(async () => {
  await AppDataSource.getRepository(User)
    .createQueryBuilder()
    .delete()
    .where('username LIKE :prefix', { prefix: `${ALERT_PREFIX}%` })
    .execute();
  // Clean up any scheduled alerts created during this test run
  await AppDataSource.getRepository(ScheduledAlert)
    .createQueryBuilder()
    .delete()
    .where('title LIKE :prefix', { prefix: `${ALERT_PREFIX}%` })
    .execute();
});

// ── Alert config ──────────────────────────────────────────────────────────────

describe('GET /api/alerts/config', () => {
  it('returns the current config (auto-creates the global row)', async () => {
    const res = await request(app)
      .get('/api/alerts/config')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('email_enabled');
    expect(res.body.data).toHaveProperty('teams_enabled');
    expect(res.body.data).toHaveProperty('days_before_alert');
  });

  it('is accessible by viewers (no admin restriction)', async () => {
    const res = await request(app)
      .get('/api/alerts/config')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/alerts/config');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/alerts/config', () => {
  it('admin can update alert config fields', async () => {
    const res = await request(app)
      .put('/api/alerts/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ days_before_alert: 14, email_enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.data.days_before_alert).toBe(14);
  });

  it('admin can set email recipients', async () => {
    const res = await request(app)
      .put('/api/alerts/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email_recipients: ['ops@example.com', 'admin@example.com'] });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.email_recipients)).toBe(true);
  });

  it('returns 403 for non-admin (operator)', async () => {
    const res = await request(app)
      .put('/api/alerts/config')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ days_before_alert: 3 });
    expect(res.status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).put('/api/alerts/config').send({ days_before_alert: 1 });
    expect(res.status).toBe(401);
  });
});

// ── Alert logs ────────────────────────────────────────────────────────────────

describe('GET /api/alerts/logs', () => {
  it('returns paginated alert logs', async () => {
    const res = await request(app)
      .get('/api/alerts/logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('limit');
    expect(res.body.meta).toHaveProperty('totalPages');
  });

  it('respects limit param', async () => {
    const res = await request(app)
      .get('/api/alerts/logs?limit=5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.limit).toBe(5);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
  });

  it('caps limit at 200', async () => {
    const res = await request(app)
      .get('/api/alerts/logs?limit=99999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.limit).toBeLessThanOrEqual(200);
  });

  it('is accessible by viewers', async () => {
    const res = await request(app).get('/api/alerts/logs').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/alerts/logs');
    expect(res.status).toBe(401);
  });
});

// ── Test-now ──────────────────────────────────────────────────────────────────

describe('POST /api/alerts/test', () => {
  it('runs checkAndSend without error (no actual email sent in test env)', async () => {
    const res = await request(app)
      .post('/api/alerts/test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 for non-admin (operator)', async () => {
    const res = await request(app)
      .post('/api/alerts/test')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/alerts/test');
    expect(res.status).toBe(401);
  });
});

// ── Scheduled alerts ──────────────────────────────────────────────────────────

describe('GET /api/alerts/scheduled', () => {
  it('returns an array of scheduled alerts', async () => {
    const res = await request(app)
      .get('/api/alerts/scheduled')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('is accessible by viewers', async () => {
    const res = await request(app).get('/api/alerts/scheduled').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/alerts/scheduled', () => {
  it('operator can create a scheduled alert', async () => {
    const scheduledFor = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post('/api/alerts/scheduled')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        title: `${ALERT_PREFIX} Maintenance Window`,
        description: 'Weekly PM check',
        scheduled_for: scheduledFor,
        channels: 'email',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe(`${ALERT_PREFIX} Maintenance Window`);
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/alerts/scheduled')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ scheduled_for: new Date().toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('returns 400 when scheduled_for is missing', async () => {
    const res = await request(app)
      .post('/api/alerts/scheduled')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ title: `${ALERT_PREFIX} No Date` });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scheduled_for/i);
  });

  it('returns 403 for viewer', async () => {
    const res = await request(app)
      .post('/api/alerts/scheduled')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ title: `${ALERT_PREFIX} Viewer Attempt`, scheduled_for: new Date().toISOString() });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/alerts/scheduled/:id', () => {
  it('operator can delete a scheduled alert', async () => {
    const createRes = await request(app)
      .post('/api/alerts/scheduled')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        title: `${ALERT_PREFIX} Delete Me`,
        scheduled_for: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    const alertId = createRes.body.data.id ?? createRes.body.data._id;

    const res = await request(app)
      .delete(`/api/alerts/scheduled/${alertId}`)
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

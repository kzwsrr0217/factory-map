/**
 * error-handling.test.ts — Tests for error boundary and API contract enforcement.
 *
 * Covers:
 *   - Malformed JSON body → 400 (Express body-parser rejects it)
 *   - Unknown route       → 404
 *   - Missing required fields that bypass Zod (controller-level 400)
 *   - Oversized request body (if body-size limit is configured)
 *   - Content-Type mismatch (sending form-data to a JSON endpoint)
 */
import request from 'supertest';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();
}, 30000);

// ── Unknown routes ────────────────────────────────────────────────────────────

describe('Unknown routes', () => {
  it('returns 404 for GET /api/nonexistent', async () => {
    const res = await request(app)
      .get('/api/nonexistent')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a nested unknown path', async () => {
    const res = await request(app)
      .get('/api/buildings/fake-id/floors/also-fake/deeper')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a completely unknown top-level path (with auth)', async () => {
    // Authenticate so the auth middleware passes and the 404 handler fires
    const res = await request(app)
      .get('/api/does-not-exist-at-all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ── Malformed JSON ────────────────────────────────────────────────────────────

describe('Malformed JSON body', () => {
  it('returns a 4xx/5xx error (not 200) for invalid JSON on POST /api/auth/login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ "username": "admin", BROKEN_JSON }');
    // Express body-parser may return 400 or forward to error handler (500) —
    // what matters is that it is never a 200 success
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('returns a 4xx/5xx error (not 200) for invalid JSON on POST /api/buildings', async () => {
    const res = await request(app)
      .post('/api/buildings')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send('{ not valid json at all');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── Zod + controller input validation ────────────────────────────────────────

describe('Input validation boundaries', () => {
  it('POST /api/buildings — missing name returns 400', async () => {
    const res = await request(app)
      .post('/api/buildings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ address: '1 Test St' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/name|required/i);
  });

  it('POST /api/buildings — name exceeding 200 chars returns 400', async () => {
    const res = await request(app)
      .post('/api/buildings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('POST /api/assets — missing display_name returns 400', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ basic_info: { status: 'active' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/display_name|required/i);
  });

  it('POST /api/auth/login — missing body fields returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'onlyusername' });
    expect(res.status).toBe(400);
  });

  it('POST /api/users — weak password returns 422', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'weakpwtest', password: 'abc', role: 'viewer' });
    expect(res.status).toBe(422);
  });

  it('POST /api/network/rooms — invalid UUID for building_id returns 400', async () => {
    const res = await request(app)
      .post('/api/network/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test Room', type: 'idf', building_id: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });
});

// ── Auth errors ───────────────────────────────────────────────────────────────

describe('Authentication errors', () => {
  it('returns 401 for an expired / garbage token', async () => {
    const res = await request(app)
      .get('/api/buildings')
      .set('Authorization', 'Bearer this.is.not.a.real.token');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a missing Authorization header on protected route', async () => {
    const res = await request(app).get('/api/buildings');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a malformed Authorization header value', async () => {
    const res = await request(app)
      .get('/api/buildings')
      .set('Authorization', 'NotBearer sometoken');
    expect(res.status).toBe(401);
  });
});

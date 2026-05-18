/**
 * auth.lockout.test.ts — Integration tests for account lockout and edge cases.
 *
 * Covers:
 *   - Account locks after MAX_FAILED_ATTEMPTS consecutive bad passwords (423)
 *   - Locked account returns 423 even with the correct password
 *   - Pagination safety cap: getAllAssets without page/limit returns meta.truncated + meta.limit
 *   - Zod validation: POST /assets and POST /buildings reject invalid bodies with 400
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User.entity';
import { setupTests } from './helpers/testApp';
import { MAX_FAILED_ATTEMPTS } from '../utils/passwordPolicy';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;

const LOCKOUT_USER = `lockout_${Date.now()}`;
const LOCKOUT_PASS = 'Lockout@9999';

/** Fire N consecutive bad-password login attempts for LOCKOUT_USER. */
async function fireWrongLogins(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await request(app)
      .post('/api/auth/login')
      .send({ username: LOCKOUT_USER, password: 'wrong_password_xyz' });
  }
}

/** Reset failed_login_attempts and locked_until for LOCKOUT_USER via the DB. */
async function resetLockout(): Promise<void> {
  await AppDataSource.getRepository(User).update(
    { username: LOCKOUT_USER },
    { failed_login_attempts: 0, locked_until: null as any },
  );
}

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  // Create a dedicated user for lockout tests
  const res = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username: LOCKOUT_USER, password: LOCKOUT_PASS, role: 'viewer' });
  if (res.status !== 201) {
    throw new Error(`Failed to create lockout test user: ${JSON.stringify(res.body)}`);
  }
}, 30000);

afterAll(async () => {
  await AppDataSource.getRepository(User).delete({ username: LOCKOUT_USER });
});

// ── Account lockout ───────────────────────────────────────────────────────────

describe('Account lockout', () => {
  beforeEach(resetLockout);

  it('returns "attempts remaining" on bad passwords before lockout', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: LOCKOUT_USER, password: 'wrong_password_xyz' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/attempt/i);
  });

  it(`locks the account after ${MAX_FAILED_ATTEMPTS} consecutive bad passwords`, async () => {
    // Fire MAX_FAILED_ATTEMPTS - 1 bad requests first
    await fireWrongLogins(MAX_FAILED_ATTEMPTS - 1);

    // The Nth bad attempt should trigger the lockout
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: LOCKOUT_USER, password: 'wrong_password_xyz' });
    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/locked/i);
  });

  it('rejects the correct password while the account is locked', async () => {
    // Lock the account via bad login attempts (last one sets locked_until in DB)
    await fireWrongLogins(MAX_FAILED_ATTEMPTS);

    // Even the correct password should now be rejected
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: LOCKOUT_USER, password: LOCKOUT_PASS });
    expect(res.status).toBe(423);
  });
});

// ── Pagination safety cap ─────────────────────────────────────────────────────

describe('GET /api/assets — safety cap', () => {
  it('returns meta.truncated and meta.limit when no page/limit supplied', async () => {
    const res = await request(app)
      .get('/api/assets')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.limit).toBe(1000);
    expect(typeof res.body.meta.truncated).toBe('boolean');
  });

  it('respects explicit page+limit and returns totalPages', async () => {
    const res = await request(app)
      .get('/api/assets?page=1&limit=5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(5);
    expect(res.body.meta).toHaveProperty('totalPages');
  });

  it('caps limit at 500 when an excessive limit is requested', async () => {
    const res = await request(app)
      .get('/api/assets?page=1&limit=99999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.limit).toBeLessThanOrEqual(500);
  });
});

// ── Zod validation ────────────────────────────────────────────────────────────

describe('POST /api/assets — Zod input validation', () => {
  it('returns 400 when display_name is missing', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ basic_info: { status: 'active' } });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/display_name|required/i);
  });

  it('returns 400 when display_name exceeds 200 characters', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ basic_info: { display_name: 'x'.repeat(201) } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for bulk import with zero assets', async () => {
    const res = await request(app)
      .post('/api/assets/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assets: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/buildings — Zod input validation', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/buildings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ address: '123 Test St' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name|required/i);
  });
});

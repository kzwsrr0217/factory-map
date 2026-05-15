/**
 * assets.test.ts — Integration tests for /api/assets CRUD.
 *
 * Asset creation uses the nested body format required by applyBodyToAsset():
 *   { basic_info: { display_name: '...' }, location: { building_id: '...' } }
 */
import request from 'supertest';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;
let createdId: string;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();
}, 30000);

describe('GET /api/assets', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/assets');
    expect(res.status).toBe(401);
  });

  it('returns an asset list', async () => {
    const res = await request(app)
      .get('/api/assets')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('supports search query parameter', async () => {
    const res = await request(app)
      .get('/api/assets?search=test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/assets/lookups', () => {
  it('returns lookup arrays', async () => {
    const res = await request(app)
      .get('/api/assets/lookups')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/assets', () => {
  it('creates an asset with nested body', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        basic_info: {
          display_name: '__test_asset__',
          asset_type: 'IPC',
          status: 'active',
        },
      });
    expect(res.status).toBe(201);
    const data = res.body.data ?? res.body;
    expect(data.basic_info?.display_name ?? data.display_name).toBe('__test_asset__');
    createdId = data._id ?? data.id;
    expect(createdId).toBeDefined();
  });

  it('returns 400 when display_name is missing', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ basic_info: {} });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /api/assets/:id', () => {
  it('returns the created asset by id', async () => {
    if (!createdId) return;
    const res = await request(app)
      .get(`/api/assets/${createdId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/assets/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/assets/:id', () => {
  it('updates asset fields', async () => {
    if (!createdId) return;
    const res = await request(app)
      .patch(`/api/assets/${createdId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ basic_info: { display_name: '__test_asset_updated__' } });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/assets/:id', () => {
  it('deletes the asset', async () => {
    if (!createdId) return;
    const res = await request(app)
      .delete(`/api/assets/${createdId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

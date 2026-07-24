/**
 * entity-kinds.test.ts — Integration tests for the read-only EntityKind
 * listing endpoint (see backend/src/entities/EntityKind.entity.ts,
 * controllers/entityKind.controller.ts). No CRUD exists for this resource —
 * rows are inserted/removed directly via the repository, mirroring how the
 * seed script populates it.
 *
 * Covers:
 *   - GET /api/entity-kinds — returns seeded rows; 401 without auth.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { EntityKind } from '../entities/EntityKind.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;

const KIND_VALUE = `test_kind_${Date.now()}`;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  await AppDataSource.getRepository(EntityKind).save(
    AppDataSource.getRepository(EntityKind).create({
      value: KIND_VALUE,
      label: 'Test Kind',
      geometry_type: 'point',
      default_color: '#123456',
      rotatable: true,
      exempt_from_orphan: false,
    })
  );
}, 30000);

afterAll(async () => {
  await AppDataSource.getRepository(EntityKind).delete({ value: KIND_VALUE });
});

describe('GET /api/entity-kinds', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/entity-kinds');
    expect(res.status).toBe(401);
  });

  it('returns an array including the seeded kind', async () => {
    const res = await request(app).get('/api/entity-kinds').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find((k: { value: string }) => k.value === KIND_VALUE);
    expect(found).toBeDefined();
    expect(found.label).toBe('Test Kind');
    expect(found.rotatable).toBe(true);
    expect(found.default_color).toBe('#123456');
  });
});

/**
 * production-lines.test.ts — Integration tests for the read-only
 * ProductionLine listing endpoint (see
 * backend/src/entities/ProductionLine.entity.ts,
 * controllers/productionLine.controller.ts). No CRUD exists for this
 * resource — rows are inserted/removed directly via the repository.
 *
 * Covers:
 *   - GET /api/production-lines — returns seeded rows; 401 without auth.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { ProductionLine } from '../entities/ProductionLine.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;

const PL_CODE = `test_pl_${Date.now()}`;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  await AppDataSource.getRepository(ProductionLine).save(
    AppDataSource.getRepository(ProductionLine).create({ code: PL_CODE, description: 'Test Production Line' })
  );
}, 30000);

afterAll(async () => {
  await AppDataSource.getRepository(ProductionLine).delete({ code: PL_CODE });
});

describe('GET /api/production-lines', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/production-lines');
    expect(res.status).toBe(401);
  });

  it('returns an array including the seeded production line', async () => {
    const res = await request(app).get('/api/production-lines').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find((p: { code: string }) => p.code === PL_CODE);
    expect(found).toBeDefined();
    expect(found.description).toBe('Test Production Line');
  });
});

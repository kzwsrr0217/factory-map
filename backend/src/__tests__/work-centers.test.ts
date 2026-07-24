/**
 * work-centers.test.ts — Integration tests for the read-only WorkCenter
 * listing endpoint (see backend/src/entities/WorkCenter.entity.ts,
 * controllers/workCenter.controller.ts). No CRUD exists for this resource —
 * rows are inserted/removed directly via the repository.
 *
 * Covers:
 *   - GET /api/work-centers — returns seeded rows (incl. production_line_code
 *     soft join); 401 without auth.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { ProductionLine } from '../entities/ProductionLine.entity';
import { WorkCenter } from '../entities/WorkCenter.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;

const PL_CODE = `test_wc_pl_${Date.now()}`;
const WC_CODE = `test_wc_${Date.now()}`;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  await AppDataSource.getRepository(ProductionLine).save(
    AppDataSource.getRepository(ProductionLine).create({ code: PL_CODE, description: 'WC Test PL' })
  );
  await AppDataSource.getRepository(WorkCenter).save(
    AppDataSource.getRepository(WorkCenter).create({ code: WC_CODE, description: 'Test Work Center', production_line_code: PL_CODE })
  );
}, 30000);

afterAll(async () => {
  await AppDataSource.getRepository(WorkCenter).delete({ code: WC_CODE });
  await AppDataSource.getRepository(ProductionLine).delete({ code: PL_CODE });
});

describe('GET /api/work-centers', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/work-centers');
    expect(res.status).toBe(401);
  });

  it('returns an array including the seeded work center with its production_line_code', async () => {
    const res = await request(app).get('/api/work-centers').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const found = res.body.data.find((w: { code: string }) => w.code === WC_CODE);
    expect(found).toBeDefined();
    expect(found.description).toBe('Test Work Center');
    expect(found.production_line_code).toBe(PL_CODE);
  });
});

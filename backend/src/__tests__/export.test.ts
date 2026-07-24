/**
 * export.test.ts — Integration tests for GET /api/export/shopfloor-visualizer.
 *
 * See backend/src/controllers/export.controller.ts — this endpoint has no
 * live IFS/Databricks connection; it only reads factorymap's own tables and
 * reshapes them into the JSON files shopfloor_visualizer reads from disk.
 * MasterAsset/ProductionLine/WorkCenter/EntityKind rows are inserted
 * directly via the repository, mirroring the pattern in assets.test.ts /
 * production-lines.test.ts / work-centers.test.ts.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { MasterAsset } from '../entities/MasterAsset.entity';
import { ProductionLine } from '../entities/ProductionLine.entity';
import { WorkCenter } from '../entities/WorkCenter.entity';
import { EntityKind } from '../entities/EntityKind.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;

const PREFIX = `export_test_${Date.now()}`;
const MACHINE_IFS_ID = `${PREFIX}-1`;
const IT_DEVICE_IFS_ID = `444444-${PREFIX}`;
const PL_CODE = `${PREFIX}_pl`;
const WC_CODE = `${PREFIX}_wc`;
const EK_VALUE = `${PREFIX}_kind`;

let buildingId: string;
let floorId: string;
let assetId: string;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();

  await AppDataSource.getRepository(ProductionLine).save(
    AppDataSource.getRepository(ProductionLine).create({ code: PL_CODE, description: 'Export Test Line' })
  );
  await AppDataSource.getRepository(WorkCenter).save(
    AppDataSource.getRepository(WorkCenter).create({ code: WC_CODE, description: 'Export Test WC', production_line_code: PL_CODE })
  );
  await AppDataSource.getRepository(EntityKind).save(
    AppDataSource.getRepository(EntityKind).create({ value: EK_VALUE, label: 'Export Test Kind', geometry_type: 'point', default_color: '#123456' })
  );
  // A plain machine (ifs_machine_id === ifs_id) and an IT-managed device
  // attached to it (ifs_machine_id points back) — mirrors seed-mssql.ts.
  await AppDataSource.getRepository(MasterAsset).save([
    AppDataSource.getRepository(MasterAsset).create({
      ifs_id: MACHINE_IFS_ID, ifs_machine_id: MACHINE_IFS_ID, ifs_site: 'TESTSITE',
      ifs_production_line_id: PL_CODE, ifs_workcenter_id: WC_CODE, ifs_workcenter_description: 'Export Test WC',
    }),
    AppDataSource.getRepository(MasterAsset).create({
      ifs_id: IT_DEVICE_IFS_ID, ifs_machine_id: MACHINE_IFS_ID, cmdb_status: 'Deployed', cmdb_id: 'HWA00000',
    }),
  ]);

  const bRes = await request(app)
    .post('/api/buildings')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: PREFIX });
  buildingId = bRes.body.data._id;

  const fRes = await request(app)
    .post('/api/floors')
    .set('Authorization', `Bearer ${token}`)
    .send({ building_id: buildingId, floor_number: 1, name: 'Export Test Floor' });
  floorId = fRes.body.data._id;
  await request(app)
    .patch(`/api/floors/${floorId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ svg_ref: 'werk1-ground-floor.svg', scale_meters_per_unit: 1 });

  const aRes = await request(app)
    .post('/api/assets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      basic_info: { display_name: '__export_test_asset__' },
      master_ifs_id: MACHINE_IFS_ID,
      entity_kind: EK_VALUE,
      hierarchy: { floor_id: floorId },
      location: { coordinates: { x: 12, y: 34 }, rotation: 45 },
    });
  assetId = aRes.body.data._id;
}, 30000);

afterAll(async () => {
  if (assetId) await request(app).delete(`/api/assets/${assetId}`).set('Authorization', `Bearer ${token}`);
  if (floorId) await request(app).delete(`/api/floors/${floorId}`).set('Authorization', `Bearer ${token}`);
  if (buildingId) await request(app).delete(`/api/buildings/${buildingId}`).set('Authorization', `Bearer ${token}`);
  await AppDataSource.getRepository(MasterAsset).delete({ ifs_id: MACHINE_IFS_ID });
  await AppDataSource.getRepository(MasterAsset).delete({ ifs_id: IT_DEVICE_IFS_ID });
  await AppDataSource.getRepository(EntityKind).delete({ value: EK_VALUE });
  await AppDataSource.getRepository(WorkCenter).delete({ code: WC_CODE });
  await AppDataSource.getRepository(ProductionLine).delete({ code: PL_CODE });
});

describe('GET /api/export/shopfloor-visualizer', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/export/shopfloor-visualizer');
    expect(res.status).toBe(401);
  });

  it('returns all seven file shapes plus svg files', async () => {
    const res = await request(app)
      .get('/api/export/shopfloor-visualizer')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { files, svgFiles } = res.body.data;
    expect(Object.keys(files).sort()).toEqual([
      'OTAssetData.json',
      'entity_kinds.json',
      'example_features.json',
      'masterData.json',
      'production_lines.json',
      'sites.json',
      'workcenters.json',
    ].sort());
    expect(svgFiles['werk1-ground-floor.svg']).toContain('<svg');
  });

  it('splits MasterAsset rows into machines (masterData.json) vs. IT devices (OTAssetData.json)', async () => {
    const res = await request(app)
      .get('/api/export/shopfloor-visualizer')
      .set('Authorization', `Bearer ${token}`);
    const { files } = res.body.data;

    const machine = files['masterData.json'].assets.find((m: { ifs_machine_id: string }) => m.ifs_machine_id === MACHINE_IFS_ID);
    expect(machine).toBeDefined();
    expect(machine.ifs_production_line_id).toBe(PL_CODE);
    expect(machine.ifs_workcenter_id).toBe(WC_CODE);

    const otDevice = files['OTAssetData.json'].assets.find((a: { ifs_id: string }) => a.ifs_id === IT_DEVICE_IFS_ID);
    expect(otDevice).toBeDefined();
    expect(otDevice.parent_id).toBe(MACHINE_IFS_ID);
    expect(otDevice.cmdb_status).toBe('Deployed');

    // The IT device must not also appear as a machine, and vice versa
    expect(files['masterData.json'].assets.find((m: { ifs_machine_id: string }) => m.ifs_machine_id === IT_DEVICE_IFS_ID)).toBeUndefined();
    expect(files['OTAssetData.json'].assets.find((a: { ifs_id: string }) => a.ifs_id === MACHINE_IFS_ID)).toBeUndefined();
  });

  it('includes the production line, work center, and entity kind', async () => {
    const res = await request(app)
      .get('/api/export/shopfloor-visualizer')
      .set('Authorization', `Bearer ${token}`);
    const { files } = res.body.data;

    expect(files['production_lines.json'].find((p: { ProductionLine: string }) => p.ProductionLine === PL_CODE)).toBeDefined();
    const wc = files['workcenters.json'].find((w: { WorkCenterNo: string }) => w.WorkCenterNo === WC_CODE);
    expect(wc).toBeDefined();
    expect(wc.ProductionLine).toBe(PL_CODE);
    const ek = files['entity_kinds.json'].entityKinds.find((k: { value: string }) => k.value === EK_VALUE);
    expect(ek).toBeDefined();
    expect(ek.geometryType).toBe('point');
    expect(ek.defaultColor).toBe('#123456');
  });

  it('emits the floor under sites.json with its svgRef, and the placed asset as a feature', async () => {
    const res = await request(app)
      .get('/api/export/shopfloor-visualizer')
      .set('Authorization', `Bearer ${token}`);
    const { files } = res.body.data;

    const building = files['sites.json'].sites[0].buildings.find((b: { id: string }) => b.id === buildingId);
    expect(building).toBeDefined();
    const floor = building.floors.find((f: { id: string }) => f.id === floorId);
    expect(floor).toBeDefined();
    expect(floor.floorPlan).toEqual({ svgRef: 'werk1-ground-floor.svg', scaleMetersPerUnit: 1 });

    const feature = files['example_features.json'].features.find((f: { objectId: string }) => f.objectId === MACHINE_IFS_ID);
    expect(feature).toBeDefined();
    expect(feature.floorId).toBe(floorId);
    expect(feature.entityKind).toBe(EK_VALUE);
    expect(feature.geometry).toEqual({ type: 'point', closed: false, coords: [[12, 34]] });
    expect(feature.rotationDeg).toBe(45);
  });
});

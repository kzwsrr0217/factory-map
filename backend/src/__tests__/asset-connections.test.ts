/**
 * asset-connections.test.ts — Integration tests for asset connection management.
 *
 * Covers:
 *   - POST   /api/assets/:id/connections                   — add connection
 *   - PATCH  /api/assets/:id/connections/:connectedAssetId — update description/label
 *   - DELETE /api/assets/:id/connections/:connectedAssetId — remove connection
 *
 * Edge cases:
 *   - Duplicate connection returns 400
 *   - Remove also clears reverse direction
 *   - 404 when the source asset doesn't exist
 *   - 404 when trying to update/remove a non-existent connection
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;

/** IDs created by this suite — cleaned up in afterAll */
const createdAssetIds: string[] = [];

async function createAsset(name: string): Promise<string> {
  const res = await request(app)
    .post('/api/assets')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ basic_info: { display_name: name } });
  if (res.status !== 201) throw new Error(`Asset creation failed: ${JSON.stringify(res.body)}`);
  const id = res.body.data._id ?? res.body.data.id;
  createdAssetIds.push(id);
  return id;
}

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();
}, 30000);

afterAll(async () => {
  if (createdAssetIds.length > 0) {
    await AppDataSource.getRepository(Asset)
      .createQueryBuilder()
      .delete()
      .whereInIds(createdAssetIds)
      .execute();
  }
});

// ── Add connection ────────────────────────────────────────────────────────────

describe('POST /api/assets/:id/connections', () => {
  it('adds a connection between two assets', async () => {
    const srcId = await createAsset('Conn Source A');
    const dstId = await createAsset('Conn Target A');

    const res = await request(app)
      .post(`/api/assets/${srcId}/connections`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ connected_asset_id: dstId, connection_type: 'network', label: 'LAN-1' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const conn = res.body.data.connections.find((c: any) => c.connected_asset_id === dstId);
    expect(conn).toBeDefined();
    expect(conn.connection_type).toBe('network');
    expect(conn.label).toBe('LAN-1');
  });

  it('returns 400 when the connection already exists', async () => {
    const srcId = await createAsset('Conn Source B');
    const dstId = await createAsset('Conn Target B');

    await request(app)
      .post(`/api/assets/${srcId}/connections`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ connected_asset_id: dstId, connection_type: 'power' });

    const res = await request(app)
      .post(`/api/assets/${srcId}/connections`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ connected_asset_id: dstId, connection_type: 'power' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('returns 404 when source asset does not exist', async () => {
    const res = await request(app)
      .post('/api/assets/00000000-0000-0000-0000-000000000000/connections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ connected_asset_id: '00000000-0000-0000-0000-000000000001', connection_type: 'network' });
    expect(res.status).toBe(404);
  });

  it('stores patch_panel metadata on the connection', async () => {
    const srcId = await createAsset('Patch Src');
    const dstId = await createAsset('Patch Dst');

    const res = await request(app)
      .post(`/api/assets/${srcId}/connections`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        connected_asset_id: dstId,
        connection_type: 'copper',
        patch_panel: { panel_name: 'PP-01', panel_port: '3A', switch_name: 'SW-Core', switch_port: 'Gi1/0/3' },
      });

    expect(res.status).toBe(201);
    const conn = res.body.data.connections.find((c: any) => c.connected_asset_id === dstId);
    expect(conn.patch_panel).toMatchObject({ panel_name: 'PP-01', switch_port: 'Gi1/0/3' });
  });
});

// ── Update connection ─────────────────────────────────────────────────────────

describe('PATCH /api/assets/:id/connections/:connectedAssetId', () => {
  let srcId: string;
  let dstId: string;

  beforeAll(async () => {
    srcId = await createAsset('Update Conn Src');
    dstId = await createAsset('Update Conn Dst');
    await request(app)
      .post(`/api/assets/${srcId}/connections`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ connected_asset_id: dstId, connection_type: 'serial', description: 'Original desc' });
  });

  it('updates the description and label', async () => {
    const res = await request(app)
      .patch(`/api/assets/${srcId}/connections/${dstId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'Updated desc', label: 'COM-1' });

    expect(res.status).toBe(200);
    const conn = res.body.data.connections.find((c: any) => c.connected_asset_id === dstId);
    expect(conn.description).toBe('Updated desc');
    expect(conn.label).toBe('COM-1');
  });

  it('updates the connection_type', async () => {
    const res = await request(app)
      .patch(`/api/assets/${srcId}/connections/${dstId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ connection_type: 'usb' });

    expect(res.status).toBe(200);
    const conn = res.body.data.connections.find((c: any) => c.connected_asset_id === dstId);
    expect(conn.connection_type).toBe('usb');
  });

  it('returns 404 when the connection does not exist', async () => {
    const res = await request(app)
      .patch(`/api/assets/${srcId}/connections/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

// ── Remove connection ─────────────────────────────────────────────────────────

describe('DELETE /api/assets/:id/connections/:connectedAssetId', () => {
  it('removes the connection', async () => {
    const srcId = await createAsset('Delete Conn Src');
    const dstId = await createAsset('Delete Conn Dst');

    await request(app)
      .post(`/api/assets/${srcId}/connections`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ connected_asset_id: dstId, connection_type: 'fiber' });

    const res = await request(app)
      .delete(`/api/assets/${srcId}/connections/${dstId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const conn = res.body.data.connections.find((c: any) => c.connected_asset_id === dstId);
    expect(conn).toBeUndefined();
  });

  it('also removes the reverse direction connection', async () => {
    const srcId = await createAsset('Reverse Conn Src');
    const dstId = await createAsset('Reverse Conn Dst');

    // Add forward connection
    await request(app)
      .post(`/api/assets/${srcId}/connections`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ connected_asset_id: dstId, connection_type: 'ethernet', bidirectional: true });

    // Also add reverse connection
    await request(app)
      .post(`/api/assets/${dstId}/connections`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ connected_asset_id: srcId, connection_type: 'ethernet', bidirectional: true });

    // Remove forward — should also clear reverse
    await request(app)
      .delete(`/api/assets/${srcId}/connections/${dstId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Check that dst no longer has src as a connection
    const dstRes = await request(app)
      .get(`/api/assets/${dstId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const reverseConn = dstRes.body.data.connections.find((c: any) => c.connected_asset_id === srcId);
    expect(reverseConn).toBeUndefined();
  });

  it('returns 404 when the connection does not exist', async () => {
    const srcId = await createAsset('No Conn Src');
    const res = await request(app)
      .delete(`/api/assets/${srcId}/connections/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

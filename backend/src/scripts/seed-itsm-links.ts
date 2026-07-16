/**
 * seed-itsm-links.ts — Demo data for the READ-ONLY ITSM reconcile feature.
 *
 * The main seed (`seed-mssql.ts`) creates local assets but links none of them to
 * ITSM, so the reconcile screen would be empty. This script creates a controlled
 * set of ITSM-linked assets so the reconcile flow is demonstrable end-to-end:
 *
 *   • Most assets are copied verbatim from the mock ITSM → they show "in sync".
 *   • A handful get one field deliberately changed → they show a single diff each
 *     (serial / status / MAC / display-name), so per-field accept can be tried.
 *   • One asset is linked to a non-existent ITSM id → "missing in ITSM".
 *
 * Idempotent: it removes its own previously-created demo rows (hardware_asset_id
 * LIKE 'HWA%') before re-inserting. Never touches non-ITSM local assets.
 *
 * Run inside the backend container:
 *   docker exec factory-map-backend npx ts-node src/scripts/seed-itsm-links.ts
 *   (or podman exec …)
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import itsmService from '../services/itsm/ITSMService';
import { IITSMHardware } from '../types/itsm.types';
import { itsmStatusToLocal } from '../services/itsm/statusMapping';

function assetFromItsm(hw: IITSMHardware): Asset {
  const repo = AppDataSource.getRepository(Asset);
  const a = repo.create({ source_of_truth: 'itsm', sync_status: 'success', is_managed: true });
  a.itsm_guid = hw.itsm_guid;
  a.hardware_asset_id = hw.itsm_id;
  a.asset_class = hw.asset_class ?? null;
  a.itsm_modified_at = hw.itsm_modified_at ? new Date(hw.itsm_modified_at) : null;
  a.last_synced = new Date();
  a.display_name = hw.display_name;
  a.serial_number = hw.serial_number ?? null;
  a.asset_tag = hw.asset_tag ?? null;
  a.model = hw.model ?? null;
  a.manufacturer = hw.manufacturer ?? null;
  a.os_type = hw.os_type ?? null;
  a.os_version = hw.os_version ?? null;
  a.mac_address = hw.mac_address ?? null;
  a.status = itsmStatusToLocal(hw.status);
  if (hw.assigned_to_person) { a.person_id = hw.assigned_to_person; a.person_itsm_id = hw.assigned_to_person; a.person_full_name = hw.assigned_person_name ?? null; }
  if (hw.organization_itsm_id) { a.org_itsm_id = hw.organization_itsm_id; a.org_display_name = hw.organization_name ?? null; }
  if (hw.catalog_item_itsm_id) { a.catalog_itsm_id = hw.catalog_item_itsm_id; a.catalog_display_name = hw.catalog_item_name ?? null; }
  a.asset_type = 'IPC';
  return a;
}

async function run() {
  await AppDataSource.initialize();
  console.log('✅ Connected to SQL Server');
  const repo = AppDataSource.getRepository(Asset);

  // Idempotency: drop previously created demo rows.
  const removed = await repo
    .createQueryBuilder()
    .delete()
    .where("hardware_asset_id LIKE 'HWA%'")
    .execute();
  console.log(`🗑️  Removed ${removed.affected ?? 0} previous ITSM-linked demo asset(s)`);

  const hardware = await itsmService.syncAll();
  console.log(`📥 Fetched ${hardware.length} hardware records from ITSM (${process.env.ITSM_MODE ?? 'mock'})`);

  const toSave: Asset[] = hardware.map(assetFromItsm);

  // ── Inject deliberate, per-field differences for the demo ──────────────────
  const byId = (id: string) => toSave.find((a) => a.hardware_asset_id === id);

  const serialDemo = byId('HWA10001');
  if (serialDemo) serialDemo.serial_number = 'DELL-SN-OUTDATED';           // → Serial mismatch

  const statusDemo = byId('HWA10002');
  if (statusDemo) statusDemo.status = 'maintenance';                       // ITSM Deployed(→active) vs local maintenance

  const macDemo = byId('HWA10003');
  if (macDemo) macDemo.mac_address = '00:2C:3D:4E:5F:99';                  // → MAC mismatch (real difference)

  const nameDemo = byId('HWA10004');
  if (nameDemo) { nameDemo.display_name = 'QA Laptop (régi név)'; nameDemo.person_full_name = null; } // name + person diff

  const macFormatDemo = byId('HWA10005');
  if (macFormatDemo) macFormatDemo.mac_address = '00-4e-5f-60-71-82';      // same MAC, different format → must NOT be a diff

  await repo.save(toSave);
  console.log(`✅ Linked & saved ${toSave.length} ITSM-managed assets`);

  // ── One asset linked to an ITSM id that does not exist → "missing in ITSM" ─
  const orphan = repo.create({
    source_of_truth: 'itsm',
    sync_status: 'success',
    is_managed: true,
    display_name: 'Selejtezett IPC (nincs ITSM-ben)',
    hardware_asset_id: 'HWA99999',
    itsm_guid: 'missing-guid-99999',
    serial_number: 'GHOST-0001',
    asset_type: 'IPC',
    status: 'active',
  });
  await repo.save(orphan);
  console.log('✅ Added 1 asset linked to a non-existent ITSM id (missing-in-ITSM demo)');

  console.log('\n🎯 Reconcile demo ready. Open /itsm in the app and run "Egyeztetés futtatása".');
  await AppDataSource.destroy();
}

run().catch((err) => {
  console.error('❌ seed-itsm-links failed:', err);
  process.exit(1);
});

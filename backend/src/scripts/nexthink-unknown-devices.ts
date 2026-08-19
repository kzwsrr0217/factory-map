/**
 * nexthink-unknown-devices.ts — machines that are switched on and that the map has never heard of.
 *
 * The strongest thing the Nexthink snapshot contributes. ITSM and the survey can both be incomplete
 * in the same direction — nobody records a device they do not know exists — but a machine cannot
 * report to Nexthink without existing, so every row here is a real computer, on the network, that the
 * factory map does not contain. There is no "maybe it was decommissioned" reading of it.
 *
 * The logic lives in `services/nexthink/overview.ts`, which the Nexthink page also uses. This file
 * only prints. Keeping the query here as well would mean two implementations of "which devices does
 * the map not know", and two implementations is how two answers start to differ.
 *
 * Read-only, no --apply. Creating the assets is a separate, deliberate act.
 *
 *   npx ts-node src/scripts/nexthink-unknown-devices.ts
 */
import 'reflect-metadata';
import { In } from 'typeorm';
import config from '../config/config';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { NexthinkDeviceSnapshot } from '../entities/NexthinkDeviceSnapshot.entity';
import { findUnknownDevices, UnknownDevice } from '../services/nexthink/overview';
import { NEXTHINK_VISIBLE_ASSET_TYPES } from '../services/nexthink/snapshotImport';

function asDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '?';
}

function printOne(u: UnknownDevice): void {
  const itsmState = u.itsm
    ? '✔ in the ITSM export'
    : u.newer_than_itsm_export
      ? '? newer than the loaded ITSM export'
      : '✖ not in the ITSM export';
  console.log(`\n  ${u.device_name}   ${itsmState}`);
  console.log(`      ${u.entity ?? 'no entity'} · ${u.hardware_type ?? '?'} · ${u.hardware}`);
  console.log(`      ${u.os_name ?? 'unknown OS'} · serial ${u.bios_serial || '—'}`
    + ` · first seen ${asDate(u.first_seen)}, last seen ${asDate(u.last_seen)}`);

  if (u.itsm) {
    console.log(`      ITSM: ${u.itsm.catalog_item_name ?? 'no catalogue item'} · ${u.itsm.status ?? 'no status'}`
      + ` · ${u.itsm.person ?? 'nobody assigned'}${u.itsm.location ? ` · ${u.itsm.location}` : ''}`);
  }

  if (u.top_person) {
    console.log(`      heaviest user: ${u.top_person}`);
    if (u.person_rooms.length === 1) {
      console.log(`      → their other equipment is in ${u.person_rooms[0]}; likely the same room`);
    } else if (u.person_rooms.length > 1) {
      console.log(`      → they have equipment in ${u.person_rooms.length} rooms (${u.person_rooms.join(', ')}) — no single suggestion`);
    } else {
      console.log('      → they have no placed equipment in the map, so no room can be suggested');
    }
  } else {
    console.log('      no named logons — generic or autologon account only, so no room can be suggested');
  }
}

async function main(): Promise<void> {
  try {
    await AppDataSource.initialize();
  } catch (err) {
    const { host, port, database } = config.mssql;
    console.error(`\n✖ Could not connect to the database at ${host}:${port} (${database}).`);
    console.error(`  ${String(err)}`);
    process.exit(1);
  }

  try {
    const total = await AppDataSource.getRepository(NexthinkDeviceSnapshot).count();
    if (total === 0) {
      console.log('\n✖ The Nexthink device snapshot is empty. Run import:nexthink -- <dir> --apply first.');
      return;
    }

    const unknowns = await findUnknownDevices();
    console.log(`🔍 ${unknowns.length} of ${total} Nexthink device(s) are not in the factory map`);
    if (unknowns.length === 0) {
      console.log('  Every machine Nexthink can see is in the map.');
      return;
    }

    const creatable = unknowns.filter((u) => u.itsm);
    const tooNew = unknowns.filter((u) => !u.itsm && u.newer_than_itsm_export);
    const orphans = unknowns.filter((u) => !u.itsm && !u.newer_than_itsm_export);

    if (creatable.length > 0) {
      console.log(`\n── ${creatable.length} that ITSM knows: can be created from the loaded export ──`);
      creatable.forEach(printOne);
    }
    if (tooNew.length > 0) {
      console.log(`\n── ${tooNew.length} that started reporting after the ITSM export was taken ──`);
      tooNew.forEach(printOne);
      console.log('\n  Nothing can be concluded about these: Alemba may hold them already. Take a fresh');
      console.log('  ITSM export and re-run before treating any of them as missing from the register.');
    }
    if (orphans.length > 0) {
      console.log(`\n── ${orphans.length} that ITSM does not know either ──`);
      orphans.forEach(printOne);
      console.log('\n  These predate the ITSM export and are still absent from it, so the absence is real.');
      console.log('  A machine that is on the network and in no asset register is the finding here,');
      console.log('  not a data-entry chore.');
    }

    console.log('\n  Nothing was written. To create the ones ITSM knows, use the ITSM Reconcile page');
    console.log('  (Unlinked MMH assets), or for a swap: record-replacement.ts OLD=NEW --apply');
    /**
     * The reverse question is a different report, but leaving it unsaid invites the assumption that
     * this list is the whole gap between the two systems. It is only one direction of it, and the
     * smaller one — counted here rather than quoted, so it cannot go stale.
     */
    const visible = await AppDataSource.getRepository(Asset).count({
      where: { asset_type: In([...NEXTHINK_VISIBLE_ASSET_TYPES]) },
    });
    console.log(`\n  One direction only: ${unknowns.length} machine(s) Nexthink sees and the map lacks.`);
    console.log(`  The other direction — how many of the map's ${visible} agent-carrying assets Nexthink has`);
    console.log('  never seen — is in the import summary, and it is a question, not a finding.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Failed:', err);
  process.exit(1);
});

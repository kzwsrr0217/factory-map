/**
 * nexthink-unknown-devices.ts — machines that are switched on and that the map has never heard of.
 *
 * The strongest thing the Nexthink snapshot contributes. ITSM and the survey can both be
 * incomplete in the same direction — nobody records a device they do not know exists — but a
 * machine cannot report to Nexthink without existing, so every row here is a real computer, on
 * the network, that the factory map does not contain. There is no "maybe it was decommissioned"
 * reading of it.
 *
 * The one question that decides what to do with each is whether ITSM knows it:
 *
 *   in the ITSM export      → the app can create it from that export, linked and unplaced, and
 *                             `record-replacement.ts` already does exactly this for a swap
 *   not in the ITSM export  → ITSM does not have the CI either. Nothing can be created from
 *                             nothing without inventing a device Alemba cannot confirm, which is
 *                             how a duplicate is born. Someone has to create it in Alemba first.
 *
 * Where it should go is guessed the only defensible way: from the heaviest NAMED logon and where
 * that person's other assets already sit in the map. That is a suggestion for a human, printed as
 * one — a shared machine, or one whose top user is a generic account, gets no suggestion at all
 * rather than a wrong one.
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
import { WorkArea } from '../entities/WorkArea.entity';
import { ItsmHardwareSnapshot } from '../entities/ItsmHardwareSnapshot.entity';
import { NexthinkDeviceSnapshot } from '../entities/NexthinkDeviceSnapshot.entity';
import { NexthinkLoginSnapshot } from '../entities/NexthinkLoginSnapshot.entity';
import { NEXTHINK_VISIBLE_ASSET_TYPES } from '../services/nexthink/snapshotImport';

interface Unknown {
  device: NexthinkDeviceSnapshot;
  itsm: ItsmHardwareSnapshot | null;
  /** Heaviest named logon, or null when only generic/machine accounts have been used. */
  topPerson: NexthinkLoginSnapshot | null;
  /** Rooms that person's existing assets sit in — where this one probably belongs. */
  personRooms: string[];
  /**
   * The machine started reporting after the loaded ITSM export was taken. Then "ITSM does not
   * know it" is not a finding at all — the export simply predates the device. Without this the
   * report told the reader to go create a CI in Alemba for a machine Alemba may well already
   * hold, which is precisely how a duplicate gets made.
   */
  newerThanItsmExport: boolean;
}

/**
 * Manufacturer and model, without saying "Dell Dell Pro Slim".
 *
 * Nexthink's `hardware.model` sometimes carries the maker and sometimes does not, so neither
 * field alone is right and concatenating them blindly stutters.
 */
function describeHardware(manufacturer: string | null, model: string | null): string {
  const make = manufacturer?.trim() ?? '';
  const mod = model?.trim() ?? '';
  if (!mod) return make || 'unknown model';
  if (!make) return mod;
  return mod.toLowerCase().startsWith(make.toLowerCase()) ? mod : `${make} ${mod}`;
}

/**
 * Every Nexthink device with no asset in the map.
 *
 * Matched on `hardware_asset_id` with a `display_name` fallback, the same two-step every other
 * caller uses: the older devices carry the HWA as their name and were never given the dedicated
 * column, so matching on one field alone reports devices as missing that are sitting in the map
 * under the number.
 */
async function findUnknownDevices(): Promise<NexthinkDeviceSnapshot[]> {
  const devices = await AppDataSource.getRepository(NexthinkDeviceSnapshot).find();
  const names = devices.map((d) => d.device_name);
  if (names.length === 0) return [];

  const known = new Set<string>();
  const assetRepo = AppDataSource.getRepository(Asset);
  // 500 at a time: two bound parameters per row would otherwise walk into SQL Server's
  // 2100-parameter ceiling as the estate grows.
  for (let i = 0; i < names.length; i += 500) {
    const chunk = names.slice(i, i + 500);
    const rows = await assetRepo.find({
      where: [{ hardware_asset_id: In(chunk) }, { display_name: In(chunk) }],
      select: { hardware_asset_id: true, display_name: true },
    });
    for (const a of rows) {
      if (a.hardware_asset_id) known.add(a.hardware_asset_id);
      known.add(a.display_name);
    }
  }
  return devices.filter((d) => !known.has(d.device_name));
}

/** Which rooms this person's existing assets are in, by name. */
async function roomsOf(fullName: string): Promise<string[]> {
  const assets = await AppDataSource.getRepository(Asset).find({
    where: { person_full_name: fullName },
    select: { workarea_id: true },
  });
  const ids = [...new Set(assets.map((a) => a.workarea_id).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return [];
  const rooms = await AppDataSource.getRepository(WorkArea).find({
    where: { id: In(ids) },
    select: { name: true },
  });
  return rooms.map((r) => r.name);
}

async function gather(): Promise<Unknown[]> {
  const devices = await findUnknownDevices();
  if (devices.length === 0) return [];
  const names = devices.map((d) => d.device_name);

  const itsmRepo = AppDataSource.getRepository(ItsmHardwareSnapshot);
  const itsmRows = await itsmRepo.find({ where: { itsm_id: In(names) } });
  const itsmByHwa = new Map(itsmRows.map((r) => [r.itsm_id, r]));

  // When the ITSM export was taken, so "absent from it" can be told apart from "newer than it".
  const itsmAge = await itsmRepo.createQueryBuilder('i')
    .select('MAX(i.imported_at)', 'max').getRawOne<{ max: Date | null }>();
  const itsmImportedAt = itsmAge?.max ?? null;

  const logins = await AppDataSource.getRepository(NexthinkLoginSnapshot)
    .find({ where: { device_name: In(names), account_kind: 'person' } });

  const out: Unknown[] = [];
  for (const device of devices) {
    const people = logins
      .filter((l) => l.device_name === device.device_name)
      .sort((a, b) => b.logins - a.logins);
    const topPerson = people[0] ?? null;
    out.push({
      device,
      itsm: itsmByHwa.get(device.device_name) ?? null,
      topPerson,
      personRooms: topPerson?.full_name ? await roomsOf(topPerson.full_name) : [],
      newerThanItsmExport: Boolean(
        !itsmByHwa.has(device.device_name)
        && itsmImportedAt && device.first_seen && device.first_seen > itsmImportedAt,
      ),
    });
  }
  // The ones ITSM can supply first: they are the ones that can be acted on today.
  return out.sort((a, b) => Number(Boolean(b.itsm)) - Number(Boolean(a.itsm)));
}

function printOne(u: Unknown): void {
  const d = u.device;
  const seen = d.last_seen ? d.last_seen.toISOString().slice(0, 10) : 'never';
  const first = d.first_seen ? d.first_seen.toISOString().slice(0, 10) : '?';
  const itsmState = u.itsm
    ? '✔ in the ITSM export'
    : u.newerThanItsmExport
      ? '? newer than the loaded ITSM export'
      : '✖ not in the ITSM export';
  console.log(`\n  ${d.device_name}   ${itsmState}`);
  console.log(`      ${d.entity ?? 'no entity'} · ${d.hardware_type ?? '?'} · ${describeHardware(d.manufacturer, d.model)}`);
  console.log(`      ${d.os_name ?? 'unknown OS'} · serial ${d.bios_serial || '—'} · first seen ${first}, last seen ${seen}`);

  if (u.itsm) {
    console.log(`      ITSM: ${u.itsm.catalog_item_name ?? 'no catalogue item'} · ${u.itsm.status ?? 'no status'}`
      + ` · ${u.itsm.assigned_person_name ?? 'nobody assigned'}`
      + `${u.itsm.location_name ? ` · ${u.itsm.location_name}` : ''}`);
  }

  if (u.topPerson) {
    console.log(`      heaviest user: ${u.topPerson.full_name} (${u.topPerson.logins} logons)`);
    if (u.personRooms.length === 1) {
      console.log(`      → their other equipment is in ${u.personRooms[0]}; likely the same room`);
    } else if (u.personRooms.length > 1) {
      console.log(`      → they have equipment in ${u.personRooms.length} rooms (${u.personRooms.join(', ')}) — no single suggestion`);
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

    const unknowns = await gather();
    console.log(`🔍 ${unknowns.length} of ${total} Nexthink device(s) are not in the factory map`);
    if (unknowns.length === 0) {
      console.log('  Every machine Nexthink can see is in the map.');
      return;
    }

    const creatable = unknowns.filter((u) => u.itsm);
    const tooNew = unknowns.filter((u) => !u.itsm && u.newerThanItsmExport);
    const orphans = unknowns.filter((u) => !u.itsm && !u.newerThanItsmExport);

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
     * The reverse question is a different report, but leaving it unsaid invites the assumption
     * that this list is the whole gap between the two systems. It is only one direction of it,
     * and the smaller one — counted here rather than quoted, so it cannot go stale.
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

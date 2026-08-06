/**
 * record-replacement.ts — "We swapped this machine today, put it in."
 *
 * A swap arrives as HWA numbers, not as asset ids, and often several at once. The click-path
 * for it exists, but it takes a search and six clicks per device and it cannot say beforehand
 * what will move — which for a machine with two screens and a wall port is the part worth
 * seeing first.
 *
 * What one swap does is defined in services/asset/replacement.ts, which the endpoint uses
 * too; this reads the numbers, resolves them, prints what would happen, and — with --apply —
 * does it.
 *
 * The replacement can be a machine the app has never seen. It has to exist as an asset for a
 * relationship to point at it, so where the loaded ITSM export contains the number, this
 * creates it from that export (linked, unplaced) before the swap. Where the export does not
 * contain it either, it stops and says so: inventing a device that ITSM has never heard of is
 * how a duplicate is born.
 *
 * A monitor can be named as coming with the new machine (`old>new+monitor`), which places it
 * in the same room and hangs it off the machine as a child — the relationship the survey's
 * comments became, see surveyImport.ts.
 *
 * Usage:
 *   npx ts-node src/scripts/record-replacement.ts HWA16727=HWA38234
 *   npx ts-node src/scripts/record-replacement.ts HWA11763=HWA23250+HWA33684 --apply
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { AssetConnection } from '../entities/AssetConnection.entity';
import { ItsmHardwareSnapshot } from '../entities/ItsmHardwareSnapshot.entity';
import { replaceAssetWith } from '../services/asset/replacement';
import { createAssetsFromUnlinkedMmh } from '../services/itsm/ReconcileService';

interface Swap {
  oldHwa: string;
  newHwa: string;
  /** Screens that came with the new machine, to be attached to it. */
  monitorHwas: string[];
}

/** `HWA16727=HWA38234+HWA33684` — old, new, and anything that came with it. */
function parseSwap(arg: string): Swap {
  const [left, right] = arg.split('=');
  if (!left || !right) throw new Error(`Cannot read "${arg}" — expected OLD=NEW[+MONITOR...]`);
  const parts = right.split('+').map((p) => p.trim().toUpperCase()).filter(Boolean);
  return { oldHwa: left.trim().toUpperCase(), newHwa: parts[0], monitorHwas: parts.slice(1) };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const swaps = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(parseSwap);
  if (swaps.length === 0) {
    console.error('✖ Usage: record-replacement.ts OLD=NEW[+MONITOR...] [more...] [--apply]');
    process.exit(1);
  }

  await AppDataSource.initialize();
  try {
    const assetRepo = AppDataSource.getRepository(Asset);
    const connRepo = AppDataSource.getRepository(AssetConnection);
    const snapshotRepo = AppDataSource.getRepository(ItsmHardwareSnapshot);

    /** By HWA, then by display name — the older devices carry the number as their name. */
    const find = async (hwa: string): Promise<Asset | null> => (
      await assetRepo.findOne({ where: { hardware_asset_id: hwa } })
      ?? await assetRepo.findOne({ where: { display_name: hwa } })
    );

    for (const swap of swaps) {
      console.log(`\n=== ${swap.oldHwa} → ${swap.newHwa}${swap.monitorHwas.length ? ` (+ ${swap.monitorHwas.join(', ')})` : ''} ===`);

      const oldAsset = await find(swap.oldHwa);
      if (!oldAsset) { console.log(`  ✖ ${swap.oldHwa} is not in the app — nothing to replace`); continue; }

      let newAsset = await find(swap.newHwa);
      if (!newAsset) {
        const row = await snapshotRepo.findOne({ where: { itsm_id: swap.newHwa } });
        if (!row) {
          console.log(`  ✖ ${swap.newHwa} is neither in the app nor in the loaded ITSM export.`);
          console.log('     Load a newer export first — creating it from nothing would make a device ITSM cannot confirm.');
          continue;
        }
        console.log(`  · ${swap.newHwa} is in the export but not in the app — would be created from it`);
        console.log(`      ${row.catalog_item_name ?? '(no catalogue item)'} · serial ${row.serial_number ?? '—'} · ${row.status ?? 'no status'}`);
        if (apply) {
          const created = await createAssetsFromUnlinkedMmh([row.itsm_guid]);
          newAsset = created.created[0] ?? created.linked[0] ?? null;
          if (!newAsset) {
            console.log(`  ✖ could not create it: ${created.skipped.map((s) => s.error).join('; ')}`);
            continue;
          }
          console.log(`  ✔ created ${newAsset.display_name}`);
        }
      }

      // What the swap will move, said before it moves.
      const conns = await connRepo.createQueryBuilder('c')
        .where('c.asset_id = :id OR c.connected_asset_id = :id', { id: oldAsset.id }).getMany();
      console.log(`  ${oldAsset.display_name}: ${oldAsset.is_placed ? 'on the map' : 'not on the map'}`
        + `, room ${oldAsset.workarea_id ?? '—'}, person ${oldAsset.person_full_name ?? '—'}`
        + `, ${conns.length} connection(s) to move`);

      if (!apply) {
        console.log('  · would replace it, and hand the place, the room and the connections to the replacement');
      } else if (newAsset) {
        const result = await replaceAssetWith(oldAsset.id, newAsset.id, { id: 'script', username: 'record-replacement' });
        // Re-read: the swap is what gave the replacement its room, and the copy in hand was
        // loaded before that. Attaching the screens off the stale copy put them in no room at
        // all, silently, and the log still said they had moved.
        newAsset = await assetRepo.findOne({ where: { id: newAsset.id } });
        if (!newAsset) throw new Error('The replacement disappeared mid-swap');
        console.log(result.already_recorded
          ? '  · already recorded — left alone'
          : `  ✔ replaced — ${result.connections_moved} connection(s) moved`
            + `${result.wall_ports_moved > 0 ? `, ${result.wall_ports_moved} wall port(s) followed` : ''}`
            + `${result.inherited_placement ? ', the replacement is now on the map' : ''}`);
        /**
         * The person is not part of a swap in the service, and should not be: it comes from
         * ITSM, and the export is what says who has the new machine. Where ITSM has not
         * caught up, the old machine's person is the only record of whose desk this is — so
         * it is filled in, never overwritten. Same rule as the survey import: fill a gap,
         * never replace a value.
         */
        if (!newAsset.person_full_name && oldAsset.person_full_name) {
          await assetRepo.update(newAsset.id, { person_full_name: oldAsset.person_full_name });
          console.log(`      person carried over: ${oldAsset.person_full_name} (ITSM has none yet)`);
        }
      }

      for (const monitorHwa of swap.monitorHwas) {
        const monitor = await find(monitorHwa);
        if (!monitor) { console.log(`  ✖ ${monitorHwa} is not in the app — cannot attach it`); continue; }
        if (!apply || !newAsset) {
          console.log(`  · would place ${monitor.display_name} in the same room and attach it to ${swap.newHwa}`);
          continue;
        }
        await assetRepo.update(monitor.id, {
          building_id: newAsset.building_id,
          floor_id: newAsset.floor_id,
          workarea_id: newAsset.workarea_id,
          ...(monitor.person_full_name ? {} : { person_full_name: newAsset.person_full_name ?? oldAsset.person_full_name }),
        });
        // One directed row: an outbound parent-child names the asset's PARENT, so the screen
        // points at the machine and not the other way round.
        const already = await connRepo.createQueryBuilder('c')
          .where('c.asset_id = :child', { child: monitor.id })
          .andWhere('c.connected_asset_id = :parent', { parent: newAsset.id })
          .andWhere('c.connection_type = :t', { t: 'parent-child' })
          .getCount();
        if (already > 0) {
          console.log(`  · ${monitor.display_name} is already attached to ${swap.newHwa}`);
        } else {
          await connRepo.save(connRepo.create({
            asset_id: monitor.id,
            connected_asset_id: newAsset.id,
            connection_type: 'parent-child',
            description: 'Came with the replacement machine',
            bidirectional: false,
          }));
          console.log(`  ✔ ${monitor.display_name} attached to ${swap.newHwa} and moved to its room`);
        }
      }
    }

    if (!apply) console.log('\n· Nothing written. Re-run with --apply.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Failed:', err);
  process.exit(1);
});

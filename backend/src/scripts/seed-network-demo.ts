/**
 * seed-network-demo.ts — A rehearsal set for the cabling workflow.
 *
 * The app's whole network side — sockets, patch panels, racks, the physical path on an
 * asset, the socket search, the survey progress page's socket columns — has never run
 * against data, because the network survey hasn't happened: the database holds zero
 * sockets, racks and network rooms. That makes it impossible either to rehearse the
 * workflow before walking the factory, or to see that it works.
 *
 * `seed-mssql.ts` cannot help here: its own header says it deletes ALL existing data,
 * which would take the 1054 ITSM-sourced assets with it. This script only adds, and
 * only things it can take back:
 *
 *   one network room (IDF) -> one rack -> two 24-port patch panels
 *   48 sockets labelled DEMO-R1/001..048, half of them patched, some of those live
 *   one rack-mounted switch the live sockets point at
 *   one workstation plugged into a live socket, so the finished state of the chain
 *     (placed -> socket -> panel -> switch port) is visible without recording anything,
 *     with a maintenance date a fortnight out so the calendar has something to draw
 *
 * Every row it creates is named with the DEMO_PREFIX, and `--remove` deletes exactly
 * those and nothing else — it never matches on anything a person might have typed.
 *
 * It touches no asset it did not create, and never assigns a socket to a real device:
 * plugging a real one in is the part worth doing by hand.
 *
 * Usage:
 *   npm run seed:network-demo -- --building=<id>   # or --floor=<id>
 *   npm run seed:network-demo -- --remove
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { NetworkRoom } from '../entities/NetworkRoom.entity';
import { NetworkRack } from '../entities/NetworkRack.entity';
import { PatchPanel } from '../entities/PatchPanel.entity';
import { WallPort } from '../entities/WallPort.entity';
import { Asset } from '../entities/Asset.entity';

/**
 * Marks everything this script creates. Deliberately ugly: it has to be impossible to
 * mistake demo cabling for surveyed cabling, and impossible for `--remove` to catch
 * something real.
 */
const DEMO_PREFIX = 'DEMO';
const SOCKET_COUNT = 48;
const PANEL_PORTS = 24;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/** `DEMO-R1/001` — the label shape the real sockets use, prefixed. */
function socketLabel(n: number): string {
  return `${DEMO_PREFIX}-R1/${String(n).padStart(3, '0')}`;
}

async function remove(): Promise<void> {
  const rooms = await AppDataSource.getRepository(NetworkRoom)
    .createQueryBuilder('r').where('r.name LIKE :p', { p: `${DEMO_PREFIX}%` }).getMany();
  const racks = rooms.length
    ? await AppDataSource.getRepository(NetworkRack)
        .createQueryBuilder('k').where('k.network_room_id IN (:...ids)', { ids: rooms.map((r) => r.id) }).getMany()
    : [];
  const panels = racks.length
    ? await AppDataSource.getRepository(PatchPanel)
        .createQueryBuilder('p').where('p.rack_id IN (:...ids)', { ids: racks.map((r) => r.id) }).getMany()
    : [];

  // Sockets first: they reference the panels and the switch. Matched on their own
  // label rather than on the panels, so a socket whose patch was cleared by hand
  // during the rehearsal is still cleaned up.
  const sockets = await AppDataSource.getRepository(WallPort)
    .createQueryBuilder('w').where('w.label LIKE :p', { p: `${DEMO_PREFIX}-%` }).getMany();

  /**
   * A socket someone has plugged a REAL device into is left alone, with its patching
   * intact: deleting it would silently change that device's recorded network path.
   *
   * The script's own workstation is exempt — it is plugged into a demo socket by
   * design, and without this exemption the guard fired on it and `--remove` could not
   * clean up its own creation.
   */
  const occupied = sockets.length
    ? (await AppDataSource.getRepository(Asset)
        .createQueryBuilder('a').where('a.wall_port_id IN (:...ids)', { ids: sockets.map((s) => s.id) }).getMany())
        .filter((a) => !a.display_name?.startsWith(`${DEMO_PREFIX}-`))
    : [];
  const occupiedPortIds = new Set(occupied.map((a) => a.wall_port_id));
  const removableSockets = sockets.filter((s) => !occupiedPortIds.has(s.id));

  const switches = await AppDataSource.getRepository(Asset)
    .createQueryBuilder('a').where('a.display_name LIKE :p', { p: `${DEMO_PREFIX}-%` }).getMany();

  console.log('Removing the demo network set:');
  console.log(`   ${removableSockets.length} socket(s), ${panels.length} panel(s), ${racks.length} rack(s), ${rooms.length} room(s), ${switches.length} switch asset(s)`);
  if (occupiedPortIds.size > 0) {
    console.log(`   ${occupiedPortIds.size} demo socket(s) kept: a device is plugged into them`);
    for (const a of occupied) console.log(`      ${a.display_name}`);
    console.log('   Clear those assignments on the devices first if you want them gone.');
  }

  if (removableSockets.length) {
    await AppDataSource.getRepository(WallPort).delete(removableSockets.map((s) => s.id));
  }
  // Panels/racks/rooms only when nothing demo-labelled still hangs off them.
  if (occupiedPortIds.size === 0) {
    if (panels.length) await AppDataSource.getRepository(PatchPanel).delete(panels.map((p) => p.id));
    if (racks.length) await AppDataSource.getRepository(NetworkRack).delete(racks.map((r) => r.id));
    if (rooms.length) await AppDataSource.getRepository(NetworkRoom).delete(rooms.map((r) => r.id));
  } else {
    console.log('   Room, rack and panels kept, since the remaining sockets still reference them.');
  }
  if (switches.length) {
    // The switch may be referenced by the sockets that were kept.
    const stillReferenced = new Set(
      (await AppDataSource.getRepository(WallPort)
        .createQueryBuilder('w').where('w.label LIKE :p', { p: `${DEMO_PREFIX}-%` }).getMany())
        .map((w) => w.switch_asset_id).filter(Boolean) as string[],
    );
    const deletable = switches.filter((a) => !stillReferenced.has(a.id));
    if (deletable.length) await AppDataSource.getRepository(Asset).delete(deletable.map((a) => a.id));
    if (deletable.length !== switches.length) {
      console.log('   Switch kept: a remaining demo socket is patched to it.');
    }
  }
  console.log('\nDone. Nothing outside the demo set was touched.');
}

async function seed(): Promise<void> {
  const buildingRepo = AppDataSource.getRepository(Building);
  const floorRepo = AppDataSource.getRepository(Floor);

  const existing = await AppDataSource.getRepository(NetworkRoom)
    .createQueryBuilder('r').where('r.name LIKE :p', { p: `${DEMO_PREFIX}%` }).getCount();
  if (existing > 0) {
    console.log('A demo network set is already here. Run with --remove first if you want a fresh one.');
    return;
  }

  // Which building/floor to hang it off: named explicitly, or the only one there is.
  // Guessing between several would put demo cabling somewhere nobody expects it.
  let floor: Floor | null = null;
  const floorId = arg('floor');
  if (floorId) {
    floor = await floorRepo.findOne({ where: { id: floorId } });
    if (!floor) throw new Error(`No floor with id ${floorId}`);
  } else {
    const buildingId = arg('building');
    const floors = await floorRepo.find(buildingId ? { where: { building_id: buildingId } } : {});
    if (floors.length === 0) throw new Error('No floors in the database — create a building and a floor first.');
    if (floors.length > 1 && !buildingId) {
      console.log('Several floors exist; say which one:');
      for (const f of floors) console.log(`   --floor=${f.id}   ${f.name}`);
      return;
    }
    floor = floors[0];
  }
  const building = await buildingRepo.findOne({ where: { id: floor.building_id } });
  if (!building) throw new Error(`Floor ${floor.name} points at a building that does not exist.`);

  console.log(`Seeding the demo network set on ${building.name} / ${floor.name}\n`);

  const room = await AppDataSource.getRepository(NetworkRoom).save({
    name: `${DEMO_PREFIX}-IDF-1`,
    type: 'idf',
    building_id: building.id,
    floor_id: floor.id,
    description: 'Demo data for rehearsing the cabling workflow. Safe to delete: seed:network-demo --remove',
  } as NetworkRoom);

  const rack = await AppDataSource.getRepository(NetworkRack).save({
    name: `${DEMO_PREFIX}-R1`,
    network_room_id: room.id,
    u_count: 42,
    description: 'Demo rack',
  } as NetworkRack);

  // Two panels, u_position set, because derivePatchTarget walks panels in u_position
  // order and returns nothing for a panel that has none (see utils/wallPortLabel.ts).
  const panels = await AppDataSource.getRepository(PatchPanel).save([
    { name: `${DEMO_PREFIX}-PP-1`, rack_id: rack.id, u_position: 1, port_count: PANEL_PORTS, cable_type: 'copper' },
    { name: `${DEMO_PREFIX}-PP-2`, rack_id: rack.id, u_position: 2, port_count: PANEL_PORTS, cable_type: 'copper' },
  ] as PatchPanel[]);

  const sw = await AppDataSource.getRepository(Asset).save({
    display_name: `${DEMO_PREFIX}-SW-CORE-1`,
    asset_type: 'switch',
    status: 'active',
    building_id: building.id,
    floor_id: floor.id,
    rack_id: rack.id,
    u_position: 40,
    rack_u_size: 1,
    is_placed: false,
    source_of_truth: 'local',
  } as unknown as Asset);

  /**
   * The three states of the chain, on purpose — the workflow's whole point is that
   * they are different, and a set where everything is live would not let anyone see
   * that a patched-but-not-live socket has no network:
   *   1..16   unpatched   (recorded, no panel)
   *   17..32  patched     (panel port, no switch port)
   *   33..48  live        (panel port + switch port)
   */
  const sockets: Partial<WallPort>[] = [];
  for (let n = 1; n <= SOCKET_COUNT; n++) {
    const patched = n > 16;
    const live = n > 32;
    const panelIndex = n <= PANEL_PORTS ? 0 : 1;
    const panelPort = n <= PANEL_PORTS ? n : n - PANEL_PORTS;
    sockets.push({
      label: socketLabel(n),
      floor_id: floor.id,
      workarea_id: null,
      patch_panel_id: patched ? panels[panelIndex].id : null,
      patch_port: patched ? panelPort : null,
      switch_asset_id: live ? sw.id : null,
      switch_port: live ? `Gi1/0/${panelPort}` : null,
      description: 'demo',
    });
  }
  await AppDataSource.getRepository(WallPort).save(sockets as WallPort[]);

  // One finished example. Without it the chain on an asset page can only ever be seen
  // half-recorded here, which is the state it was already possible to see.
  const liveSocket = await AppDataSource.getRepository(WallPort)
    .findOne({ where: { label: socketLabel(33) } });
  const pc: Asset = await AppDataSource.getRepository(Asset).save({
    display_name: `${DEMO_PREFIX}-PC-01`,
    asset_type: 'workstation',
    status: 'active',
    building_id: building.id,
    floor_id: floor.id,
    pos_x: 300,
    pos_y: 200,
    is_placed: true,
    wall_port_id: liveSocket?.id ?? null,
    // A date a fortnight out, so the maintenance calendar has something to draw. No
    // real asset carries one yet, which left that page impossible to look at.
    maint_next_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    maint_interval_days: 180,
    source_of_truth: 'local',
  } as unknown as Asset);

  console.log(`   room ${room.name}, rack ${rack.name}, panels ${panels.map((p) => p.name).join(' + ')}`);
  console.log(`   switch ${sw.display_name} at U40`);
  console.log(`   ${SOCKET_COUNT} sockets ${socketLabel(1)}..${socketLabel(SOCKET_COUNT)}`);
  console.log('      1-16 not patched · 17-32 patched, no switch port · 33-48 live');
  console.log(`   ${pc.display_name} on the plan, plugged into ${socketLabel(33)} — one complete chain`);
  console.log('\nEvery other socket is free: plugging a real device in is the part worth doing by hand.');
  console.log(`Remove it all again with: npm run seed:network-demo -- --remove`);
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    if (process.argv.includes('--remove')) await remove();
    else await seed();
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Demo network seed failed:', err);
  process.exit(1);
});

/**
 * asset-child-placement.test.ts — a desk move takes the screens with it.
 *
 * The gap this closes was different in kind from the others in the process model: the rest cost
 * somebody extra work, this one silently produced WRONG DATA. A machine moved room and its monitors
 * kept pointing at the room they had left, with nothing anywhere saying so — a map that looks
 * complete and is lying is worse than one with an obvious hole.
 *
 * What is pinned here is not "children move" but the three ways moving them could be wrong: taking a
 * child that was deliberately somewhere else, dragging a retired device back onto the map, and — the
 * one worth a test on its own — walking the parent-child link in the wrong direction and moving the
 * machine's PARENT instead of its screens.
 *
 * On the real estate 63 live parent-child links split 41 together and 22 apart, so the
 * left-behind rule is not a theoretical nicety: without it, one move would have destroyed 22
 * deliberate placements.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { AssetConnection } from '../entities/AssetConnection.entity';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import {
  placementOf,
  samePlacement,
  placementChanged,
  moveChildrenWithParent,
} from '../services/asset/childPlacement';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;

const PREFIX = `cp${Date.now()}`;
const auth = () => ({ Authorization: `Bearer ${token}` });
const createdIds: string[] = [];
/** Places the endpoint test creates. Torn down after the assets, innermost first. */
const createdPlaces: Array<{ repo: 'workarea' | 'floor' | 'building'; id: string }> = [];

/** Two placements that differ only by room, which is what a desk move looks like. */
const ROOM_A = 'room-a';
const ROOM_B = 'room-b';

async function makeAsset(over: Partial<Asset>): Promise<Asset> {
  const asset = await AppDataSource.getRepository(Asset).save({
    display_name: `${PREFIX}_asset`,
    status: 'active',
    ...over,
  } as Asset);
  createdIds.push(asset.id);
  return asset;
}

/**
 * One directed row. The child's `asset_id` is itself and `connected_asset_id` names its PARENT — an
 * outbound parent-child row points at the parent, so a machine's children are the rows pointing AT
 * it. This helper exists so every test states the direction the same way.
 */
async function link(child: Asset, parent: Asset): Promise<void> {
  const repo = AppDataSource.getRepository(AssetConnection);
  await repo.save(repo.create({
    asset_id: child.id,
    connected_asset_id: parent.id,
    connection_type: 'parent-child',
    bidirectional: false,
  }));
}

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();
}, 40000);

afterEach(async () => {
  if (createdIds.length > 0) {
    const connRepo = AppDataSource.getRepository(AssetConnection);
    await connRepo.createQueryBuilder().delete()
      .where('asset_id IN (:...ids) OR connected_asset_id IN (:...ids)', { ids: createdIds }).execute();
    await AppDataSource.getRepository(Asset).createQueryBuilder().delete()
      .whereInIds(createdIds).execute();
    createdIds.length = 0;
  }
  // After the assets, or a room still holding one cannot be deleted.
  for (const p of createdPlaces) {
    if (p.repo === 'workarea') await AppDataSource.getRepository(WorkArea).delete({ id: p.id });
    if (p.repo === 'floor') await AppDataSource.getRepository(Floor).delete({ id: p.id });
    if (p.repo === 'building') await AppDataSource.getRepository(Building).delete({ id: p.id });
  }
  createdPlaces.length = 0;
});

describe('samePlacement', () => {
  it('treats two devices with no room on the same floor as being in the same place', () => {
    // "No room recorded" is a real state here — 176 real assets sit on a floor without one — so it
    // has to compare equal to itself, or those children could never follow anything.
    const a = { building_id: 'b', floor_id: 'f', workarea_id: null, section_id: null, workstation_id: null };
    expect(samePlacement(a, { ...a })).toBe(true);
    expect(placementChanged(a, { ...a })).toBe(false);
  });

  it('sees a room change as a change', () => {
    const a = { building_id: 'b', floor_id: 'f', workarea_id: ROOM_A, section_id: null, workstation_id: null };
    expect(placementChanged(a, { ...a, workarea_id: ROOM_B })).toBe(true);
  });
});

describe('moveChildrenWithParent', () => {
  it('takes a child that was with the parent', async () => {
    const parent = await makeAsset({ display_name: `${PREFIX}_pc`, workarea_id: ROOM_A });
    const screen = await makeAsset({ display_name: `${PREFIX}_screen`, workarea_id: ROOM_A, asset_type: 'monitor' });
    await link(screen, parent);

    const before = placementOf(parent);
    const result = await moveChildrenWithParent(parent.id, before, { ...before, workarea_id: ROOM_B });

    expect(result.moved.map((m) => m.id)).toEqual([screen.id]);
    expect(result.left_behind).toEqual([]);
    const after = await AppDataSource.getRepository(Asset).findOne({ where: { id: screen.id } });
    expect(after?.workarea_id).toBe(ROOM_B);
  });

  it('leaves a child that was somewhere else, and says so', async () => {
    /**
     * The rule the whole design rests on. A screen recorded in another room was not following this
     * machine — a spare parked in a store room, an OT device in a cabinet down the hall — and
     * dragging it along would destroy a deliberate placement to fix an accidental one.
     */
    const parent = await makeAsset({ display_name: `${PREFIX}_pe`, workarea_id: ROOM_A });
    const elsewhere = await makeAsset({ display_name: `${PREFIX}_elsewhere`, workarea_id: 'somewhere-else' });
    await link(elsewhere, parent);

    const before = placementOf(parent);
    const result = await moveChildrenWithParent(parent.id, before, { ...before, workarea_id: ROOM_B });

    expect(result.moved).toEqual([]);
    expect(result.left_behind.map((m) => m.id)).toEqual([elsewhere.id]);
    const after = await AppDataSource.getRepository(Asset).findOne({ where: { id: elsewhere.id } });
    expect(after?.workarea_id).toBe('somewhere-else');
  });

  it('does not move the parent of the machine — only its children', async () => {
    /**
     * The mistake a test is worth having for. A `parent-child` row is directed: the child points at
     * its parent. Reading the rows the machine OWNS instead of the rows pointing AT it would move
     * the machine's own parent, which is both wrong and invisible — the screens would stay put and
     * something upstream would silently relocate.
     */
    const machine = await makeAsset({ display_name: `${PREFIX}_machine`, workarea_id: ROOM_A });
    const itsParent = await makeAsset({ display_name: `${PREFIX}_itsparent`, workarea_id: ROOM_A });
    await link(machine, itsParent); // machine is the CHILD here

    const before = placementOf(machine);
    const result = await moveChildrenWithParent(machine.id, before, { ...before, workarea_id: ROOM_B });

    expect(result.moved).toEqual([]);
    const parentAfter = await AppDataSource.getRepository(Asset).findOne({ where: { id: itsParent.id } });
    expect(parentAfter?.workarea_id).toBe(ROOM_A);
  });

  it('does not drag a replaced device back onto the map', async () => {
    const parent = await makeAsset({ display_name: `${PREFIX}_pr`, workarea_id: ROOM_A });
    const successor = await makeAsset({ display_name: `${PREFIX}_successor` });
    const retired = await makeAsset({
      display_name: `${PREFIX}_retired`, workarea_id: ROOM_A, successor_id: successor.id,
    });
    await link(retired, parent);

    const before = placementOf(parent);
    const result = await moveChildrenWithParent(parent.id, before, { ...before, workarea_id: ROOM_B });

    expect(result.moved).toEqual([]);
    expect(result.left_behind).toEqual([]);
  });

  it('does nothing at all when the placement did not change', async () => {
    const parent = await makeAsset({ display_name: `${PREFIX}_ps`, workarea_id: ROOM_A });
    const screen = await makeAsset({ display_name: `${PREFIX}_s2`, workarea_id: ROOM_A });
    await link(screen, parent);

    const before = placementOf(parent);
    const result = await moveChildrenWithParent(parent.id, before, { ...before });
    expect(result.moved).toEqual([]);
    expect(result.left_behind).toEqual([]);
  });

  it('clears the child coordinates rather than carrying them into another room', async () => {
    // Rooms differ in size and shape, so the old x/y would place it confidently somewhere
    // meaningless. Unplaced in the right room is honest; placed in the wrong spot is not.
    const parent = await makeAsset({ display_name: `${PREFIX}_pk`, workarea_id: ROOM_A });
    const screen = await makeAsset({
      display_name: `${PREFIX}_s3`, workarea_id: ROOM_A, loc_x: 120, loc_y: 340, is_placed: true,
    });
    await link(screen, parent);

    const before = placementOf(parent);
    await moveChildrenWithParent(parent.id, before, { ...before, workarea_id: ROOM_B });

    const after = await AppDataSource.getRepository(Asset).findOne({ where: { id: screen.id } });
    expect(after?.loc_x).toBe(0);
    expect(after?.loc_y).toBe(0);
    expect(after?.is_placed).toBe(false);
  });
});

describe('PATCH /api/assets/:id — the move a person actually makes', () => {
  /**
   * Real Building/Floor/WorkArea rows, not the invented ids the service tests use.
   *
   * The endpoint validates the hierarchy — `findHierarchyMismatch` rejects a room that does not
   * exist — so a test with fake ids would prove nothing about the path a person takes. It also has
   * to send `hierarchy.workarea_id`: that is the shape the map's drag-to-move handler uses, and
   * anything else is silently ignored, which would make this test pass while moving nothing.
   */
  it('moves the screens with the machine and reports it', async () => {
    const buildingRepo = AppDataSource.getRepository(Building);
    const floorRepo = AppDataSource.getRepository(Floor);
    const roomRepo = AppDataSource.getRepository(WorkArea);

    const building = await buildingRepo.save(buildingRepo.create({ name: `${PREFIX}_b` }));
    const floor = await floorRepo.save(floorRepo.create({
      building_id: building.id, name: `${PREFIX}_f`, floor_number: 0,
    }));
    const roomA = await roomRepo.save(roomRepo.create({ floor_id: floor.id, name: `${PREFIX}_A` }));
    const roomB = await roomRepo.save(roomRepo.create({ floor_id: floor.id, name: `${PREFIX}_B` }));
    createdPlaces.push(
      { repo: 'workarea', id: roomA.id }, { repo: 'workarea', id: roomB.id },
      { repo: 'floor', id: floor.id }, { repo: 'building', id: building.id },
    );

    const place = { building_id: building.id, floor_id: floor.id, workarea_id: roomA.id };
    const parent = await makeAsset({ display_name: `${PREFIX}_api`, ...place });
    const screen = await makeAsset({ display_name: `${PREFIX}_apis`, ...place });
    await link(screen, parent);

    const res = await request(app)
      .patch(`/api/assets/${parent.id}`)
      .set(auth())
      .send({ hierarchy: { building_id: building.id, floor_id: floor.id, workarea_id: roomB.id } });
    expect(res.status).toBe(200);

    const after = await AppDataSource.getRepository(Asset).findOne({ where: { id: screen.id } });
    expect(after?.workarea_id).toBe(roomB.id);
    // Silently correct data is still a surprise; the caller is told what came along.
    expect(res.body.children_moved?.moved).toHaveLength(1);
  });
});

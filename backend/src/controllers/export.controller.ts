/**
 * export.controller.ts — Exports factorymap's data in the exact JSON shapes
 * shopfloor_visualizer reads from disk (mvp-2d-demo/data/*.json), so the
 * output can be dropped straight into that app's data/ folder.
 *
 * shopfloor_visualizer has no import API of its own — it just fetch()es
 * static JSON files at startup (see its data.js) — so "import" there means
 * replacing those files. This endpoint is the factorymap-side half of that:
 * it does not talk to shopfloor_visualizer at all, and needs no live
 * IFS/Databricks connection (reads only from factorymap's own tables).
 *
 * Known gaps, left out rather than guessed at:
 *  - sites.json's `placement` (LV95 x/y/rotationDeg) and `model` (glb) are
 *    3D/georeferencing fields factorymap has no data for — exported as
 *    placeholders (origin, no model); buildings will need repositioning in
 *    shopfloor_visualizer's 3D view after import.
 *  - masterData.json's `ifs_machine_part_no` and OTAssetData.json's
 *    `ifs_part_no`/`cmdb_model`/`cmdb_serial_number` have no equivalent
 *    column in MasterAsset — omitted rather than fabricated.
 *  - Only Asset placements are exported as features (the ones with a direct
 *    IFS join, matching shopfloor_visualizer's objectId model). WorkArea/
 *    Section/Workstation/WallPort are factorymap-only concepts with no
 *    matching entityKind convention on the other side.
 */
import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { Asset } from '../entities/Asset.entity';
import { MasterAsset } from '../entities/MasterAsset.entity';
import { ProductionLine } from '../entities/ProductionLine.entity';
import { WorkCenter } from '../entities/WorkCenter.entity';
import { EntityKind } from '../entities/EntityKind.entity';

const FLOORPLANS_DIR = path.resolve(__dirname, '../floorplans');
const DEFAULT_FLOOR_HEIGHT_M = 10;

function isMachine(m: MasterAsset): boolean {
  return !m.ifs_machine_id || m.ifs_machine_id === m.ifs_id;
}

export const exportShopfloorVisualizer = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [buildings, floors, masterAssets, productionLines, workCenters, entityKinds, assets] = await Promise.all([
      AppDataSource.getRepository(Building).find(),
      AppDataSource.getRepository(Floor).find(),
      AppDataSource.getRepository(MasterAsset).find(),
      AppDataSource.getRepository(ProductionLine).find(),
      AppDataSource.getRepository(WorkCenter).find(),
      AppDataSource.getRepository(EntityKind).find(),
      AppDataSource.getRepository(Asset).find({ where: { is_placed: true } }),
    ]);

    // ── masterData.json — plain machines (ifs_machine_id absent or self) ──
    const machineRows = masterAssets.filter(isMachine);
    const masterData = {
      count: machineRows.length,
      assets: machineRows.map((m) => ({
        ifs_site: m.ifs_site,
        ifs_production_line_id: m.ifs_production_line_id,
        ifs_workcenter_id: m.ifs_workcenter_id,
        ifs_workcenter_description: m.ifs_workcenter_description,
        ifs_machine_id: m.ifs_id,
        ifs_machine_part_description: m.ifs_machine_part_description,
        ifs_cost_center: m.ifs_cost_center,
      })),
    };

    // ── OTAssetData.json — IT/network devices attached to a machine ────────
    const otRows = masterAssets.filter((m) => !isMachine(m));
    const otAssetData = {
      count: otRows.length,
      assets: otRows.map((m) => ({
        ifs_site: m.ifs_site,
        ifs_id: m.ifs_id,
        ifs_part_description: m.ifs_machine_part_description ?? 'IT-Managed Device',
        ifs_operational_status: m.ifs_operational_status,
        cmdb_id: m.cmdb_id,
        cmdb_status: m.cmdb_status,
        cmdb_catalog_item: m.cmdb_catalog_item,
        cmdb_manufacturer: m.cmdb_manufacturer,
        cmdb_mac_address: m.cmdb_mac_address,
        cmdb_received_date: m.cmdb_received_date,
        cmdb_os: m.cmdb_os,
        cmdb_os_version: m.cmdb_os_version,
        parent_id: m.ifs_machine_id,
      })),
    };

    // ── workcenters.json / production_lines.json ────────────────────────
    const workcenters = workCenters.map((w) => ({
      WorkCenterNo: w.code,
      Description: w.description,
      ProductionLine: w.production_line_code,
    }));
    const productionLinesOut = productionLines.map((p) => ({
      ProductionLine: p.code,
      Description: p.description,
    }));

    // ── entity_kinds.json ─────────────────────────────────────────────────
    const entityKindsOut = {
      entityKinds: entityKinds.map((k) => ({
        value: k.value,
        label: k.label,
        geometryType: k.geometry_type,
        defaultColor: k.default_color,
        rotatable: k.rotatable,
        exemptFromOrphan: k.exempt_from_orphan,
        ...(k.footprint ? { footprint: k.footprint } : {}),
      })),
    };

    // ── sites.json — single synthetic site wrapping all buildings ─────────
    const floorsByBuilding = new Map<string, Floor[]>();
    floors.forEach((f) => {
      const list = floorsByBuilding.get(f.building_id) ?? [];
      list.push(f);
      floorsByBuilding.set(f.building_id, list);
    });
    const svgFiles: Record<string, string> = {};
    const sites = {
      _comment: 'Generated by factorymap export (see backend/src/controllers/export.controller.ts). placement/model are placeholders — factorymap has no georeferencing/3D-model data; reposition buildings in the 3D view after import.',
      sites: [
        {
          id: 'factorymap',
          name: 'factorymap export',
          unit: 'meter',
          geoAnchor: { lat: 0, lon: 0, rotationDeg: 0 },
          buildings: buildings.map((b) => ({
            id: b.id,
            name: b.name,
            placement: { x: 0, y: 0, rotationDeg: 0 },
            model: null,
            color: '#cccccc',
            floors: (floorsByBuilding.get(b.id) ?? []).map((f) => {
              let svgRef: string | null = null;
              if (f.svg_ref) {
                const resolved = path.resolve(FLOORPLANS_DIR, f.svg_ref);
                const rel = path.relative(FLOORPLANS_DIR, resolved);
                if (!rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(resolved)) {
                  svgRef = f.svg_ref;
                  svgFiles[f.svg_ref] = fs.readFileSync(resolved, 'utf8');
                }
              }
              return {
                id: f.id,
                name: f.name,
                elevationMeters: f.floor_number * DEFAULT_FLOOR_HEIGHT_M,
                heightMeters: DEFAULT_FLOOR_HEIGHT_M,
                floorPlan: svgRef ? { svgRef, scaleMetersPerUnit: f.scale_meters_per_unit ?? 0.01 } : null,
              };
            }),
          })),
        },
      ],
    };

    // ── example_features.json — placed assets only (the ones with a real
    // location), keyed the same way shopfloor_visualizer's own features are.
    const exampleFeatures = {
      _comment: 'Generated by factorymap export. Only Asset placements are included — WorkArea/Section/Workstation/WallPort have no shopfloor_visualizer entityKind equivalent yet.',
      objectTypeTemplates: [] as unknown[],
      features: assets
        .filter((a) => a.floor_id)
        .map((a) => ({
          featureId: `asset-${a.id}`,
          floorId: a.floor_id,
          entityKind: a.entity_kind ?? 'object',
          objectId: a.master_ifs_id ?? a.object_id ?? a.id,
          geometry: a.loc_footprint
            ? { type: 'polygon', closed: true, coords: a.loc_footprint }
            : { type: 'point', closed: false, coords: [[a.loc_x, a.loc_y]] },
          rotationDeg: a.loc_rotation ?? 0,
          style: { colorOverride: null },
        })),
    };

    res.json({
      success: true,
      data: {
        files: {
          'masterData.json': masterData,
          'OTAssetData.json': otAssetData,
          'workcenters.json': workcenters,
          'production_lines.json': productionLinesOut,
          'entity_kinds.json': entityKindsOut,
          'sites.json': sites,
          'example_features.json': exampleFeatures,
        },
        svgFiles,
      },
    });
  } catch (error) { next(error); }
};

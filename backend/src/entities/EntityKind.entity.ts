/**
 * EntityKind.entity.ts — Configurable, extensible "placeable type" reference
 * data for the floor map.
 *
 * A 1:1 mirror of shopfloor_visualizer's entity_kinds.json: new map-placeable
 * types (beyond a plain object) should be addable as data, not code. Only
 * Asset consumes this in this phase (Asset.entity_kind, soft join to `value`)
 * — NetworkRack/PatchPanel/WallPort stay their own tables for now (unifying
 * them into this model needs the frontend rewrite; see
 * docs/DATA_MODEL_MIGRATION.md).
 *
 * The 3D fields below (`model`, `model_scale`, `preserve_model_colors`) exist
 * so that shopfloor_visualizer's entity_kinds.json round-trips through here
 * without losing data — factorymap has no 3D view and doesn't render them,
 * but it must be able to *eat and re-emit* the same config file. They are
 * all optional. `geometry_type` also accepts `'object'` (his 3D-model kind)
 * for the same round-trip reason.
 *
 * This is seed/config data, imported alongside master data via
 * `backend/src/scripts/import-master-data.ts` when an entity_kinds.json is
 * present — not ingested from IFS/Databricks (it isn't IFS data).
 */
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('entity_kinds')
export class EntityKind {
  @PrimaryColumn({ name: 'value', type: 'nvarchar', length: 50 })
  value!: string;

  @Column({ type: 'nvarchar', length: 200 })
  label!: string;

  @Column({ name: 'geometry_type', type: 'nvarchar', length: 20, default: 'point' })
  geometry_type!: 'point' | 'polyline' | 'polygon' | 'object';

  @Column({ name: 'default_color', type: 'nvarchar', length: 20, nullable: true })
  default_color!: string | null;

  @Column({ type: 'bit', default: false })
  rotatable!: boolean;

  @Column({ name: 'exempt_from_orphan', type: 'bit', default: false })
  exempt_from_orphan!: boolean;

  // Polygon outline in cm, centered on the placement point — same convention
  // as Asset.loc_footprint (see Asset.entity.ts).
  @Column({ type: 'simple-json', nullable: true })
  footprint!: Array<[number, number]> | null;

  // ── 3D-view fields (stored for round-trip only; factorymap has no 3D) ─────
  @Column({ name: 'model', type: 'nvarchar', length: 200, nullable: true })
  model!: string | null; // glb filename, e.g. 'info_sphere.glb'

  @Column({ name: 'model_scale', type: 'float', nullable: true })
  model_scale!: number | null;

  @Column({ name: 'preserve_model_colors', type: 'bit', nullable: true })
  preserve_model_colors!: boolean | null;

  toApiResponse() {
    return {
      value: this.value,
      label: this.label,
      geometry_type: this.geometry_type,
      default_color: this.default_color,
      rotatable: this.rotatable,
      exempt_from_orphan: this.exempt_from_orphan,
      footprint: this.footprint,
      model: this.model,
      model_scale: this.model_scale,
      preserve_model_colors: this.preserve_model_colors,
    };
  }
}

/**
 * EntityKind.entity.ts — Configurable, extensible "placeable type" reference
 * data for the floor map.
 *
 * Mirrors shopfloor_visualizer's entity_kinds.json: new map-placeable types
 * (beyond a plain object) should be addable as data, not code. Only Asset
 * consumes this in this phase (Asset.entity_kind, soft join to `value`) —
 * NetworkRack/PatchPanel/WallPort stay their own tables for now (unifying
 * them into this model needs the frontend rewrite; see
 * docs/DATA_MODEL_MIGRATION.md).
 *
 * No live IFS/Databricks connection — this table is seed/config data only,
 * not something ingested from any external system.
 */
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('entity_kinds')
export class EntityKind {
  @PrimaryColumn({ name: 'value', type: 'nvarchar', length: 50 })
  value!: string;

  @Column({ type: 'nvarchar', length: 200 })
  label!: string;

  @Column({ name: 'geometry_type', type: 'nvarchar', length: 20, default: 'point' })
  geometry_type!: 'point' | 'polyline' | 'polygon';

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

  toApiResponse() {
    return {
      value: this.value,
      label: this.label,
      geometry_type: this.geometry_type,
      default_color: this.default_color,
      rotatable: this.rotatable,
      exempt_from_orphan: this.exempt_from_orphan,
      footprint: this.footprint,
    };
  }
}

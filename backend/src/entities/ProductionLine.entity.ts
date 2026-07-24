/**
 * ProductionLine.entity.ts — Organizational reference data (IFS-aligned).
 *
 * Mirrors shopfloor_visualizer's Department → ProductionLine → WorkCenter →
 * Resource organizational hierarchy: this is reference/lookup data (a code +
 * description), not geometry — Production Line areas have no shape of their
 * own here (unlike shopfloor_visualizer, which reads them from SVG layers;
 * that part of the model is a later, frontend-dependent phase — see
 * docs/DATA_MODEL_MIGRATION.md).
 *
 * No live IFS/Databricks connection exists yet — populated by hand via the
 * seed script only, same constraint as MasterAsset.
 */
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('production_lines')
export class ProductionLine {
  @PrimaryColumn({ name: 'code', type: 'nvarchar', length: 50 })
  code!: string;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  description!: string | null;

  toApiResponse() {
    return { code: this.code, description: this.description };
  }
}

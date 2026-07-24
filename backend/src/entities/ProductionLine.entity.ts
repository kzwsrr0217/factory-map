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
 * Column set verified against shopfloor_visualizer's real IFS export
 * (`ifs-ingest/get_workcenters.py` + `production_lines.json`): the source
 * rows carry `Contract` (= site) and `Description`. `contract` is stored
 * **optional** so a plain `{code, description}` seed row still works, but an
 * IFS import can populate it. `code` maps to the export's `ProductionLine`.
 *
 * Populated by `backend/src/scripts/import-master-data.ts` against exported
 * JSON today; a live IFS call later only touches that script.
 */
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('production_lines')
export class ProductionLine {
  @PrimaryColumn({ name: 'code', type: 'nvarchar', length: 50 })
  code!: string;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  description!: string | null;

  // IFS `Contract` — the site this line belongs to (e.g. 'MMAG'). Optional:
  // reference data seeded by hand omits it; an IFS import fills it.
  @Column({ name: 'contract', type: 'nvarchar', length: 20, nullable: true })
  contract!: string | null;

  toApiResponse() {
    return { code: this.code, description: this.description, contract: this.contract };
  }
}

/**
 * WorkCenter.entity.ts — Organizational reference data (IFS-aligned).
 *
 * See ProductionLine.entity.ts for the rationale. `production_line_code` is a
 * soft join (no FK/cascade) to ProductionLine.code — same orphan-safe
 * principle as Asset.master_ifs_id: this is externally-sourced reference
 * data, so a missing/renamed production line must never cascade-delete a
 * work center.
 *
 * Column set verified against shopfloor_visualizer's real IFS export
 * (`ifs-ingest/get_workcenters.py` + `workcenters.json`), whose rows carry
 * `Contract`, `Objstate`, `WorkCenterNo`, `DepartmentNo`, `Description`,
 * `ProductionLine`, `CostCenterId`. The extra IFS fields below
 * (`contract`, `objstate`, `department_no`, `cost_center_id`) are all
 * **optional** — a plain `{code, description, production_line_code}` seed row
 * still works, but an IFS import can populate them. `code` maps to the
 * export's `WorkCenterNo`, `production_line_code` to its `ProductionLine`.
 *
 * Populated by `backend/src/scripts/import-master-data.ts` against exported
 * JSON today.
 */
import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

@Entity('work_centers')
export class WorkCenter {
  @PrimaryColumn({ name: 'code', type: 'nvarchar', length: 50 })
  code!: string;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ name: 'production_line_code', type: 'nvarchar', length: 50, nullable: true })
  @Index('IDX_work_centers_production_line_code')
  production_line_code!: string | null;

  // ── IFS export extras (all optional — see class doc) ──────────────────────
  @Column({ name: 'contract', type: 'nvarchar', length: 20, nullable: true })
  contract!: string | null; // site, e.g. 'MMAG'

  @Column({ name: 'objstate', type: 'nvarchar', length: 30, nullable: true })
  objstate!: string | null; // e.g. 'Active' — lets a report hide inactive work centers

  @Column({ name: 'department_no', type: 'nvarchar', length: 50, nullable: true })
  department_no!: string | null;

  @Column({ name: 'cost_center_id', type: 'nvarchar', length: 50, nullable: true })
  cost_center_id!: string | null;

  toApiResponse() {
    return {
      code: this.code,
      description: this.description,
      production_line_code: this.production_line_code,
      contract: this.contract,
      objstate: this.objstate,
      department_no: this.department_no,
      cost_center_id: this.cost_center_id,
    };
  }
}

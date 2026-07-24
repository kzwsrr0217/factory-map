/**
 * WorkCenter.entity.ts — Organizational reference data (IFS-aligned).
 *
 * See ProductionLine.entity.ts for the rationale. `production_line_code` is a
 * soft join (no FK/cascade) to ProductionLine.code — same orphan-safe
 * principle as Asset.master_ifs_id: this is externally-sourced reference
 * data, so a missing/renamed production line must never cascade-delete a
 * work center.
 *
 * No live IFS/Databricks connection exists yet — populated by hand via the
 * seed script only.
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

  toApiResponse() {
    return {
      code: this.code,
      description: this.description,
      production_line_code: this.production_line_code,
    };
  }
}

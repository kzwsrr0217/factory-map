/**
 * hierarchy.types.ts — TypeScript interfaces for the location hierarchy.
 *
 * Describes the five levels of the spatial hierarchy used by both the backend
 * types and the frontend services:
 *   Building → Floor → WorkArea → Section → Workstation
 *
 * `ICoordinates` is a shared type used for both canvas positions (assets on a
 * floor map) and polygon coordinates (work area zone boundaries).
 */
export interface ICoordinates {
  x: number;
  y: number;
}

export interface IBuilding {
  _id?: string;
  name: string;
  address?: string;
  metadata?: {
    total_area?: number;
    construction_year?: number;
    [key: string]: unknown;
  };
  created_at?: Date;
  updated_at?: Date;
}

export interface IFloor {
  _id?: string;
  building_id: string;
  floor_number: number;
  name: string;
  map_file?: string;
  map_metadata?: {
    viewBox: string;
    scale?: string;
    bounds: [[number, number], [number, number]];
    [key: string]: unknown;
  };
  created_at?: Date;
  updated_at?: Date;
}

export interface IWorkArea {
  _id?: string;
  floor_id: string;
  name: string;
  type: string;
  svg_zone_id?: string;
  polygon_coordinates?: ICoordinates[];
  color?: string;
  manager?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface ISection {
  _id?: string;
  workarea_id: string;
  name: string;
  coordinates: ICoordinates;
  capacity?: number;
  shift_schedule?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface IWorkstation {
  _id?: string;
  section_id: string;
  name: string;
  coordinates: ICoordinates;
  rotation?: number;
  type: string;
  status: 'active' | 'inactive' | 'maintenance';
  created_at?: Date;
  updated_at?: Date;
}

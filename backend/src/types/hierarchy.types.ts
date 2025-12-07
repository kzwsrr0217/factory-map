import { Types } from 'mongoose';

/**
 * Hierarchy Types
 * Building → Floor → WorkArea → Section → Workstation
 */

export interface ICoordinates {
  x: number;
  y: number;
}

export interface IBuilding {
  _id?: Types.ObjectId | string;
  name: string;
  address?: string;
  metadata?: {
    total_area?: number;
    construction_year?: number;
    [key: string]: any;
  };
  created_at?: Date;
  updated_at?: Date;
}

export interface IFloor {
  _id?: Types.ObjectId | string;
  building_id: string;
  floor_number: number;
  name: string;
  map_file?: string;
  map_metadata?: {
    viewBox: string;
    scale?: string;
    bounds: [[number, number], [number, number]];
    [key: string]: any;
  };
  created_at?: Date;
  updated_at?: Date;
}

export interface IWorkArea {
  _id?: Types.ObjectId | string;  
  floor_id: string;
  name: string;
  type: string; // e.g., "production", "office", "warehouse"
  svg_zone_id?: string;
  polygon_coordinates?: ICoordinates[];
  color?: string;
  manager?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface ISection {
  _id?: Types.ObjectId | string;
  workarea_id: string;
  name: string;
  coordinates: ICoordinates;
  capacity?: number;
  shift_schedule?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface IWorkstation {
  _id?: Types.ObjectId | string;
  section_id: string;
  name: string;
  coordinates: ICoordinates;
  rotation?: number;
  type: string; // e.g., "desk", "machine", "workbench"
  status: 'active' | 'inactive' | 'maintenance';
  created_at?: Date;
  updated_at?: Date;
}
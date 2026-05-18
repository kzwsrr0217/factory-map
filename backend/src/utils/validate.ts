/**
 * validate.ts — Zod schemas and a request-validation helper for API endpoints.
 *
 * `validate(schema)` returns an Express middleware that parses req.body through
 * the given Zod schema. On failure it responds 400 with the first validation
 * error message. On success the parsed (and coerced) value replaces req.body.
 */
import { z, ZodTypeAny } from 'zod';
import { Request, Response, NextFunction } from 'express';

export function validate<T extends ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? 'Invalid request body';
      res.status(400).json({ success: false, error: msg });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ── Shared primitives ─────────────────────────────────────────────────────────

const str200 = (label: string) => z.string().min(1, `${label} is required`).max(200, `${label} must be ≤200 characters`);

// ── Building schemas ──────────────────────────────────────────────────────────

export const BuildingCreateSchema = z.object({
  name:     str200('name'),
  address:  z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const BuildingUpdateSchema = BuildingCreateSchema.partial();

// ── Network Room schemas ──────────────────────────────────────────────────────

const ROOM_TYPES = ['mdf', 'idf', 'server_room', 'other'] as const;

export const RoomCreateSchema = z.object({
  name:             str200('name'),
  type:             z.enum(ROOM_TYPES).default('idf'),
  building_id:      z.string().uuid({ message: 'Must be a valid UUID' }).optional().nullable(),
  floor_id:         z.string().uuid({ message: 'Must be a valid UUID' }).optional().nullable(),
  description:      z.string().max(1000).optional().nullable(),
  redundant_pair_id: z.string().uuid({ message: 'Must be a valid UUID' }).optional().nullable(),
});

export const RoomUpdateSchema = RoomCreateSchema.partial();

// ── Network Rack schemas ──────────────────────────────────────────────────────

export const RackCreateSchema = z.object({
  name:            str200('name'),
  network_room_id: z.string().uuid({ message: 'Must be a valid UUID' }),
  description:     z.string().max(1000).optional().nullable(),
  units:           z.number().int().min(1).max(100).optional(),
});

export const RackUpdateSchema = RackCreateSchema.partial();

// ── Asset schemas ─────────────────────────────────────────────────────────────

export const AssetCreateSchema = z.object({
  basic_info: z.object({
    display_name: str200('display_name'),
    asset_tag:    z.string().max(100).optional().nullable(),
    serial_number:z.string().max(100).optional().nullable(),
    model:        z.string().max(200).optional().nullable(),
    manufacturer: z.string().max(200).optional().nullable(),
    status:       z.string().max(50).optional().nullable(),
    type:         z.string().max(100).optional().nullable(),
    os_type:      z.string().max(100).optional().nullable(),
    os_version:   z.string().max(100).optional().nullable(),
    mac_address:  z.string().max(50).optional().nullable(),
  }).optional(),
  technical_specs: z.object({
    cpu:     z.string().max(200).optional().nullable(),
    ram:     z.string().max(50).optional().nullable(),
    storage: z.string().max(100).optional().nullable(),
    gpu:     z.string().max(100).optional().nullable(),
  }).optional(),
  network: z.object({
    ip_address:  z.string().max(50).optional().nullable(),
    hostname:    z.string().max(200).optional().nullable(),
    vlan:        z.string().max(50).optional().nullable(),
    switch_port: z.string().max(50).optional().nullable(),
    dhcp_static: z.string().max(10).optional().nullable(),
  }).optional(),
  hierarchy: z.object({
    building_id:   z.string().uuid().optional().nullable(),
    floor_id:      z.string().uuid().optional().nullable(),
    workarea_id:   z.string().uuid().optional().nullable(),
    section_id:    z.string().uuid().optional().nullable(),
    workstation_id:z.string().uuid().optional().nullable(),
  }).optional(),
  location: z.object({
    coordinates: z.object({
      x: z.number().optional(),
      y: z.number().optional(),
    }).optional(),
    rotation:    z.number().optional(),
    icon_type:   z.string().max(50).optional().nullable(),
    description: z.string().max(500).optional().nullable(),
  }).optional(),
  custom_fields: z.object({
    physical_condition:   z.string().max(20).optional().nullable(),
    environment:          z.string().max(200).optional().nullable(),
    notes:                z.string().max(10000).optional().nullable(),
    tags:                 z.array(z.string().max(100)).max(50).optional().nullable(),
    object_id:            z.string().max(100).optional().nullable(),
    serial_object:        z.string().max(100).optional().nullable(),
    remote_access_tool:   z.string().max(200).optional().nullable(),
    remote_access_version:z.string().max(100).optional().nullable(),
    backup_tool:          z.string().max(200).optional().nullable(),
    backup_status:        z.string().max(50).optional().nullable(),
    fortiedr_active:      z.boolean().optional().nullable(),
  }).optional(),
  maintenance: z.object({
    last_date:     z.string().optional().nullable(),
    next_date:     z.string().optional().nullable(),
    interval_days: z.number().int().min(0).max(3650).optional().nullable(),
    notes:         z.string().max(2000).optional().nullable(),
  }).optional(),
  assigned_person: z.object({
    person_id:  z.string().max(100).optional().nullable(),
    itsm_id:    z.string().max(100).optional().nullable(),
    full_name:  z.string().max(200).optional().nullable(),
  }).nullable().optional(),
  software:       z.array(z.record(z.unknown())).max(500).optional(),
  work_items:     z.array(z.record(z.unknown())).max(100).optional(),
  predecessor_id: z.string().uuid().optional().nullable(),
  successor_id:   z.string().uuid().optional().nullable(),
  wall_port_id:   z.string().uuid().optional().nullable(),
}).passthrough();

export const AssetUpdateSchema = AssetCreateSchema;

export const BulkAssetSchema = z.object({
  assets: z.array(AssetCreateSchema).min(1).max(500),
});

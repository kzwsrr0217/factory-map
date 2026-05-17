/**
 * handlers.ts — MSW request handlers for /api/* in frontend tests.
 *
 * Provides minimal mock responses for auth and asset endpoints so tests
 * don't require a running backend.
 */
import { rest } from 'msw';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

export const handlers = [
  // Auth
  rest.get(`${API}/auth/capabilities`, (_req, res, ctx) =>
    res(ctx.json({ success: true, data: { local: true, ldap: false, azure: false } })),
  ),

  rest.post(`${API}/auth/login`, async (req, res, ctx) => {
    const body = await req.json() as { username?: string; password?: string };
    if (body.username === 'admin' && body.password === 'Admin@1234') {
      return res(ctx.json({
        success: true,
        data: {
          token: 'mock.jwt.token',
          user: { _id: '1', username: 'admin', role: 'admin' },
        },
      }));
    }
    return res(ctx.status(401), ctx.json({ success: false, error: 'Invalid credentials' }));
  }),

  rest.get(`${API}/auth/me`, (_req, res, ctx) =>
    res(ctx.json({
      success: true,
      data: { _id: '1', username: 'admin', role: 'admin' },
    })),
  ),

  // Assets
  rest.get(`${API}/assets`, (_req, res, ctx) =>
    res(ctx.json({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 50, totalPages: 0 },
    })),
  ),

  rest.get(`${API}/assets/lookups`, (_req, res, ctx) =>
    res(ctx.json({ success: true, data: {} })),
  ),

  // Alerts
  rest.get(`${API}/alerts/config`, (_req, res, ctx) =>
    res(ctx.json({
      success: true,
      data: {
        id: 'global',
        email_enabled: false,
        email_recipients: [],
        teams_enabled: false,
        teams_webhook_url: null,
        days_before_alert: 7,
        alert_on_maintenance: true,
        alert_on_overdue: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })),
  ),

  rest.get(`${API}/alerts/logs`, (_req, res, ctx) =>
    res(ctx.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } })),
  ),

  rest.get(`${API}/alerts/scheduled`, (_req, res, ctx) =>
    res(ctx.json({ success: true, data: [] })),
  ),

  // Network infrastructure
  rest.get(`${API}/network/rooms`, (_req, res, ctx) =>
    res(ctx.json({
      success: true,
      data: [
        {
          _id: 'room-1', name: 'MDF-W1', type: 'mdf',
          building_id: 'bld-1', floor_id: null, description: null,
          redundant_pair_id: null, racks: [],
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        },
        {
          _id: 'room-2', name: 'IDF-W1-GF', type: 'idf',
          building_id: 'bld-1', floor_id: 'floor-1', description: null,
          redundant_pair_id: null, racks: [],
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        },
      ],
    })),
  ),

  rest.get(`${API}/network/rooms/:id`, (req, res, ctx) =>
    res(ctx.json({
      success: true,
      data: {
        _id: req.params.id, name: 'MDF-W1', type: 'mdf',
        building_id: 'bld-1', floor_id: null, description: null,
        redundant_pair_id: null, racks: [],
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    })),
  ),

  rest.post(`${API}/network/rooms`, (_req, res, ctx) =>
    res(ctx.status(201), ctx.json({
      success: true,
      data: {
        _id: 'room-new', name: 'New Room', type: 'idf',
        building_id: 'bld-1', floor_id: null, description: null,
        redundant_pair_id: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    })),
  ),

  rest.get(`${API}/network/wall-ports`, (_req, res, ctx) =>
    res(ctx.json({ success: true, data: [] })),
  ),

  // Buildings + Floors (for network infra building selector)
  rest.get(`${API}/buildings`, (_req, res, ctx) =>
    res(ctx.json({
      success: true,
      data: [{ _id: 'bld-1', name: 'WERK1 — Main Production', created_at: '', updated_at: '' }],
    })),
  ),

  rest.get(`${API}/buildings/:id`, (req, res, ctx) =>
    res(ctx.json({
      success: true,
      data: {
        _id: req.params.id,
        name: 'WERK1 — Main Production',
        address: 'Test Street 1',
        created_at: '', updated_at: '',
      },
    })),
  ),

  rest.get(`${API}/floors`, (_req, res, ctx) =>
    res(ctx.json({
      success: true,
      data: [
        { _id: 'floor-1', name: 'Ground Floor', floor_number: 0, building_id: 'bld-1', created_at: '', updated_at: '' },
        { _id: 'floor-2', name: 'First Floor', floor_number: 1, building_id: 'bld-1', created_at: '', updated_at: '' },
      ],
    })),
  ),

  rest.get(`${API}/floors/:id`, (req, res, ctx) =>
    res(ctx.json({
      success: true,
      data: { _id: req.params.id, name: 'Ground Floor', floor_number: 0, building_id: 'bld-1', created_at: '', updated_at: '' },
    })),
  ),

  rest.get(`${API}/workareas`, (_req, res, ctx) =>
    res(ctx.json({ success: true, data: [] })),
  ),

  rest.get(`${API}/sections`, (_req, res, ctx) =>
    res(ctx.json({ success: true, data: [] })),
  ),

  rest.get(`${API}/workstations`, (_req, res, ctx) =>
    res(ctx.json({ success: true, data: [] })),
  ),
];

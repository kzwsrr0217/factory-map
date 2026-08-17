/**
 * nexthinkApi.ts — fetches the same two datasets the CSV importer reads, from the NQL API.
 *
 * The CSV path is not being replaced. Both paths hand the same row shapes to
 * `planNexthinkImport`, which is why that function has always taken parsed rows rather than file
 * paths: the seam existed before there was anything to put on the other side of it. If the API
 * credential is ever revoked or a query is renamed, the hand export still works, unchanged.
 *
 * What the API costs in exchange for not being a manual step:
 *
 *  - Two hostnames, not one. The token comes from `<instance>-login.<region>.nexthink.cloud`,
 *    the data from `<instance>.api.<region>.nexthink.cloud`. They look similar enough to be
 *    typed wrong once each.
 *  - The token lives 15 minutes. Short enough that a slow import could outlive it, so it is
 *    refreshed on age AND retried once on a 401 rather than trusted to arithmetic.
 *  - The queries are not sent. Only a saved query's id (`#some_id`) is, and it has to have been
 *    created in the Nexthink web interface and flagged for API use. So the entity filter and the
 *    91-day window live in Nexthink, and a change there changes this import with no deploy —
 *    which is both the convenience and the risk. `describeSource()` exists so every run records
 *    which query id it actually used.
 *
 * Documented at https://docs.nexthink.com/api/nql/execute-an-nql and
 * https://docs.nexthink.com/API/getting-authentication-token.
 *
 * UNVERIFIED, and deliberately handled rather than assumed: what the API names its columns. The
 * CSV grid export uses fully-qualified NQL paths as headers (`device.name`,
 * `device.hardware.type`), and the API's JSON rows may use those, or the bare leaf names, or the
 * aliases from the saved query's `list` clause. Nothing here guesses — `pick()` accepts any of
 * the plausible spellings, and if it cannot find the device name at all the error prints the keys
 * the API actually returned. A wrong guess that silently produced 334 empty rows would be far
 * worse than a failure that says what it saw.
 */
import config from '../../config/config';
import {
  NexthinkDeviceRow,
  NexthinkLoginRow,
  parseNexthinkDate,
  classifyAccount,
} from './snapshotImport';

/** Refresh this far before the documented 15-minute expiry rather than racing it. */
const TOKEN_TTL_MS = 12 * 60 * 1000;

/** Per-request ceiling. The device query is a few hundred rows; anything slower is wrong. */
const REQUEST_TIMEOUT_MS = 60_000;

interface CachedToken {
  token: string;
  fetchedAt: number;
}
let cached: CachedToken | null = null;

function loginHost(): string {
  const { instance, region } = config.nexthink;
  return `https://${instance}-login.${region}.nexthink.cloud`;
}

function apiHost(): string {
  const { instance, region } = config.nexthink;
  return `https://${instance}.api.${region}.nexthink.cloud`;
}

/**
 * Everything that must be set before a call is attempted, checked in one place.
 *
 * Returned as a list rather than thrown one at a time: a half-configured `.env` should produce
 * one message naming every missing variable, not four runs each revealing the next one.
 */
export function missingApiConfig(): string[] {
  const n = config.nexthink;
  const missing: string[] = [];
  if (!n.instance) missing.push('NEXTHINK_INSTANCE');
  if (!n.clientId) missing.push('NEXTHINK_CLIENT_ID');
  if (!n.clientSecret) missing.push('NEXTHINK_CLIENT_SECRET');
  if (!n.devicesQueryId) missing.push('NEXTHINK_DEVICES_QUERY_ID');
  if (!n.loginsQueryId) missing.push('NEXTHINK_LOGINS_QUERY_ID');
  return missing;
}

/** What this run pulled, for the import log. Never includes the client secret. */
export function describeSource(): string {
  const n = config.nexthink;
  return `${apiHost()} · devices ${n.devicesQueryId} · logins ${n.loginsQueryId}`;
}

async function getToken(force = false): Promise<string> {
  if (!force && cached && Date.now() - cached.fetchedAt < TOKEN_TTL_MS) return cached.token;

  const { clientId, clientSecret } = config.nexthink;
  // Basic auth, then a bearer token back — Nexthink's own docs call this "BasicToBearer".
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${loginHost()}/oauth2/default/v1/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'service:integration' }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    /**
     * The status is named but the body is NOT included. A failed token response can echo request
     * details, and this text ends up in import logs that are less carefully handled than the
     * `.env` the secret came from.
     */
    throw new Error(
      `Nexthink token request failed: HTTP ${res.status} from ${loginHost()}.`
      + (res.status === 401
        ? ' The client id or secret was rejected — check NEXTHINK_CLIENT_ID/NEXTHINK_CLIENT_SECRET.'
        : res.status === 400
          ? ' The request was malformed, which usually means the scope is not granted to this credential.'
          : ''),
    );
  }

  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('Nexthink token response contained no access_token.');
  cached = { token: body.access_token, fetchedAt: Date.now() };
  return cached.token;
}

interface NqlV2Response {
  queryId: string;
  executedQuery: string;
  /** The row count the server says it returned — compared against what was parsed. */
  rows: number;
  executionDateTime: string;
  data: Array<Record<string, unknown>>;
}

/**
 * Run one saved query. Retries exactly once on a 401, with a fresh token.
 *
 * One retry, not a loop: a 401 after a deliberately-refreshed token is a permissions problem, and
 * retrying a permissions problem just turns a clear failure into a slow one.
 */
async function executeQuery(queryId: string): Promise<NqlV2Response> {
  const call = async (token: string) => fetch(`${apiHost()}/api/v2/nql/execute`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ queryId }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let res = await call(await getToken());
  if (res.status === 401) res = await call(await getToken(true));

  if (!res.ok) {
    const hint = res.status === 404
      ? ` No saved query with id "${queryId}". The id must exist in Nexthink and be flagged for API use.`
      : res.status === 403
        ? ' The credential lacks the NQL API permission.'
        : '';
    throw new Error(`Nexthink NQL execute failed: HTTP ${res.status} for ${queryId}.${hint}`);
  }

  const body = (await res.json()) as NqlV2Response;
  if (!Array.isArray(body.data)) {
    throw new Error(`Nexthink returned no data array for ${queryId} — got keys: ${Object.keys(body).join(', ')}`);
  }
  // The docs specify no row cap, which is not the same as there being none. If the server's own
  // count disagrees with the array, something truncated it and the import must not proceed
  // quietly on a partial estate — a full-replace of a truncated snapshot deletes real rows.
  if (typeof body.rows === 'number' && body.rows !== body.data.length) {
    throw new Error(
      `Nexthink reported ${body.rows} row(s) for ${queryId} but returned ${body.data.length}.`
      + ' Refusing a partial snapshot: this import replaces the table wholesale.',
    );
  }
  return body;
}

/**
 * Read one field, accepting every spelling the API might use for it.
 *
 * See the file header: the column naming is the one thing about this API that could not be
 * verified without a live credential. Given `device.hardware.type`, this tries that, then
 * `hardware.type`, then `type` — so a saved query that aliases its columns still works.
 */
function pick(row: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    const candidate = parts.slice(i).join('.');
    const value = row[candidate];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return undefined;
}

/** Fails with the actual key list rather than returning rows that are silently empty. */
function requireDeviceName(row: Record<string, unknown>, queryId: string): string {
  const name = pick(row, 'device.name')?.trim();
  if (!name) {
    throw new Error(
      `Could not find a device name in the rows returned by ${queryId}.`
      + ` The columns present are: ${Object.keys(row).join(', ')}.`
      + ' Adjust the saved query to list device.name, or extend pick() for this naming.',
    );
  }
  return name;
}

export interface ApiFetchResult<T> {
  rows: T[];
  /** Rows the API returned that had no usable date — same accounting as the CSV path. */
  unparseable_dates: number;
  /** What the server said it ran, recorded so a changed saved query is visible after the fact. */
  executed_query: string;
}

export async function fetchDevices(): Promise<ApiFetchResult<NexthinkDeviceRow>> {
  const { devicesQueryId } = config.nexthink;
  const body = await executeQuery(devicesQueryId);
  const rows: NexthinkDeviceRow[] = [];
  let unparseable = 0;
  for (const r of body.data) {
    const rawLastSeen = pick(r, 'device.last_seen');
    const lastSeen = parseNexthinkDate(rawLastSeen);
    if (rawLastSeen && !lastSeen) unparseable++;
    rows.push({
      device_name: requireDeviceName(r, devicesQueryId),
      entity: pick(r, 'device.entity') ?? null,
      first_seen: parseNexthinkDate(pick(r, 'device.first_seen')),
      last_seen: lastSeen,
      hardware_type: pick(r, 'device.hardware.type') ?? null,
      manufacturer: pick(r, 'device.hardware.manufacturer') ?? null,
      model: pick(r, 'device.hardware.model') ?? null,
      bios_serial: pick(r, 'device.hardware.bios_serial_number') ?? null,
      os_name: pick(r, 'device.operating_system.name') ?? null,
    });
  }
  return { rows, unparseable_dates: unparseable, executed_query: body.executedQuery };
}

export async function fetchLogins(): Promise<ApiFetchResult<NexthinkLoginRow> & { skipped: number }> {
  const { loginsQueryId } = config.nexthink;
  const body = await executeQuery(loginsQueryId);
  const rows: NexthinkLoginRow[] = [];
  // Same de-duplication as the CSV path: (device, user) is the primary key, and a duplicate
  // would otherwise fail the insert halfway through instead of being counted.
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of body.data) {
    const device = requireDeviceName(r, loginsQueryId);
    const user = pick(r, 'user.name')?.trim();
    if (!user) {
      skipped++;
      continue;
    }
    const key = `${device.toLowerCase()}|${user.toLowerCase()}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const fullName = pick(r, 'user.ad.full_name') ?? null;
    rows.push({
      device_name: device,
      user_name: user,
      full_name: fullName,
      logins: Number.parseInt(pick(r, 'logins') ?? '0', 10) || 0,
      account_kind: classifyAccount(device, user, fullName),
    });
  }
  return { rows, unparseable_dates: 0, executed_query: body.executedQuery, skipped };
}

/** Reset the cached token. For tests, and for a long-lived process that changed credentials. */
export function resetTokenCache(): void {
  cached = null;
}

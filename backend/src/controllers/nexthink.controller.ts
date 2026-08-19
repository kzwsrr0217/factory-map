/**
 * nexthink.controller.ts — the Nexthink round without a terminal.
 *
 * Everything here existed as a script first. The scripts stay: a scheduled run has no browser, and
 * the CSV path has to keep working when a credential is revoked or a saved query is renamed. What
 * these endpoints add is that somebody who is not the person with the terminal can run a round.
 *
 * Read is open to any authenticated role, as every other read in this app is. Writing — which means
 * replacing both snapshot tables — is `requireOperator`, like every other import.
 */
import { Request, Response, NextFunction } from 'express';
import {
  planNexthinkImport,
  parseNexthinkDevicesCsv,
  parseNexthinkLoginsCsv,
} from '../services/nexthink/snapshotImport';
import { getNexthinkOverview } from '../services/nexthink/overview';
import { AuthRequest } from '../middleware/auth.middleware';

/**
 * getOverview: the state of the source and every question it raises.
 *
 * One call rather than five, because the five reports answer questions about one snapshot and a page
 * that needed five requests would show them arriving at different times.
 */
export const getNexthinkOverviewHandler = async (
  _req: Request, res: Response, next: NextFunction,
): Promise<void> => {
  try {
    res.json({ success: true, data: await getNexthinkOverview() });
  } catch (error) {
    next(error);
  }
};

/**
 * importNexthink: load one or both exports.
 *
 * The CSV **text** is posted and parsed here, not in the browser — the same choice the ITSM snapshot
 * import makes, and for the same reason: one place knows the export's column names, and it is the
 * place that owns the parser. The browser reading the file only means the file itself never lands on
 * the server.
 *
 * `apply` defaults to FALSE. This replaces two tables wholesale, so writing is something the caller
 * has to ask for, and the dry run is the thing worth looking at first — it is the only place the
 * join against the map gets measured before anything is overwritten.
 */
export const importNexthinkFromUpload = async (
  req: AuthRequest, res: Response, next: NextFunction,
): Promise<void> => {
  try {
    const body = req.body as {
      devicesCsv?: string | null;
      loginsCsv?: string | null;
      apply?: boolean;
    };
    if (typeof body.devicesCsv !== 'string' && typeof body.loginsCsv !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Send at least one of devicesCsv or loginsCsv as text.',
      });
      return;
    }

    /**
     * A file that parses to nothing is rejected rather than imported as an empty snapshot.
     *
     * With `apply` that would clear the table and report success — the worst possible outcome for a
     * wrong file, because every report built on it would then honestly say the estate is empty.
     */
    const devices = typeof body.devicesCsv === 'string'
      ? parseNexthinkDevicesCsv(body.devicesCsv) : null;
    const logins = typeof body.loginsCsv === 'string'
      ? parseNexthinkLoginsCsv(body.loginsCsv) : null;

    if (devices && devices.rows.length === 0) {
      res.status(400).json({
        success: false,
        error: 'The devices file produced no usable rows. Expected the Investigations grid export, '
          + 'whose header carries the full NQL field names (device.name, device.last_seen, …).',
      });
      return;
    }
    if (logins && logins.rows.length === 0) {
      res.status(400).json({
        success: false,
        error: 'The logons file produced no usable rows. Expected columns device.name, user.name, '
          + 'user.ad.full_name and logins.',
      });
      return;
    }

    const plan = await planNexthinkImport({
      devices,
      logins,
      apply: body.apply === true,
      by: req.user?.username ?? 'system',
    });
    res.json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
};

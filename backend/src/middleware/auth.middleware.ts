/**
 * auth.middleware.ts — JWT authentication and role-based access control.
 *
 * `authenticate`: Validates Bearer token, checks the in-memory revocation set
 * (populated from DB on startup and updated on logout/revoke), attaches
 * req.user for downstream controllers.
 *
 * `requireAdmin`: Chains after authenticate; rejects non-admin users with 403.
 *
 * `revokeJti`: Called by auth.controller when a session is revoked. Adds the
 * JTI to the in-memory set and persists is_revoked=true to the DB.
 *
 * `loadRevokedSessions`: Called once after connectDatabase() in server.ts to
 * pre-populate the revocation set with still-valid revoked sessions from the DB.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/config';
import { AppDataSource } from '../config/database';
import { ActiveSession } from '../entities/ActiveSession.entity';

export interface AuthRequest extends Request {
  user?: { id: string; username: string; role: string; jti?: string };
}

// jti → expiry timestamp (ms). Entries cleaned up hourly.
const revokedTokens = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of revokedTokens) {
    if (exp < now) revokedTokens.delete(jti);
  }
}, 3_600_000);

export const revokeJti = async (jti: string, expiresAt: number): Promise<void> => {
  revokedTokens.set(jti, expiresAt);
  try {
    await AppDataSource.getRepository(ActiveSession).update({ jti }, { is_revoked: true });
  } catch {
    // Non-fatal: in-memory revocation already applied
  }
};

export const loadRevokedSessions = async (): Promise<void> => {
  try {
    const repo = AppDataSource.getRepository(ActiveSession);
    const revoked = await repo
      .createQueryBuilder('s')
      .where('s.is_revoked = :v', { v: true })
      .andWhere('s.expires_at > :now', { now: new Date() })
      .select(['s.jti', 's.expires_at'])
      .getMany();
    for (const s of revoked) {
      revokedTokens.set(s.jti, new Date(s.expires_at).getTime());
    }
    if (revoked.length > 0) {
      console.log(`  Loaded ${revoked.length} revoked session(s) into memory`);
    }
  } catch (err) {
    console.warn('[auth] Could not load revoked sessions:', err);
  }
};

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret) as {
      id: string;
      username: string;
      role: string;
      jti?: string;
    };

    if (payload.jti && revokedTokens.has(payload.jti)) {
      res.status(401).json({ success: false, error: 'Session has been revoked' });
      return;
    }

    req.user = { id: payload.id, username: payload.username, role: payload.role, jti: payload.jti };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }
  next();
};

export const requireOperator = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'operator') {
    res.status(403).json({ success: false, error: 'Operator or admin access required' });
    return;
  }
  next();
};

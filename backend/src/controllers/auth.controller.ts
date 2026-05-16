/**
 * auth.controller.ts — Authentication and session management.
 *
 * Handles all auth-related operations:
 *  - `login`: Local username/password authentication with lockout protection.
 *    Tracks failed attempts; locks account after MAX_FAILED_ATTEMPTS. Issues a
 *    JWT token signed with JWT_SECRET, valid for 8 hours.
 *  - `loginLdap`: Authenticates against Active Directory. Auto-provisions users
 *    on first LDAP login.
 *  - `logout`: Records a logout audit entry (token invalidation is client-side
 *    since JWTs are stateless; the client discards the token from localStorage).
 *  - `getMe`: Returns the current user's profile.
 *  - `changePassword`: Validates against the password policy before saving.
 *  - `refreshToken`: Issues a new token for the authenticated user.
 *  - `updateProfile`: Allows updating the user's email.
 *  - `getCapabilities`: Returns which auth providers are available (used by the
 *    login page to show/hide the "Sign in with AD" button).
 *
 * All successful and failed auth events are written to the audit log.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User.entity';
import { AuditLog } from '../entities/AuditLog.entity';
import { ActiveSession } from '../entities/ActiveSession.entity';
import config from '../config/config';
import { AuthRequest, revokeJti } from '../middleware/auth.middleware';
import { validatePassword, MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES, PASSWORD_EXPIRY_DAYS } from '../utils/passwordPolicy';
import { authenticateLdap } from '../services/auth/LdapAuthService';

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const signToken = (id: string, username: string, role: string, jti: string): string =>
  jwt.sign({ id, username, role, jti }, config.jwt.secret, { expiresIn: '8h' });

const recordSession = async (jti: string, userId: string, ip: string, ua: string): Promise<void> => {
  try {
    const repo = AppDataSource.getRepository(ActiveSession);
    const session = repo.create({
      jti,
      user_id: userId,
      expires_at: new Date(Date.now() + TOKEN_TTL_MS),
      ip_address: ip.slice(0, 45) || null,
      user_agent: ua.slice(0, 512) || null,
      is_revoked: false,
    });
    await repo.save(session);
  } catch (err) {
    console.warn('[session] Could not record session:', err);
  }
};

const getClientIp = (req: Request): string =>
  (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';

const writeAudit = (userId: string, username: string, action: string, ip: string, ua: string, diff?: unknown) => {
  const repo = AppDataSource.getRepository(AuditLog);
  const entry = repo.create({ user_id: userId, username, action, entity_type: 'auth', document_id: userId, ip_address: ip, user_agent: ua, diff: diff ?? null });
  repo.save(entry).catch((err: unknown) => console.error('[AuditLog]', err));
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    const ip = getClientIp(req); const ua = req.headers['user-agent'] ?? 'unknown';

    if (!username || !password) { res.status(400).json({ success: false, error: 'Username and password are required' }); return; }

    const user = await AppDataSource.getRepository(User).createQueryBuilder('u')
      .addSelect('u.password').addSelect('u.failed_login_attempts').addSelect('u.locked_until')
      .where('LOWER(u.username) = LOWER(:username)', { username })
      .getOne();

    if (!user) { res.status(401).json({ success: false, error: 'Invalid credentials' }); return; }
    if (!user.active) { writeAudit(user.id, user.username, 'login_failed', ip, ua, { reason: 'account_inactive' }); res.status(403).json({ success: false, error: 'Account is deactivated' }); return; }

    if (user.locked_until && user.locked_until > new Date()) {
      const remaining = Math.ceil((user.locked_until.getTime() - Date.now()) / 60000);
      writeAudit(user.id, user.username, 'login_failed', ip, ua, { reason: 'account_locked' });
      res.status(423).json({ success: false, error: `Account locked. Try again in ${remaining} minute${remaining !== 1 ? 's' : ''}.` }); return;
    }

    const passwordOk = await user.comparePassword(password);

    if (!passwordOk) {
      const attempts = (user.failed_login_attempts | 0) + 1;
      const isNowLocked = attempts >= MAX_FAILED_ATTEMPTS;
      await AppDataSource.getRepository(User).update(user.id, {
        failed_login_attempts: attempts,
        ...(isNowLocked ? { locked_until: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) } : {}),
      });
      writeAudit(user.id, user.username, isNowLocked ? 'account_locked' : 'login_failed', ip, ua, { attempts, reason: 'bad_password' });
      if (isNowLocked) {
        res.status(423).json({ success: false, error: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.` });
      } else {
        res.status(401).json({ success: false, error: `Invalid credentials. ${MAX_FAILED_ATTEMPTS - attempts} attempt${MAX_FAILED_ATTEMPTS - attempts !== 1 ? 's' : ''} remaining.` });
      }
      return;
    }

    await AppDataSource.getRepository(User).update(user.id, { failed_login_attempts: 0, locked_until: null, last_login: new Date() });
    const jti = randomUUID();
    const token = signToken(user.id, user.username, user.role, jti);
    await recordSession(jti, user.id, ip, ua);
    const passwordExpired = !user.password_changed_at || (Date.now() - user.password_changed_at.getTime()) / 86400000 > PASSWORD_EXPIRY_DAYS;
    writeAudit(user.id, user.username, 'login', ip, ua);
    res.json({ success: true, data: { token, user: { id: user.id, username: user.username, role: user.role }, password_changed_at: user.password_changed_at ?? null, password_expired: passwordExpired } });
  } catch (error) { next(error); }
};

export const logout = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ip = getClientIp(req); const ua = req.headers['user-agent'] ?? 'unknown';
    if (req.user) {
      writeAudit(req.user.id, req.user.username, 'logout', ip, ua);
      if (req.user.jti) {
        await revokeJti(req.user.jti, Date.now() + TOKEN_TTL_MS);
      }
    }
    res.json({ success: true });
  } catch (error) { next(error); }
};

export const getMe = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.user?.id } });
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }
    res.json({ success: true, data: { id: user.id, username: user.username, email: user.email, role: user.role, last_login: user.last_login, password_changed_at: user.password_changed_at } });
  } catch (error) { next(error); }
};

export const changePassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    const ip = getClientIp(req); const ua = req.headers['user-agent'] ?? 'unknown';
    if (!currentPassword || !newPassword) { res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' }); return; }
    const policy = validatePassword(newPassword);
    if (!policy.valid) { res.status(422).json({ success: false, error: 'Password does not meet requirements', details: policy.errors }); return; }

    const user = await AppDataSource.getRepository(User).createQueryBuilder('u').addSelect('u.password').where('u.id = :id', { id: req.user?.id }).getOne();
    if (!user || !(await user.comparePassword(currentPassword))) { res.status(401).json({ success: false, error: 'Current password is incorrect' }); return; }

    user.password = newPassword;
    await AppDataSource.getRepository(User).save(user);
    writeAudit(user.id, user.username, 'password_changed', ip, ua);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) { next(error); }
};

export const updateProfile = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body as { email?: string };
    await AppDataSource.getRepository(User).update(req.user!.id, { email: email?.trim().toLowerCase() ?? null });
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.user?.id } });
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }
    res.json({ success: true, data: { id: user.id, username: user.username, email: user.email, role: user.role } });
  } catch (error) { next(error); }
};

export const getCapabilities = (_req: Request, res: Response): void => {
  res.json({ success: true, data: { local: true, ldap: config.ldap.enabled, azure: config.azure.enabled } });
};

export const loginLdap = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    const ip = getClientIp(req); const ua = req.headers['user-agent'] ?? 'unknown';
    if (!username || !password) { res.status(400).json({ success: false, error: 'Username and password are required' }); return; }
    if (!config.ldap.enabled) { res.status(400).json({ success: false, error: 'LDAP authentication is not enabled' }); return; }

    let user;
    try {
      user = await authenticateLdap(username.trim(), password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'LDAP authentication failed';
      writeAudit('unknown', username, 'login_failed', ip, ua, { reason: 'ldap_error', detail: msg });
      res.status(401).json({ success: false, error: msg }); return;
    }

    if (!user.active) { writeAudit(user.id, user.username, 'login_failed', ip, ua, { reason: 'account_inactive' }); res.status(403).json({ success: false, error: 'Account is deactivated' }); return; }
    await AppDataSource.getRepository(User).update(user.id, { last_login: new Date() });
    const jti = randomUUID();
    const token = signToken(user.id, user.username, user.role, jti);
    await recordSession(jti, user.id, ip, ua);
    writeAudit(user.id, user.username, 'login_ldap', ip, ua);
    res.json({ success: true, data: { token, user: { id: user.id, username: user.username, role: user.role, auth_provider: 'ldap' }, password_expired: false } });
  } catch (error) { next(error); }
};

export const refreshToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, error: 'Authentication required' }); return; }
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.user.id } });
    if (!user || !user.active) { res.status(401).json({ success: false, error: 'User not found or inactive' }); return; }
    const jti = randomUUID();
    const token = signToken(user.id, user.username, user.role, jti);
    await recordSession(jti, user.id, '', req.headers['user-agent'] ?? 'unknown');
    const passwordExpired = !user.password_changed_at || (Date.now() - user.password_changed_at.getTime()) / 86400000 > PASSWORD_EXPIRY_DAYS;
    res.json({ success: true, data: { token, password_expired: passwordExpired } });
  } catch (error) { next(error); }
};

// ── Session management ────────────────────────────────────────────────────────

export const getSessions = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessions = await AppDataSource.getRepository(ActiveSession)
      .createQueryBuilder('s')
      .where('s.user_id = :uid', { uid: req.user!.id })
      .andWhere('s.is_revoked = :r', { r: false })
      .andWhere('s.expires_at > :now', { now: new Date() })
      .orderBy('s.issued_at', 'DESC')
      .getMany();

    const currentJti = req.user?.jti;
    res.json({
      success: true,
      data: sessions.map(s => ({
        jti: s.jti,
        issued_at: s.issued_at,
        expires_at: s.expires_at,
        ip_address: s.ip_address,
        user_agent: s.user_agent,
        is_current: s.jti === currentJti,
      })),
    });
  } catch (error) { next(error); }
};

export const revokeSession = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { jti } = req.params;
    const session = await AppDataSource.getRepository(ActiveSession)
      .findOne({ where: { jti, user_id: req.user!.id } });

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    await revokeJti(jti, new Date(session.expires_at).getTime());
    res.json({ success: true, message: 'Session revoked' });
  } catch (error) { next(error); }
};

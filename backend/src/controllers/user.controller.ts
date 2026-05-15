/**
 * user.controller.ts — User account management (admin-only).
 *
 * All endpoints require the `requireAdmin` middleware (enforced in user.routes.ts).
 *
 * `createUser`: Creates a local-auth user. Validates the password policy before
 * saving. Returns 409 if the username already exists.
 *
 * `updateUserRole`: Prevents an admin from demoting their own account to avoid
 * locking themselves out.
 *
 * `deactivateUser` / `activateUser`: Deactivation prevents login without deleting
 * the user's data. Activation also resets the lockout counter.
 *
 * All operations are audit-logged with the acting admin's identity.
 */
import { Response } from 'express';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User.entity';
import { AuditLog } from '../entities/AuditLog.entity';
import { AuthRequest } from '../middleware/auth.middleware';
import { validatePassword } from '../utils/passwordPolicy';

const userRepo = () => AppDataSource.getRepository(User);
const auditRepo = () => AppDataSource.getRepository(AuditLog);

const writeAudit = (actorId: string, actorUsername: string, action: string, targetId: string, diff: unknown) => {
  const entry = auditRepo().create({ user_id: actorId, username: actorUsername, action, entity_type: 'user', document_id: targetId, diff });
  auditRepo().save(entry).catch(() => { /* ignore */ });
};

export const listUsers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await userRepo().find({ order: { created_at: 'DESC' } });
    res.json({ success: true, data: users.map((u) => u.toApiResponse()) });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to retrieve users' });
  }
};

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { username, password, role, email } = req.body as { username: string; password: string; role: 'admin' | 'operator' | 'viewer'; email?: string };
    if (!username || !password || !role) { res.status(400).json({ success: false, error: 'username, password and role are required' }); return; }
    const policy = validatePassword(password);
    if (!policy.valid) { res.status(422).json({ success: false, error: 'Password does not meet requirements', details: policy.errors }); return; }

    const user = userRepo().create({ username: username.toLowerCase(), password, role, email: email ?? null });
    await userRepo().save(user);

    writeAudit(req.user?.id ?? 'system', req.user?.username ?? 'system', 'create', user.id, { username, role });
    res.status(201).json({ success: true, data: user.toApiResponse() });
  } catch (err: unknown) {
    const e = err as { message?: string };
    if (e.message?.includes('Violation of UNIQUE') || e.message?.includes('duplicate key')) {
      res.status(409).json({ success: false, error: 'Username already exists' }); return;
    }
    res.status(500).json({ success: false, error: 'Failed to create user' });
  }
};

export const updateUserRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { role } = req.body as { role?: 'admin' | 'operator' | 'viewer' };
    if (!role || !['admin', 'operator', 'viewer'].includes(role)) { res.status(400).json({ success: false, error: 'Valid role (admin | operator | viewer) is required' }); return; }
    if (req.user?.id === id && role !== 'admin') { res.status(400).json({ success: false, error: 'Admins cannot demote their own account' }); return; }

    await userRepo().update(id, { role });
    const user = await userRepo().findOne({ where: { id } });
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }

    writeAudit(req.user?.id ?? 'system', req.user?.username ?? 'system', 'update', id, { role });
    res.json({ success: true, data: user.toApiResponse() });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to update user role' });
  }
};

export const adminResetPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body as { newPassword: string };
    if (!newPassword) { res.status(400).json({ success: false, error: 'newPassword is required' }); return; }
    const policy = validatePassword(newPassword);
    if (!policy.valid) { res.status(422).json({ success: false, error: 'Password does not meet requirements', details: policy.errors }); return; }

    const user = await userRepo().createQueryBuilder('u').addSelect('u.password').where('u.id = :id', { id }).getOne();
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }

    user.password = newPassword;
    await userRepo().save(user);
    writeAudit(req.user?.id ?? 'system', req.user?.username ?? 'system', 'password_changed', id, { reset_by: req.user?.username });
    res.json({ success: true, message: 'Password reset successfully' });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
};

export const deactivateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (req.user?.id === id) { res.status(400).json({ success: false, error: 'You cannot deactivate your own account' }); return; }
    await userRepo().update(id, { active: false });
    const user = await userRepo().findOne({ where: { id } });
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }
    writeAudit(req.user?.id ?? 'system', req.user?.username ?? 'system', 'update', id, { active: false });
    res.json({ success: true, data: user.toApiResponse() });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to deactivate user' });
  }
};

export const activateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await userRepo().update(id, { active: true, failed_login_attempts: 0, locked_until: null });
    const user = await userRepo().findOne({ where: { id } });
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }
    writeAudit(req.user?.id ?? 'system', req.user?.username ?? 'system', 'update', id, { active: true });
    res.json({ success: true, data: user.toApiResponse() });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to activate user' });
  }
};

export const updateUserEmail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { email } = req.body as { email?: string };
    await userRepo().update(id, { email: email?.trim().toLowerCase() ?? null });
    const user = await userRepo().findOne({ where: { id } });
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }
    writeAudit(req.user?.id ?? 'system', req.user?.username ?? 'system', 'update', id, { email: email ?? null });
    res.json({ success: true, data: user.toApiResponse() });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to update email' });
  }
};

/**
 * user.routes.ts — User management routes (admin only).
 * Mounted at /api/users. All routes additionally require `requireAdmin` middleware
 * (applied via `router.use(requireAdmin)` so no individual route can be missed).
 *
 * Routes:
 *   GET    /                    — list all users
 *   POST   /                    — create a local user
 *   PATCH  /:id/role            — change a user's role
 *   PATCH  /:id/email           — update a user's email
 *   POST   /:id/reset-password  — admin-force password reset
 *   POST   /:id/deactivate      — disable account
 *   POST   /:id/activate        — re-enable account (also clears lockout)
 *   DELETE /:id                 — legacy alias for deactivate (backwards compat)
 *
 * @openapi
 * tags:
 *   - name: Users
 *     description: User management (admin only)
 *
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List all users
 *     responses:
 *       200:
 *         description: Array of users
 *       403:
 *         description: Admin required
 *   post:
 *     tags: [Users]
 *     summary: Create a local user account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password, role]
 *             properties:
 *               username: { type: string, example: jsmith }
 *               password: { type: string, example: Str0ng@Pass }
 *               display_name: { type: string }
 *               email: { type: string, format: email }
 *               role: { type: string, enum: [admin, operator, viewer] }
 *     responses:
 *       201:
 *         description: Created user
 *
 * /users/{id}/role:
 *   patch:
 *     tags: [Users]
 *     summary: Change a user's role
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [admin, operator, viewer] }
 *     responses:
 *       200:
 *         description: Updated
 *
 * /users/{id}/reset-password:
 *   post:
 *     tags: [Users]
 *     summary: Admin-force reset a user's password
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPassword]
 *             properties:
 *               newPassword: { type: string }
 *     responses:
 *       200:
 *         description: Password reset
 *
 * /users/{id}/deactivate:
 *   post:
 *     tags: [Users]
 *     summary: Deactivate a user account
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deactivated
 *
 * /users/{id}/activate:
 *   post:
 *     tags: [Users]
 *     summary: Activate a user account (also clears lockout)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Activated
 */
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.middleware';
import {
  listUsers,
  createUser,
  updateUserRole,
  updateUserEmail,
  adminResetPassword,
  deactivateUser,
  activateUser,
} from '../controllers/user.controller';

const router = Router();

// All user routes require admin (authenticate is applied in index.ts already)
router.use(requireAdmin);

router.get('/', listUsers);
router.post('/', createUser);
router.patch('/:id/role', updateUserRole);
router.patch('/:id/email', updateUserEmail);
router.post('/:id/reset-password', adminResetPassword);
router.post('/:id/deactivate', deactivateUser);
router.post('/:id/activate', activateUser);
// Legacy DELETE kept for backwards compat with older frontend code
router.delete('/:id', deactivateUser);

export default router;

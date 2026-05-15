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

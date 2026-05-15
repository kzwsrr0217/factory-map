/**
 * auth.routes.ts — Authentication and session management routes.
 * Mounted at /api/auth (public unless noted).
 *
 * Routes:
 *   GET  /capabilities        — returns { local, ldap, azure } flags (public,
 *                               used by Login page to hide unused auth tabs).
 *   POST /login               — local username/password login.
 *   POST /login/ldap          — LDAP login (proxied to LdapAuthService).
 *   POST /logout              — invalidates the token (requires authenticate).
 *   GET  /me                  — returns current user profile (requires authenticate).
 *   PATCH /password           — change password (requires authenticate).
 *   POST /refresh             — issue a new JWT from a still-valid token.
 *   PATCH /profile            — update display name / email (requires authenticate).
 *
 * @openapi
 * tags:
 *   - name: Auth
 *     description: Authentication and session management
 *
 * /auth/capabilities:
 *   get:
 *     tags: [Auth]
 *     summary: Get enabled auth providers
 *     security: []
 *     responses:
 *       200:
 *         description: Auth capabilities
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 local: { type: boolean }
 *                 ldap:  { type: boolean }
 *
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login with username and password
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string, example: admin }
 *               password: { type: string, example: Admin@1234 }
 *     responses:
 *       200:
 *         description: JWT token and user profile
 *       401:
 *         description: Invalid credentials
 *
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Invalidate current session token
 *     responses:
 *       200:
 *         description: Logged out
 *
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current user profile
 *     responses:
 *       200:
 *         description: User profile
 *
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Issue a new JWT from a still-valid token
 *     responses:
 *       200:
 *         description: New token
 *
 * /auth/password:
 *   patch:
 *     tags: [Auth]
 *     summary: Change own password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string }
 *     responses:
 *       200:
 *         description: Password changed
 *       400:
 *         description: Validation error
 */
import { Router } from 'express';
import {
  login,
  loginLdap,
  logout,
  getMe,
  getCapabilities,
  changePassword,
  refreshToken,
  updateProfile,
  getSessions,
  revokeSession,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/capabilities', getCapabilities);
router.post('/login', login);
router.post('/login/ldap', loginLdap);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getMe);
router.patch('/password', authenticate, changePassword);
router.post('/refresh', authenticate, refreshToken);
router.patch('/profile', authenticate, updateProfile);
router.get('/sessions', authenticate, getSessions);
router.delete('/sessions/:jti', authenticate, revokeSession);

export default router;

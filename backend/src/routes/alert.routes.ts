/**
 * alert.routes.ts — Alert configuration and notification history routes.
 * Mounted at /api/alerts. All routes require JWT (enforced in routes/index.ts).
 * PUT /config and POST /test are admin-only (enforced in controller).
 *
 * @openapi
 * tags:
 *   - name: Alerts
 *     description: Maintenance alert configuration and history
 *
 * /alerts/config:
 *   get:
 *     tags: [Alerts]
 *     summary: Get the global alert configuration
 *     responses:
 *       200:
 *         description: Current alert config (email/Teams toggles, recipients, thresholds)
 *   put:
 *     tags: [Alerts]
 *     summary: Update the global alert configuration (admin)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email_enabled: { type: boolean }
 *               email_recipients: { type: array, items: { type: string } }
 *               teams_enabled: { type: boolean }
 *               teams_webhook_url: { type: string }
 *               days_before_alert: { type: integer, example: 7 }
 *               alert_on_maintenance: { type: boolean }
 *               alert_on_overdue: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated config
 *
 * /alerts/logs:
 *   get:
 *     tags: [Alerts]
 *     summary: Get alert notification history (paginated)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Paginated alert log
 *
 * /alerts/test:
 *   post:
 *     tags: [Alerts]
 *     summary: Run maintenance check and send alerts immediately (admin)
 *     responses:
 *       200:
 *         description: Alert run result (checked, upcoming, overdue, tasksDue, emailSent, teamsSent)
 *
 * /alerts/scheduled:
 *   get:
 *     tags: [Alerts]
 *     summary: List all scheduled one-off alerts (sorted by scheduled_for asc)
 *     responses:
 *       200:
 *         description: Array of ScheduledAlert rows
 *   post:
 *     tags: [Alerts]
 *     summary: Create a scheduled one-off alert (operator+)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, scheduled_for]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               scheduled_for: { type: string, format: date-time }
 *               channels: { type: string, enum: [email, teams, both], default: both }
 *               asset_filter: { type: string, description: "Optional asset_type value; matching active assets are included in the notification body" }
 *     responses:
 *       201:
 *         description: Created ScheduledAlert row
 *
 * /alerts/scheduled/{id}:
 *   delete:
 *     tags: [Alerts]
 *     summary: Delete an unsent scheduled alert (operator+)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: success true
 */
import { Router } from 'express';
import { requireAdmin, requireOperator } from '../middleware/auth.middleware';
import {
  getConfig,
  updateConfig,
  getLogs,
  testAlert,
  getScheduledAlerts,
  addScheduledAlert,
  removeScheduledAlert,
} from '../controllers/alert.controller';

const router = Router();

router.get('/config', getConfig);
router.put('/config', requireAdmin, updateConfig);
router.get('/logs', getLogs);
router.post('/test', requireAdmin, testAlert);

// Scheduled one-off alerts — operators and admins can manage
router.get('/scheduled', getScheduledAlerts);
router.post('/scheduled', requireOperator, addScheduledAlert);
router.delete('/scheduled/:id', requireOperator, removeScheduledAlert);

export default router;

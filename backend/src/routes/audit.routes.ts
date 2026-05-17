/**
 * audit.routes.ts — Read-only audit log query endpoint.
 *
 * `GET /api/audit` supports filtering by username (partial), action (exact),
 * entity_type (exact), document_id (exact), and date range. Results are ordered
 * newest-first and support offset-based pagination (limit max: 1000).
 *
 * This route is defined inline here rather than in a separate controller file
 * because it is the only audit route and the query logic is straightforward.
 *
 * @openapi
 * tags:
 *   - name: Audit
 *     description: Read-only audit log
 *
 * /audit:
 *   get:
 *     tags: [Audit]
 *     summary: Query audit log entries
 *     parameters:
 *       - in: query
 *         name: username
 *         schema: { type: string }
 *         description: Partial match on username
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *         description: Exact action name (e.g. create, update, delete, login)
 *       - in: query
 *         name: entity_type
 *         schema: { type: string }
 *         description: Entity type (e.g. Asset, Building, User)
 *       - in: query
 *         name: document_id
 *         schema: { type: string }
 *         description: Exact document/entity ID
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Start of date range (ISO 8601)
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: End of date range (ISO 8601)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 200, maximum: 1000 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Audit log entries with total count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 *                 total: { type: integer }
 *                 limit: { type: integer }
 *                 offset: { type: integer }
 */
import { Router, Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { AuditLog } from '../entities/AuditLog.entity';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      username, action, entity_type, document_id, from, to,
      limit = '200', offset = '0',
    } = req.query as Record<string, string | undefined>;

    const parsedLimit = Math.min(1000, Math.max(1, parseInt(limit ?? '200', 10)));
    const parsedOffset = Math.max(0, parseInt(offset ?? '0', 10));

    const qb = AppDataSource.getRepository(AuditLog).createQueryBuilder('al');

    if (username) qb.andWhere('al.username LIKE :username', { username: `%${username}%` });
    if (action) qb.andWhere('al.action = :action', { action });
    if (entity_type) qb.andWhere('al.entity_type = :entity_type', { entity_type });
    if (document_id) qb.andWhere('al.document_id = :document_id', { document_id });
    if (from) qb.andWhere('al.timestamp >= :from', { from: new Date(from) });
    if (to) qb.andWhere('al.timestamp <= :to', { to: new Date(to) });

    qb.orderBy('al.timestamp', 'DESC').skip(parsedOffset).take(parsedLimit);

    const [entries, total] = await qb.getManyAndCount();

    res.json({ success: true, data: entries.map((e) => e.toApiResponse()), total, limit: parsedLimit, offset: parsedOffset });
  } catch (error) { next(error); }
});

export default router;

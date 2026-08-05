/**
 * normalisationTask.controller.ts — The derived task list, over HTTP.
 *
 * The rows are recomputed from the data (see services/itsm/taskGenerator.ts); this
 * endpoint set exposes them and the four things a person may do to one: take it, note
 * something, say it is done, or dismiss it with a reason.
 *
 * Two rules are enforced here rather than left to the UI, because they are what keeps
 * the list honest:
 *
 *  - **A dismissal needs a reason.** A decision nobody can review is indistinguishable
 *    from forgetting, and this list exists to be able to say "nothing is left".
 *  - **Marking a machine-verifiable task done does not make it done.** The generator
 *    reopens anything it can still derive, so the response says so plainly instead of
 *    letting someone believe a tick settled it. `label-device` is the exception: nothing
 *    in any data source records that a sticker was applied, so a person's word is the
 *    only evidence there will ever be.
 *
 * The generator itself is exposed too (`POST /tasks/generate`), because after every new
 * ITSM export someone has to re-derive — and asking them to open a terminal on the VM
 * for that would mean it happens rarely and late.
 */
import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import {
  NormalisationTask,
  NormalisationTaskKind,
  NormalisationTaskState,
} from '../entities/NormalisationTask.entity';
import { generateTasks, MACHINE_VERIFIABLE } from '../services/itsm/taskGenerator';

interface AuthRequest extends Request {
  user?: { username?: string };
}

const repo = () => AppDataSource.getRepository(NormalisationTask);

const STATES: NormalisationTaskState[] = ['open', 'done', 'dismissed'];

/** Page size cap, matching the asset list's reasoning: more than this is unreadable. */
const MAX_LIMIT = 200;

// ── GET /tasks ────────────────────────────────────────────────────────────────

export const listTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { state, kind, assigned_to, q, page, limit } = req.query as Record<string, string | undefined>;

    const qb = repo().createQueryBuilder('t');
    // Open by default: the list is a worklist, and the finished items are only
    // interesting when someone goes looking for them.
    qb.andWhere('t.state = :state', { state: STATES.includes(state as NormalisationTaskState) ? state : 'open' });
    if (kind) qb.andWhere('t.kind = :kind', { kind });
    if (assigned_to === '__unassigned__') qb.andWhere('t.assigned_to IS NULL');
    else if (assigned_to) qb.andWhere('t.assigned_to = :assigned_to', { assigned_to });
    if (q) qb.andWhere('(t.summary LIKE :q OR t.itsm_id LIKE :q)', { q: `%${q}%` });

    // Oldest first: a task that has been outstanding for three weeks is the one worth
    // looking at, not the one raised this morning.
    qb.orderBy('t.first_seen_at', 'ASC');

    const p = Math.max(1, parseInt(page ?? '1', 10));
    const l = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit ?? '50', 10)));
    qb.skip((p - 1) * l).take(l);

    const [rows, total] = await qb.getManyAndCount();
    res.json({
      success: true,
      data: rows.map((t) => ({
        ...t.toApiResponse(),
        // So the UI can say who is allowed to close it without duplicating the rule.
        machine_verifiable: MACHINE_VERIFIABLE.has(t.kind),
      })),
      meta: { total, page: p, limit: l, totalPages: Math.ceil(total / l) },
    });
  } catch (error) { next(error); }
};

// ── GET /tasks/summary ────────────────────────────────────────────────────────

/**
 * Counts by kind and state, plus the single number the whole exercise is about: how many
 * open tasks stand between here and "the inventory, the app and ITSM agree".
 */
export const taskSummary = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rows = await repo()
      .createQueryBuilder('t')
      .select('t.kind', 'kind')
      .addSelect('t.state', 'state')
      .addSelect('COUNT(*)', 'count')
      .groupBy('t.kind')
      .addGroupBy('t.state')
      .getRawMany<{ kind: NormalisationTaskKind; state: NormalisationTaskState; count: number }>();

    const byKind: Record<string, Record<string, number>> = {};
    const byState: Record<string, number> = { open: 0, done: 0, dismissed: 0 };
    for (const row of rows) {
      const n = Number(row.count);
      byKind[row.kind] = { ...(byKind[row.kind] ?? {}), [row.state]: n };
      byState[row.state] = (byState[row.state] ?? 0) + n;
    }

    const unassigned = await repo()
      .createQueryBuilder('t')
      .where("t.state = 'open'")
      .andWhere('t.assigned_to IS NULL')
      .getCount();

    res.json({
      success: true,
      data: {
        by_kind: byKind,
        by_state: byState,
        open_unassigned: unassigned,
        /** True when nothing is outstanding — the definition of done for the inventory. */
        consistent: (byState.open ?? 0) === 0,
      },
    });
  } catch (error) { next(error); }
};

// ── PATCH /tasks/:id ──────────────────────────────────────────────────────────

export const updateTask = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const task = await repo().findOne({ where: { id: req.params.id } });
    if (!task) { res.status(404).json({ success: false, error: 'Task not found' }); return; }

    const body = req.body as {
      state?: NormalisationTaskState;
      assigned_to?: string | null;
      note?: string | null;
    };
    const username = req.user?.username ?? 'unknown';

    if (body.assigned_to !== undefined) task.assigned_to = body.assigned_to?.trim() || null;
    if (body.note !== undefined) task.note = body.note?.trim() || null;

    if (body.state !== undefined) {
      if (!STATES.includes(body.state)) {
        res.status(400).json({ success: false, error: `Unknown state "${body.state}"` });
        return;
      }
      // A dismissal is a decision to leave something undone. Without a reason it cannot
      // be reviewed later, and is indistinguishable from having forgotten.
      if (body.state === 'dismissed' && !task.note) {
        res.status(400).json({
          success: false,
          error: 'Dismissing a task requires a note saying why.',
        });
        return;
      }
      task.state = body.state;
      if (body.state === 'open') {
        task.closed_by = null;
        task.closed_at = null;
      } else {
        task.closed_by = username;
        task.closed_at = new Date();
      }
    }

    await repo().save(task);

    // Said out loud rather than hidden: a tick on a task the data still derives will be
    // undone by the next generator run, and someone believing otherwise would stop
    // chasing the actual cause.
    const willReopen = task.state === 'done' && MACHINE_VERIFIABLE.has(task.kind);
    res.json({
      success: true,
      data: { ...task.toApiResponse(), machine_verifiable: MACHINE_VERIFIABLE.has(task.kind) },
      meta: willReopen
        ? { note: 'This kind is checked against the data. If the cause is still there, the next generation will reopen it.' }
        : undefined,
    });
  } catch (error) { next(error); }
};

// ── POST /tasks/generate ──────────────────────────────────────────────────────

export const runTaskGeneration = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await generateTasks({ apply: true });
    res.json({
      success: true,
      data: {
        created: result.created.length,
        reopened: result.reopened.length,
        unchanged: result.unchanged,
        closed: result.closed.length,
        awaiting_human: result.awaitingHuman.length,
      },
    });
  } catch (error) { next(error); }
};

/**
 * AlertService.ts — Maintenance alert delivery service.
 *
 * Exported functions:
 *   getAlertConfig / saveAlertConfig   — read and persist the global AlertConfig row
 *   checkAndSend()                     — daily cron (07:00): scans maint_next_date and
 *                                        work-item due dates; sends email + Teams batches
 *   notifyWorkItem(assetId, taskId)    — immediate targeted alert for one work item;
 *                                        marks work_item.alert_sent = true after sending
 *   checkScheduledAlerts()             — hourly cron: fires unsent ScheduledAlert rows
 *                                        whose scheduled_for <= now; marks them sent
 *   listScheduledAlerts / createScheduledAlert / deleteScheduledAlert — CRUD for ScheduledAlert
 *
 * Delivery channels: email via nodemailer (SMTP env vars), Teams via Incoming Webhook
 * (URL stored in AlertConfig). An AlertLog row is written for every send attempt.
 *
 * SMTP credentials (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM) come from
 * environment variables only — never stored in the database.
 */
import nodemailer from 'nodemailer';
import { LessThanOrEqual } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { AlertConfig } from '../../entities/AlertConfig.entity';
import { AlertLog } from '../../entities/AlertLog.entity';
import { ScheduledAlert } from '../../entities/ScheduledAlert.entity';
import { Asset } from '../../entities/Asset.entity';

const GLOBAL_CONFIG_ID = 'global';

export interface AlertAssetInfo {
  id: string;
  display_name: string;
  maint_next_date: Date | null;
  overdue: boolean;
}

export interface WorkItemAlertInfo {
  asset_id: string;
  asset_name: string;
  task_id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  due_date: Date;
  assigned_to: string | null;
  overdue: boolean;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export async function getAlertConfig(): Promise<AlertConfig> {
  const repo = AppDataSource.getRepository(AlertConfig);
  let cfg = await repo.findOne({ where: { id: GLOBAL_CONFIG_ID } });
  if (!cfg) {
    cfg = repo.create({
      id: GLOBAL_CONFIG_ID,
      email_enabled: false,
      email_recipients: [],
      teams_enabled: false,
      teams_webhook_url: null,
      days_before_alert: 7,
      alert_on_maintenance: true,
      alert_on_overdue: true,
    });
    await repo.save(cfg);
  }
  return cfg;
}

export async function saveAlertConfig(dto: Partial<AlertConfig>): Promise<AlertConfig> {
  const repo = AppDataSource.getRepository(AlertConfig);
  const cfg = await getAlertConfig();
  repo.merge(cfg, dto);
  return repo.save(cfg);
}

// ---------------------------------------------------------------------------
// Alert log helpers
// ---------------------------------------------------------------------------

async function writeLog(
  channel: string,
  assetId: string | null,
  subject: string,
  bodySnippet: string,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  const repo = AppDataSource.getRepository(AlertLog);
  const log = repo.create({
    channel,
    asset_id: assetId,
    subject,
    body_snippet: bodySnippet.substring(0, 1000),
    success,
    error_message: errorMessage ?? null,
  });
  await repo.save(log);
}

// ---------------------------------------------------------------------------
// Email delivery
// ---------------------------------------------------------------------------

async function sendEmail(
  recipients: string[],
  assets: AlertAssetInfo[],
): Promise<void> {
  if (!recipients.length) return;

  const subject = `[Factory Map] Maintenance alert — ${assets.length} asset(s) need attention`;
  const lines = assets.map(a => {
    const dateStr = a.maint_next_date
      ? new Date(a.maint_next_date).toLocaleDateString('en-GB')
      : 'unknown';
    const status = a.overdue ? '⚠️ OVERDUE' : '🔔 Due soon';
    return `  ${status} — ${a.display_name} (next maintenance: ${dateStr})`;
  });
  const body = [
    'Hello,',
    '',
    'The following assets require maintenance attention:',
    '',
    ...lines,
    '',
    'Please log in to Factory Map to review and schedule maintenance.',
    '',
    '— Factory Map automated alert',
  ].join('\n');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'factory-map@company.local',
      to: recipients.join(', '),
      subject,
      text: body,
    });
    for (const a of assets) {
      await writeLog('email', a.id, subject, `Asset: ${a.display_name}`, true);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const a of assets) {
      await writeLog('email', a.id, subject, `Asset: ${a.display_name}`, false, msg);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Teams delivery (Incoming Webhook — Adaptive Card)
// ---------------------------------------------------------------------------

async function sendTeams(
  webhookUrl: string,
  assets: AlertAssetInfo[],
): Promise<void> {
  if (!webhookUrl) return;

  const subject = `Factory Map — ${assets.length} asset(s) need maintenance attention`;

  const facts = assets.map(a => {
    const dateStr = a.maint_next_date
      ? new Date(a.maint_next_date).toLocaleDateString('en-GB')
      : 'unknown';
    return {
      title: a.display_name,
      value: a.overdue ? `⚠️ OVERDUE (was due ${dateStr})` : `🔔 Due ${dateStr}`,
    };
  });

  // Adaptive Card format for Teams Incoming Webhook
  const card = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.3',
          body: [
            {
              type: 'TextBlock',
              text: '🔧 Factory Map — Maintenance Alert',
              weight: 'Bolder',
              size: 'Medium',
            },
            {
              type: 'TextBlock',
              text: `${assets.length} asset(s) require your attention.`,
              wrap: true,
            },
            {
              type: 'FactSet',
              facts,
            },
          ],
        },
      },
    ],
  };

  const body = JSON.stringify(card);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Teams webhook returned ${res.status}`);
    for (const a of assets) {
      await writeLog('teams', a.id, subject, `Asset: ${a.display_name}`, true);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const a of assets) {
      await writeLog('teams', a.id, subject, `Asset: ${a.display_name}`, false, msg);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Work-item targeted notification
// ---------------------------------------------------------------------------

async function sendWorkItemEmail(recipients: string[], task: WorkItemAlertInfo): Promise<void> {
  if (!recipients.length) return;

  const dateStr = task.due_date.toLocaleDateString('en-GB');
  const status  = task.overdue ? '⚠️ OVERDUE' : '🔔 Due soon';
  const subject = `[Factory Map] Task alert — ${task.title} on ${task.asset_name}`;
  const body = [
    'Hello,',
    '',
    `A maintenance task requires attention:`,
    '',
    `  Asset    : ${task.asset_name}`,
    `  Task     : ${task.title}`,
    `  Details  : ${task.description}`,
    `  Priority : ${task.priority.toUpperCase()}`,
    `  Status   : ${status}`,
    `  Due date : ${dateStr}`,
    task.assigned_to ? `  Assigned : ${task.assigned_to}` : '',
    '',
    'Please log in to Factory Map to action this task.',
    '',
    '— Factory Map automated alert',
  ].filter(l => l !== '').join('\n');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'factory-map@company.local',
      to: recipients.join(', '),
      subject,
      text: body,
    });
    await writeLog('email', task.asset_id, subject, `Task: ${task.title} on ${task.asset_name}`, true);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeLog('email', task.asset_id, subject, `Task: ${task.title} on ${task.asset_name}`, false, msg);
    throw err;
  }
}

async function sendWorkItemTeams(webhookUrl: string, task: WorkItemAlertInfo): Promise<void> {
  if (!webhookUrl) return;

  const dateStr = task.due_date.toLocaleDateString('en-GB');
  const subject = `Factory Map — Task alert: ${task.title}`;

  const card = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.3',
        body: [
          { type: 'TextBlock', text: task.overdue ? '⚠️ Factory Map — OVERDUE Task' : '🔔 Factory Map — Task Due Soon', weight: 'Bolder', size: 'Medium' },
          { type: 'FactSet', facts: [
            { title: 'Asset',    value: task.asset_name },
            { title: 'Task',     value: task.title },
            { title: 'Details',  value: task.description },
            { title: 'Priority', value: task.priority.toUpperCase() },
            { title: 'Due',      value: dateStr },
            ...(task.assigned_to ? [{ title: 'Assigned', value: task.assigned_to }] : []),
          ]},
        ],
      },
    }],
  };

  try {
    const res = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card) });
    if (!res.ok) throw new Error(`Teams webhook returned ${res.status}`);
    await writeLog('teams', task.asset_id, subject, `Task: ${task.title} on ${task.asset_name}`, true);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeLog('teams', task.asset_id, subject, `Task: ${task.title} on ${task.asset_name}`, false, msg);
    throw err;
  }
}

/**
 * Send an immediate targeted alert for a single work item and mark it as alert_sent.
 * Called when a user creates a task (via POST .../notify route).
 */
export async function notifyWorkItem(assetId: string, taskId: string): Promise<{ emailSent: boolean; teamsSent: boolean; errors: string[] }> {
  const cfg    = await getAlertConfig();
  const assetRepo = AppDataSource.getRepository(Asset);
  const asset  = await assetRepo.findOne({ where: { id: assetId } });
  if (!asset) throw new Error('Asset not found');

  const task = (asset.work_items ?? []).find(t => t.id === taskId);
  if (!task) throw new Error('Work item not found');
  if (!task.due_date) throw new Error('Work item has no due date');

  const dueDate = new Date(task.due_date);
  const today   = new Date();
  today.setHours(0, 0, 0, 0);

  const info: WorkItemAlertInfo = {
    asset_id:    assetId,
    asset_name:  asset.display_name,
    task_id:     taskId,
    title:       task.title || task.description,
    description: task.description,
    priority:    task.priority,
    due_date:    dueDate,
    assigned_to: task.assigned_to,
    overdue:     dueDate < today,
  };

  const errors: string[] = [];
  let emailSent = false;
  let teamsSent = false;

  if (cfg.email_enabled && cfg.email_recipients?.length) {
    try { await sendWorkItemEmail(cfg.email_recipients, info); emailSent = true; }
    catch (err: unknown) { errors.push(`Email: ${err instanceof Error ? err.message : String(err)}`); }
  }
  if (cfg.teams_enabled && cfg.teams_webhook_url) {
    try { await sendWorkItemTeams(cfg.teams_webhook_url, info); teamsSent = true; }
    catch (err: unknown) { errors.push(`Teams: ${err instanceof Error ? err.message : String(err)}`); }
  }

  // Mark alert_sent = true on the work item
  asset.work_items = (asset.work_items ?? []).map(t =>
    t.id === taskId ? { ...t, alert_sent: true } : t,
  );
  await assetRepo.save(asset);

  return { emailSent, teamsSent, errors };
}

// ---------------------------------------------------------------------------
// Main entry point — called by cron and by POST /api/alerts/test
// ---------------------------------------------------------------------------

export async function checkAndSend(): Promise<{
  checked: number;
  upcoming: number;
  overdue: number;
  tasksDue: number;
  emailSent: boolean;
  teamsSent: boolean;
  errors: string[];
}> {
  const cfg = await getAlertConfig();
  const errors: string[] = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + cfg.days_before_alert);

  const assetRepo = AppDataSource.getRepository(Asset);
  const allAssets = await assetRepo.find({
    select: ['id', 'display_name', 'maint_next_date', 'work_items'],
  });

  const upcoming: AlertAssetInfo[] = [];
  const overdue:  AlertAssetInfo[] = [];

  // --- maint_next_date check (existing behaviour) --------------------------
  for (const a of allAssets) {
    if (!a.maint_next_date) continue;
    const d = new Date(a.maint_next_date);
    d.setHours(0, 0, 0, 0);
    if (cfg.alert_on_overdue && d < today) {
      overdue.push({ id: a.id, display_name: a.display_name, maint_next_date: d, overdue: true });
    } else if (cfg.alert_on_maintenance && d <= threshold) {
      upcoming.push({ id: a.id, display_name: a.display_name, maint_next_date: d, overdue: false });
    }
  }

  // --- work item due-date check --------------------------------------------
  const dueTasks: WorkItemAlertInfo[] = [];
  for (const a of allAssets) {
    for (const task of a.work_items ?? []) {
      if (task.done || !task.due_date) continue;
      const d = new Date(task.due_date);
      d.setHours(0, 0, 0, 0);
      if (d < today || d <= threshold) {
        dueTasks.push({
          asset_id:    a.id,
          asset_name:  a.display_name,
          task_id:     task.id,
          title:       task.title || task.description,
          description: task.description,
          priority:    task.priority,
          due_date:    d,
          assigned_to: task.assigned_to,
          overdue:     d < today,
        });
      }
    }
  }

  const toAlert = [...overdue, ...upcoming];
  let emailSent = false;
  let teamsSent = false;

  // Send maintenance-date alerts
  if (toAlert.length > 0) {
    if (cfg.email_enabled && cfg.email_recipients?.length) {
      try { await sendEmail(cfg.email_recipients, toAlert); emailSent = true; }
      catch (err: unknown) { errors.push(`Email (maint): ${err instanceof Error ? err.message : String(err)}`); }
    }
    if (cfg.teams_enabled && cfg.teams_webhook_url) {
      try { await sendTeams(cfg.teams_webhook_url, toAlert); teamsSent = true; }
      catch (err: unknown) { errors.push(`Teams (maint): ${err instanceof Error ? err.message : String(err)}`); }
    }
  }

  // Send work-item task alerts
  for (const task of dueTasks) {
    if (cfg.email_enabled && cfg.email_recipients?.length) {
      try { await sendWorkItemEmail(cfg.email_recipients, task); emailSent = true; }
      catch (err: unknown) { errors.push(`Email (task ${task.task_id}): ${err instanceof Error ? err.message : String(err)}`); }
    }
    if (cfg.teams_enabled && cfg.teams_webhook_url) {
      try { await sendWorkItemTeams(cfg.teams_webhook_url, task); teamsSent = true; }
      catch (err: unknown) { errors.push(`Teams (task ${task.task_id}): ${err instanceof Error ? err.message : String(err)}`); }
    }
  }

  return {
    checked: allAssets.length,
    upcoming: upcoming.length,
    overdue:  overdue.length,
    tasksDue: dueTasks.length,
    emailSent,
    teamsSent,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Scheduled one-off alerts — CRUD + delivery
// ---------------------------------------------------------------------------

export async function listScheduledAlerts(): Promise<ScheduledAlert[]> {
  return AppDataSource.getRepository(ScheduledAlert).find({
    order: { scheduled_for: 'ASC' },
  });
}

export async function createScheduledAlert(dto: {
  title: string;
  description?: string | null;
  scheduled_for: Date;
  channels: string;
  asset_filter?: string | null;
  created_by?: string | null;
}): Promise<ScheduledAlert> {
  const repo = AppDataSource.getRepository(ScheduledAlert);
  const row = repo.create({
    title:         dto.title,
    description:   dto.description ?? null,
    scheduled_for: dto.scheduled_for,
    channels:      dto.channels ?? 'both',
    asset_filter:  dto.asset_filter ?? null,
    created_by:    dto.created_by ?? null,
    sent:          false,
    sent_at:       null,
  });
  return repo.save(row);
}

export async function deleteScheduledAlert(id: string): Promise<void> {
  await AppDataSource.getRepository(ScheduledAlert).delete(id);
}

/**
 * Called by the hourly cron. Fires all unsent scheduled alerts whose
 * scheduled_for timestamp has passed and marks them sent.
 */
export async function checkScheduledAlerts(): Promise<{ fired: number; errors: string[] }> {
  const cfg  = await getAlertConfig();
  const repo = AppDataSource.getRepository(ScheduledAlert);
  const assetRepo = AppDataSource.getRepository(Asset);

  const due = await repo.find({
    where: { sent: false, scheduled_for: LessThanOrEqual(new Date()) },
  });

  let fired = 0;
  const errors: string[] = [];

  for (const alert of due) {
    // Optionally fetch matching assets for context
    let matchedAssets: Asset[] = [];
    if (alert.asset_filter) {
      matchedAssets = await assetRepo.find({
        where: { asset_type: alert.asset_filter, status: 'active' } as never,
        select: ['id', 'display_name', 'ip_address', 'hostname'],
      });
    }

    const useEmail = (alert.channels === 'email' || alert.channels === 'both') && cfg.email_enabled && cfg.email_recipients?.length;
    const useTeams = (alert.channels === 'teams' || alert.channels === 'both') && cfg.teams_enabled && cfg.teams_webhook_url;

    if (useEmail) {
      try {
        await sendScheduledEmail(cfg.email_recipients!, alert, matchedAssets);
      } catch (err: unknown) {
        errors.push(`Email (${alert.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (useTeams) {
      try {
        await sendScheduledTeams(cfg.teams_webhook_url!, alert, matchedAssets);
      } catch (err: unknown) {
        errors.push(`Teams (${alert.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    alert.sent    = true;
    alert.sent_at = new Date();
    await repo.save(alert);
    fired++;
  }

  return { fired, errors };
}

async function sendScheduledEmail(
  recipients: string[],
  alert: ScheduledAlert,
  assets: Asset[],
): Promise<void> {
  const subject = `[Factory Map] Scheduled alert — ${alert.title}`;
  const assetLines = assets.length
    ? ['', 'Matching assets:', ...assets.map(a => `  • ${a.display_name}${a.hostname ? ` (${a.hostname})` : ''}${(a as unknown as { ip_address?: string }).ip_address ? ` — ${(a as unknown as { ip_address?: string }).ip_address}` : ''}`)]
    : [];
  const body = [
    'Hello,',
    '',
    `Scheduled alert: ${alert.title}`,
    ...(alert.description ? ['', alert.description] : []),
    ...assetLines,
    '',
    '— Factory Map scheduled alert',
  ].join('\n');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'factory-map@company.local',
    to: recipients.join(', '),
    subject,
    text: body,
  });
  await writeLog('email', null, subject, alert.title, true);
}

async function sendScheduledTeams(
  webhookUrl: string,
  alert: ScheduledAlert,
  assets: Asset[],
): Promise<void> {
  const subject = `Factory Map — ${alert.title}`;
  const bodyItems: object[] = [
    { type: 'TextBlock', text: `📅 Factory Map — Scheduled Alert`, weight: 'Bolder', size: 'Medium' },
    { type: 'TextBlock', text: alert.title, wrap: true, weight: 'Bolder' },
    ...(alert.description ? [{ type: 'TextBlock', text: alert.description, wrap: true }] : []),
  ];
  if (assets.length) {
    bodyItems.push({
      type: 'FactSet',
      facts: assets.map(a => ({
        title: a.display_name,
        value: [a.hostname, (a as unknown as { ip_address?: string }).ip_address].filter(Boolean).join(' — ') || '—',
      })),
    });
  }

  const card = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.3',
        body: bodyItems,
      },
    }],
  };

  const res = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card) });
  if (!res.ok) throw new Error(`Teams webhook returned ${res.status}`);
  await writeLog('teams', null, subject, alert.title, true);
}

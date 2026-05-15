/**
 * AlertService.ts — Maintenance alert delivery service.
 *
 * Checks assets whose maint_next_date is within the configured threshold and
 * sends notifications via email (nodemailer) and/or Microsoft Teams (Incoming
 * Webhook). Writes an AlertLog row for every attempt — successful or failed.
 *
 * The cron scheduler in server.ts calls checkAndSend() once a day at 07:00.
 * Admins can also trigger it manually via POST /api/alerts/test.
 *
 * SMTP credentials and Teams webhook URL are NOT stored in the database — they
 * come from environment variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
 * SMTP_FROM). This keeps secrets out of the DB. The Teams webhook URL IS stored
 * in AlertConfig so it can be changed by admins without touching env vars.
 */
import nodemailer from 'nodemailer';
import { AppDataSource } from '../../config/database';
import { AlertConfig } from '../../entities/AlertConfig.entity';
import { AlertLog } from '../../entities/AlertLog.entity';
import { Asset } from '../../entities/Asset.entity';

const GLOBAL_CONFIG_ID = 'global';

export interface AlertAssetInfo {
  id: string;
  display_name: string;
  maint_next_date: Date | null;
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
// Main entry point — called by cron and by POST /api/alerts/test
// ---------------------------------------------------------------------------

export async function checkAndSend(): Promise<{
  checked: number;
  upcoming: number;
  overdue: number;
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
    select: ['id', 'display_name', 'maint_next_date'],
  });

  const upcoming: AlertAssetInfo[] = [];
  const overdue: AlertAssetInfo[] = [];

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

  const toAlert = [...overdue, ...upcoming];
  let emailSent = false;
  let teamsSent = false;

  if (toAlert.length === 0) {
    return { checked: allAssets.length, upcoming: 0, overdue: 0, emailSent, teamsSent, errors };
  }

  if (cfg.email_enabled && cfg.email_recipients?.length) {
    try {
      await sendEmail(cfg.email_recipients, toAlert);
      emailSent = true;
    } catch (err: unknown) {
      errors.push(`Email: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (cfg.teams_enabled && cfg.teams_webhook_url) {
    try {
      await sendTeams(cfg.teams_webhook_url, toAlert);
      teamsSent = true;
    } catch (err: unknown) {
      errors.push(`Teams: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    checked: allAssets.length,
    upcoming: upcoming.length,
    overdue: overdue.length,
    emailSent,
    teamsSent,
    errors,
  };
}

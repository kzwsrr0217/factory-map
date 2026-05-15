/**
 * Alerts.tsx — Maintenance alert configuration and notification history ("/alerts").
 *
 * Sections:
 *   Alert Conditions    — toggle alert_on_maintenance / alert_on_overdue, set days_before_alert
 *   Email               — toggle email_enabled, manage recipient addresses as removable chips
 *   Microsoft Teams     — toggle teams_enabled, enter Incoming Webhook URL
 *   Scheduled Alerts    — create one-off reminders (title, datetime, channel, asset_type filter);
 *                         fired by the hourly backend cron; operators and admins can manage
 *   Test / Save         — "Test Now" runs checkAndSend() immediately; "Save" persists config
 *   Alert History       — table of recent AlertLog rows (channel, status, subject, timestamp)
 *
 * Only admins can save config or run Test Now (enforced by the backend on PUT /alerts/config
 * and POST /alerts/test). Scheduled alert management requires operator role or above.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Bell, Mail, MessageSquare, PlayCircle, Save, X, Clock, Trash2, Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  alertService,
  AlertConfig,
  AlertLog,
  AlertTestResult,
  ScheduledAlert,
} from '../services/alert.service';
import styles from '../styles/pages/Alerts.module.css';

const Alerts: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';

  const [config, setConfig] = useState<AlertConfig | null>(null);
  const [logs, setLogs] = useState<AlertLog[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AlertTestResult | null>(null);

  // Recipient chip input state
  const [recipientDraft, setRecipientDraft] = useState('');

  // Scheduled alerts state
  const [scheduledAlerts, setScheduledAlerts] = useState<ScheduledAlert[]>([]);
  const [newAlertTitle, setNewAlertTitle] = useState('');
  const [newAlertDesc, setNewAlertDesc] = useState('');
  const [newAlertDate, setNewAlertDate] = useState('');
  const [newAlertChannels, setNewAlertChannels] = useState<'email' | 'teams' | 'both'>('both');
  const [newAlertFilter, setNewAlertFilter] = useState('');
  const [addingAlert, setAddingAlert] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cfg, { logs: l }, scheduled] = await Promise.all([
        alertService.getConfig(),
        alertService.getLogs(1, 50),
        alertService.getScheduledAlerts(),
      ]);
      setConfig(cfg);
      setLogs(l);
      setScheduledAlerts(scheduled);
    } catch {
      toast.error('Failed to load alert settings');
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = (field: keyof AlertConfig) => {
    if (!config) return;
    setConfig({ ...config, [field]: !config[field as keyof AlertConfig] });
  };

  const handleChange = (field: keyof AlertConfig, value: unknown) => {
    if (!config) return;
    setConfig({ ...config, [field]: value });
  };

  const addRecipient = () => {
    if (!config) return;
    const email = recipientDraft.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    const current = config.email_recipients ?? [];
    if (current.includes(email)) {
      setRecipientDraft('');
      return;
    }
    setConfig({ ...config, email_recipients: [...current, email] });
    setRecipientDraft('');
  };

  const removeRecipient = (email: string) => {
    if (!config) return;
    setConfig({
      ...config,
      email_recipients: (config.email_recipients ?? []).filter(e => e !== email),
    });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await alertService.saveConfig(config);
      setConfig(updated);
      toast.success('Alert settings saved');
    } catch {
      toast.error('Failed to save alert settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await alertService.testNow();
      setTestResult(result);
      toast.success(`Alert check complete — ${result.upcoming} upcoming, ${result.overdue} overdue`);
      // Reload logs to show new entries
      const { logs: newLogs } = await alertService.getLogs(1, 50);
      setLogs(newLogs);
    } catch {
      toast.error('Alert test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleCreateScheduledAlert = async () => {
    if (!newAlertTitle.trim() || !newAlertDate) return;
    setAddingAlert(true);
    try {
      const created = await alertService.createScheduledAlert({
        title: newAlertTitle.trim(),
        description: newAlertDesc.trim() || undefined,
        scheduled_for: new Date(newAlertDate).toISOString(),
        channels: newAlertChannels,
        asset_filter: newAlertFilter.trim() || undefined,
      });
      setScheduledAlerts(prev => [created, ...prev]);
      setNewAlertTitle('');
      setNewAlertDesc('');
      setNewAlertDate('');
      setNewAlertFilter('');
      setNewAlertChannels('both');
      toast.success('Scheduled alert created');
    } catch {
      toast.error('Failed to create scheduled alert');
    } finally {
      setAddingAlert(false);
    }
  };

  const handleDeleteScheduledAlert = async (id: string) => {
    try {
      await alertService.deleteScheduledAlert(id);
      setScheduledAlerts(prev => prev.filter(a => a.id !== id));
      toast.success('Scheduled alert removed');
    } catch {
      toast.error('Failed to delete scheduled alert');
    }
  };

  if (!config) {
    return (
      <div className={styles.page}>
        <p className={styles.empty}>Loading…</p>
      </div>
    );
  }

  const recipients = config.email_recipients ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          <Bell size={22} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Maintenance Alerts
        </h1>
        <p className={styles.subtitle}>
          Configure automated notifications for upcoming and overdue maintenance.
        </p>
      </div>

      <div className={styles.sections}>

        {/* ── Alert conditions ──────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Alert Conditions</h2>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Alert on upcoming maintenance</span>
              <span className={styles.hint}>Notify when maintenance is approaching</span>
            </div>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={config.alert_on_maintenance}
                onChange={() => handleToggle('alert_on_maintenance')}
                disabled={!isAdmin}
              />
              <span className={styles.toggleSlider} />
            </label>
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Alert on overdue maintenance</span>
              <span className={styles.hint}>Notify when maintenance date has passed</span>
            </div>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={config.alert_on_overdue}
                onChange={() => handleToggle('alert_on_overdue')}
                disabled={!isAdmin}
              />
              <span className={styles.toggleSlider} />
            </label>
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Days before maintenance to alert</span>
              <span className={styles.hint}>How early to start notifying</span>
            </div>
            <input
              type="number"
              min={1}
              max={365}
              value={config.days_before_alert}
              onChange={e => handleChange('days_before_alert', parseInt(e.target.value, 10) || 7)}
              disabled={!isAdmin}
              style={{ width: 80, textAlign: 'center', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 8px', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}
            />
          </div>
        </section>

        {/* ── Email ─────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <Mail size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Email Notifications
          </h2>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Enable email alerts</span>
              <span className={styles.hint}>Send via SMTP configured in server env vars</span>
            </div>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={config.email_enabled}
                onChange={() => handleToggle('email_enabled')}
                disabled={!isAdmin}
              />
              <span className={styles.toggleSlider} />
            </label>
          </div>

          {config.email_enabled && (
            <div className={styles.field}>
              <span className={styles.label}>Recipients</span>
              {recipients.length > 0 && (
                <div className={styles.chips}>
                  {recipients.map(email => (
                    <span key={email} className={styles.chip}>
                      {email}
                      {isAdmin && (
                        <button
                          className={styles.chipRemove}
                          onClick={() => removeRecipient(email)}
                          title="Remove"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {isAdmin && (
                <div className={styles.recipientInput}>
                  <input
                    type="email"
                    placeholder="name@company.com"
                    value={recipientDraft}
                    onChange={e => setRecipientDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={addRecipient}
                    type="button"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Teams ─────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <MessageSquare size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Microsoft Teams Notifications
          </h2>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Enable Teams alerts</span>
              <span className={styles.hint}>Posts an Adaptive Card to a Teams channel</span>
            </div>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={config.teams_enabled}
                onChange={() => handleToggle('teams_enabled')}
                disabled={!isAdmin}
              />
              <span className={styles.toggleSlider} />
            </label>
          </div>

          {config.teams_enabled && (
            <div className={styles.field}>
              <span className={styles.label}>Incoming Webhook URL</span>
              <span className={styles.hint}>
                Get this from: Teams channel → More options → Connectors → Incoming Webhook
              </span>
              <input
                type="url"
                placeholder="https://yourcompany.webhook.office.com/..."
                value={config.teams_webhook_url ?? ''}
                onChange={e => handleChange('teams_webhook_url', e.target.value || null)}
                disabled={!isAdmin}
              />
            </div>
          )}
        </section>

        {/* ── Scheduled Alerts ──────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <Clock size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Scheduled One-Off Alerts
          </h2>
          <p className={styles.hint} style={{ marginBottom: 16 }}>
            Create a reminder to fire at a specific date and time — e.g. "Check Veeam state next week" or "Review all assets tomorrow".
          </p>

          {/* Create form */}
          <div className={styles.scheduledForm}>
            <div className={styles.scheduledFormRow}>
              <input
                type="text"
                placeholder="Alert title *"
                value={newAlertTitle}
                onChange={e => setNewAlertTitle(e.target.value)}
                className={styles.scheduledInput}
              />
              <input
                type="datetime-local"
                value={newAlertDate}
                onChange={e => setNewAlertDate(e.target.value)}
                className={styles.scheduledInput}
                style={{ maxWidth: 220 }}
              />
              <select
                value={newAlertChannels}
                onChange={e => setNewAlertChannels(e.target.value as 'email' | 'teams' | 'both')}
                className={styles.scheduledInput}
                style={{ maxWidth: 130 }}
              >
                <option value="both">Both</option>
                <option value="email">Email only</option>
                <option value="teams">Teams only</option>
              </select>
            </div>
            <div className={styles.scheduledFormRow}>
              <input
                type="text"
                placeholder="Description (optional)"
                value={newAlertDesc}
                onChange={e => setNewAlertDesc(e.target.value)}
                className={styles.scheduledInput}
              />
              <input
                type="text"
                placeholder="Asset type filter (optional, e.g. server)"
                value={newAlertFilter}
                onChange={e => setNewAlertFilter(e.target.value)}
                className={styles.scheduledInput}
                style={{ maxWidth: 260 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleCreateScheduledAlert}
                disabled={addingAlert || !newAlertTitle.trim() || !newAlertDate}
                type="button"
                style={{ whiteSpace: 'nowrap' }}
              >
                <Plus size={14} style={{ marginRight: 4 }} />
                {addingAlert ? 'Adding…' : 'Add Alert'}
              </button>
            </div>
          </div>

          {/* List */}
          {scheduledAlerts.length === 0 ? (
            <p className={styles.empty}>No scheduled alerts yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className={styles.logTable}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Scheduled for</th>
                    <th>Channels</th>
                    <th>Status</th>
                    <th>Created by</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledAlerts.map(alert => (
                    <tr key={alert.id} style={{ opacity: alert.sent ? 0.6 : 1 }}>
                      <td>
                        <div>{alert.title}</div>
                        {alert.description && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                            {alert.description}
                          </div>
                        )}
                        {alert.asset_filter && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            Filter: {alert.asset_filter}
                          </div>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {new Date(alert.scheduled_for).toLocaleString('en-GB', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td style={{ textTransform: 'capitalize' }}>{alert.channels}</td>
                      <td>
                        {alert.sent ? (
                          <span className={styles.success}>Sent</span>
                        ) : new Date(alert.scheduled_for) < new Date() ? (
                          <span className={styles.failure}>Pending (overdue)</span>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)' }}>Scheduled</span>
                        )}
                      </td>
                      <td>{alert.created_by ?? '—'}</td>
                      <td>
                        {!alert.sent && (
                          <button
                            className={styles.iconBtn}
                            onClick={() => handleDeleteScheduledAlert(alert.id)}
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Actions ───────────────────────────────────────────── */}
        {isAdmin && (
          <div className={styles.actions}>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              <Save size={16} style={{ marginRight: 6 }} />
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleTest}
              disabled={testing}
              title="Run a maintenance check now and send notifications if assets are overdue or upcoming"
            >
              <PlayCircle size={16} style={{ marginRight: 6 }} />
              {testing ? 'Running…' : 'Test Now'}
            </button>
          </div>
        )}

        {/* ── Test result ───────────────────────────────────────── */}
        {testResult && (
          <div className={styles.testResult}>
            <div className={styles.testResultTitle}>Test run complete</div>
            <div className={styles.testResultItem}>Assets checked: {testResult.checked}</div>
            <div className={styles.testResultItem}>Upcoming: {testResult.upcoming}</div>
            <div className={styles.testResultItem}>Overdue: {testResult.overdue}</div>
            <div className={styles.testResultItem}>
              Email: {testResult.emailSent ? '✓ sent' : testResult.errors.some(e => e.startsWith('Email')) ? '✗ failed' : '— skipped'}
            </div>
            <div className={styles.testResultItem}>
              Teams: {testResult.teamsSent ? '✓ sent' : testResult.errors.some(e => e.startsWith('Teams')) ? '✗ failed' : '— skipped'}
            </div>
            {testResult.errors.length > 0 && (
              <div className={styles.failure}>
                Errors: {testResult.errors.join('; ')}
              </div>
            )}
          </div>
        )}

        {/* ── Alert History ─────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Alert History</h2>
          {logs.length === 0 ? (
            <p className={styles.empty}>No notifications have been sent yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className={styles.logTable}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Channel</th>
                    <th>Subject</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {new Date(log.sent_at).toLocaleString('en-GB', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td style={{ textTransform: 'capitalize' }}>{log.channel}</td>
                      <td title={log.body_snippet}>{log.subject}</td>
                      <td>
                        {log.success ? (
                          <span className={styles.success}>OK</span>
                        ) : (
                          <span className={styles.failure} title={log.error_message ?? ''}>
                            Failed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </div>
  );
};

export default Alerts;

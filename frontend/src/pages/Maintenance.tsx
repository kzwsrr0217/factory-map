/**
 * Maintenance.tsx — Monthly calendar view of scheduled and overdue asset maintenance.
 *
 * Layout:
 *   Month navigator + summary strip
 *   Overdue section (assets past next_date) — collapsible
 *   Calendar grid — each day cell lists the assets due that day
 *   Clicking an asset row opens AssetDetailsModal
 */
import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, Wrench, CalendarDays, Download, List, LayoutGrid, CheckCircle, Printer } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import AssetDetailsModal from '../components/asset/AssetDetailsModal';
import { Asset, assetService } from '../services/asset.service';
import { useAssets, assetKeys } from '../hooks/queries/useAssets';
import { useFloors } from '../hooks/queries/useFloors';
import { useToast } from '../contexts/ToastContext';
import styles from '../styles/pages/Maintenance.module.css';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const Maintenance: React.FC = () => {
  const { data: allAssets = [], isLoading: loading } = useAssets();
  const { data: floors = [] } = useFloors();
  const assets = allAssets.filter((a: Asset) => a.maintenance?.next_date);
  const toast = useToast();
  const qc = useQueryClient();
  const [today] = useState(() => new Date());
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [orderRange, setOrderRange] = useState<'overdue' | 'week' | 'month' | 'all'>('all');
  const [markingDoneIds, setMarkingDoneIds] = useState<Set<string>>(new Set());
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-based
  const [overdueOpen, setOverdueOpen] = useState(true);
  const [viewAsset, setViewAsset] = useState<Asset | null>(null);
  // key = "YYYY-MM-DD", value = true when expanded past 3 items
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const overdue = useMemo(
    () => assets.filter(a => new Date(a.maintenance!.next_date!).getTime() < today.setHours(0, 0, 0, 0)),
    [assets, today]
  );

  // Build a map: "YYYY-MM-DD" → Asset[]
  const byDate = useMemo(() => {
    const map = new Map<string, Asset[]>();
    assets.forEach(a => {
      const d = a.maintenance?.next_date;
      if (!d) return;
      const key = d.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    return map;
  }, [assets]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const goToday = () => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); };

  // Build calendar cells
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    // Shift Sunday(0) → 7 so week starts Monday
    const startDow = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (number | null)[] = Array(startDow).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    // pad to full weeks
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth]);

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const monthName = new Date(viewYear, viewMonth, 1).toLocaleString('default', { month: 'long', year: 'numeric' });

  const handleExportMonth = () => {
    const monthAssets = assets.filter(a => {
      const d = new Date(a.maintenance!.next_date!);
      return d.getFullYear() === viewYear && d.getMonth() === viewMonth;
    });
    const rows = [
      ['Asset Name', 'Type', 'Status', 'Next Maintenance', 'Last Maintenance', 'Assigned Person', 'Serial', 'IP Address'],
      ...monthAssets.map(a => [
        a.basic_info.display_name,
        a.basic_info.type ?? '',
        a.basic_info.status ?? '',
        a.maintenance?.next_date ? new Date(a.maintenance.next_date).toLocaleDateString() : '',
        a.maintenance?.last_date ? new Date(a.maintenance.last_date).toLocaleDateString() : '',
        a.assigned_person?.full_name ?? '',
        a.basic_info.serial_number ?? '',
        a.network?.ip_address ?? '',
      ]),
    ];
    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `maintenance-${viewYear}-${String(viewMonth + 1).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${monthAssets.length} assets for ${monthName}`);
  };

  const upcomingThisMonth = useMemo(() => {
    return assets.filter(a => {
      const d = new Date(a.maintenance!.next_date!);
      return d.getFullYear() === viewYear && d.getMonth() === viewMonth;
    }).length;
  }, [assets, viewYear, viewMonth]);

  const workOrders = useMemo(() => {
    const todayTs = new Date(today).setHours(0, 0, 0, 0);
    let list = [...assets];
    if (orderRange === 'overdue') {
      list = list.filter(a => new Date(a.maintenance!.next_date!).getTime() < todayTs);
    } else if (orderRange === 'week') {
      const weekLater = todayTs + 7 * 86400000;
      list = list.filter(a => {
        const ts = new Date(a.maintenance!.next_date!).getTime();
        return ts >= todayTs && ts < weekLater;
      });
    } else if (orderRange === 'month') {
      const monthLater = todayTs + 30 * 86400000;
      list = list.filter(a => {
        const ts = new Date(a.maintenance!.next_date!).getTime();
        return ts >= todayTs && ts < monthLater;
      });
    }
    return list.sort((a, b) => {
      const at = new Date(a.maintenance!.next_date!).getTime();
      const bt = new Date(b.maintenance!.next_date!).getTime();
      return at - bt;
    });
  }, [assets, orderRange, today]);

  const workOrdersByFloor = useMemo(() => {
    const grouped = new Map<string, Asset[]>();
    workOrders.forEach(a => {
      const fid = a.hierarchy?.floor_id ?? '__unassigned__';
      if (!grouped.has(fid)) grouped.set(fid, []);
      grouped.get(fid)!.push(a);
    });
    return grouped;
  }, [workOrders]);

  const handleMarkDone = async (a: Asset) => {
    if (!a._id || markingDoneIds.has(a._id)) return;
    setMarkingDoneIds(prev => new Set([...prev, a._id]));
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      let nextStr: string | undefined;
      if (a.maintenance?.interval_days) {
        const next = new Date();
        next.setDate(next.getDate() + a.maintenance.interval_days);
        nextStr = next.toISOString().split('T')[0];
      }
      await assetService.updateAsset(a._id, { maintenance: { last_date: todayStr, next_date: nextStr } } as any);
      qc.invalidateQueries({ queryKey: assetKeys.all });
      toast.success(`Maintenance done: ${a.basic_info.display_name}`);
    } catch {
      toast.error('Failed to update maintenance');
    } finally {
      setMarkingDoneIds(prev => { const s = new Set(prev); s.delete(a._id); return s; });
    }
  };

  const handlePrintWorkOrders = () => {
    const todayStr = new Date().toLocaleDateString();
    const rangeLabel: Record<typeof orderRange, string> = {
      all: 'All scheduled', overdue: 'Overdue', week: 'Due this week', month: 'Due in 30 days',
    };
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;
    const rows = Array.from(workOrdersByFloor.entries()).map(([fid, floorAssets]) => {
      const floorObj = floors.find(f => f._id === fid);
      const floorLabel = floorObj ? floorObj.name : 'Unassigned';
      const assetRows = floorAssets.map(a => {
        const isOvd = new Date(a.maintenance!.next_date!).getTime() < Date.now();
        return `<tr>
          <td>${a.basic_info.display_name}</td>
          <td>${a.basic_info.type ?? ''}</td>
          <td style="color:${isOvd ? '#dc2626' : 'inherit'}">${new Date(a.maintenance!.next_date!).toLocaleDateString()}</td>
          <td>${a.maintenance?.last_date ? new Date(a.maintenance.last_date).toLocaleDateString() : '—'}</td>
          <td>${a.assigned_person?.full_name ?? '—'}</td>
          <td style="color:${isOvd ? '#dc2626' : '#d97706'}">${isOvd ? 'OVERDUE' : 'Upcoming'}</td>
          <td style="text-align:center">☐</td>
        </tr>`;
      }).join('');
      return `<tr><td colspan="7" style="background:#f3f4f6;font-weight:700;padding:8px 12px;border-top:2px solid #d1d5db">${floorLabel} (${floorAssets.length})</td></tr>${assetRows}`;
    }).join('');

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Maintenance Work Orders</title>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:24px}
  h1{font-size:18px;margin:0 0 4px}
  .meta{font-size:11px;color:#6b7280;margin-bottom:16px}
  table{width:100%;border-collapse:collapse}
  th{background:#1d4ed8;color:#fff;padding:6px 10px;text-align:left;font-size:11px;text-transform:uppercase}
  td{padding:5px 10px;border-bottom:1px solid #e5e7eb;font-size:11px}
  tr:hover td{background:#f9fafb}
  @media print{body{margin:0} .no-print{display:none}}
</style></head><body>
<h1>Maintenance Work Orders</h1>
<div class="meta">Printed: ${todayStr} &nbsp;·&nbsp; Filter: ${rangeLabel[orderRange]} &nbsp;·&nbsp; ${workOrders.length} tasks</div>
<table>
  <thead><tr>
    <th>Asset</th><th>Type</th><th>Due Date</th><th>Last Done</th><th>Assigned To</th><th>Status</th><th style="width:50px">Done ✓</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<script>window.onload=()=>window.print()</` + `</script>
</body></html>`);
    printWindow.document.close();
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.header}><h1>Maintenance Calendar</h1></div>
        <Card padding="lg"><p style={{ color: 'var(--color-gray-500)' }}>Loading...</p></Card>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Maintenance {view === 'list' ? 'Work Orders' : 'Calendar'}</h1>
          <p className={styles.subtitle}>
            {assets.length} asset{assets.length !== 1 ? 's' : ''} with scheduled maintenance
            {overdue.length > 0 && ` · `}
            {overdue.length > 0 && <span className={styles.overdueCount}>{overdue.length} overdue</span>}
          </p>
        </div>
        <div className={styles.headerActions}>
          {view === 'list' && (
            <select
              className={styles.rangeSelect}
              value={orderRange}
              onChange={e => setOrderRange(e.target.value as typeof orderRange)}
            >
              <option value="all">All scheduled</option>
              <option value="overdue">Overdue only</option>
              <option value="week">Due this week</option>
              <option value="month">Due in 30 days</option>
            </select>
          )}
          {view === 'list' && workOrders.length > 0 && (
            <Button variant="outline" size="sm" onClick={handlePrintWorkOrders}>
              <Printer size={13} style={{ marginRight: 4 }} />Print
            </Button>
          )}
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewBtn} ${view === 'calendar' ? styles.viewBtnActive : ''}`}
              onClick={() => setView('calendar')}
              title="Calendar view"
            >
              <LayoutGrid size={15} />
            </button>
            <button
              className={`${styles.viewBtn} ${view === 'list' ? styles.viewBtnActive : ''}`}
              onClick={() => setView('list')}
              title="Work orders list"
            >
              <List size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Work orders list view */}
      {view === 'list' && (
        <div className={styles.workOrderList}>
          {workOrders.length === 0 ? (
            <Card padding="lg">
              <p style={{ color: 'var(--color-gray-500)', textAlign: 'center', fontStyle: 'italic' }}>
                No maintenance tasks match the selected range.
              </p>
            </Card>
          ) : (
            Array.from(workOrdersByFloor.entries()).map(([fid, floorAssets]) => {
              const floorObj = floors.find(f => f._id === fid);
              const floorLabel = floorObj ? floorObj.name : 'Unassigned / No Floor';
              return (
                <div key={fid} className={styles.workOrderGroup}>
                  <div className={styles.workOrderFloorHeader}>
                    <span>{floorLabel}</span>
                    <span className={styles.workOrderFloorCount}>{floorAssets.length} task{floorAssets.length !== 1 ? 's' : ''}</span>
                  </div>
                  {floorAssets.map(a => {
                    const isOverdueItem = new Date(a.maintenance!.next_date!).getTime() < new Date().setHours(0, 0, 0, 0);
                    const isDone = markingDoneIds.has(a._id);
                    return (
                      <div key={a._id} className={styles.workOrderItem}>
                        <div className={styles.workOrderInfo}>
                          <button className={styles.workOrderName} onClick={() => setViewAsset(a)}>
                            {a.basic_info.display_name}
                          </button>
                          <span className={styles.workOrderMeta}>{a.basic_info.type}</span>
                          {a.assigned_person?.full_name && (
                            <span className={styles.workOrderMeta}>· {a.assigned_person.full_name}</span>
                          )}
                        </div>
                        <div className={styles.workOrderRight}>
                          <span className={styles.workOrderDate} style={{ color: isOverdueItem ? '#dc2626' : undefined }}>
                            {new Date(a.maintenance!.next_date!).toLocaleDateString()}
                          </span>
                          {isOverdueItem
                            ? <Badge variant="error" size="sm">Overdue</Badge>
                            : <Badge variant="warning" size="sm">Upcoming</Badge>
                          }
                          <button
                            className={styles.markDoneBtn}
                            onClick={() => handleMarkDone(a)}
                            disabled={isDone}
                            title="Mark maintenance done"
                          >
                            <CheckCircle size={14} />
                            {isDone ? 'Saving…' : 'Mark Done'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Calendar view */}
      {view === 'calendar' && overdue.length > 0 && (
        <Card padding="lg" className={styles.overdueCard}>
          <button
            className={styles.overdueToggle}
            onClick={() => setOverdueOpen(o => !o)}
          >
            <AlertTriangle size={16} className={styles.overdueIcon} />
            <span>{overdue.length} Overdue asset{overdue.length !== 1 ? 's' : ''}</span>
            <span className={styles.overdueChevron}>{overdueOpen ? '▲' : '▼'}</span>
          </button>
          {overdueOpen && (
            <div className={styles.overdueList}>
              {overdue.map(a => (
                <button
                  key={a._id}
                  className={styles.assetRow}
                  onClick={() => setViewAsset(a)}
                >
                  <span className={styles.assetName}>{a.basic_info.display_name}</span>
                  <span className={styles.assetMeta}>{a.basic_info.type}</span>
                  <span className={styles.assetDate} style={{ color: '#dc2626' }}>
                    {new Date(a.maintenance!.next_date!).toLocaleDateString()}
                  </span>
                  <Badge variant="error" size="sm">Overdue</Badge>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Calendar */}
      {view === 'calendar' && <Card padding="lg">
        {/* Nav */}
        <div className={styles.calNav}>
          <div className={styles.calNavLeft}>
            <button className={styles.navBtn} onClick={prevMonth}><ChevronLeft size={16} /></button>
            <h2 className={styles.monthTitle}>{monthName}</h2>
            <button className={styles.navBtn} onClick={nextMonth}><ChevronRight size={16} /></button>
            <select
              value={viewYear}
              onChange={e => setViewYear(Number(e.target.value))}
              style={{ marginLeft: 8, height: 30, padding: '0 6px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              {Array.from({ length: 10 }, (_, i) => today.getFullYear() - 2 + i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className={styles.calNavRight}>
            {upcomingThisMonth > 0 && (
              <span className={styles.monthSummary}>
                <Wrench size={13} /> {upcomingThisMonth} due this month
              </span>
            )}
            <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
            {upcomingThisMonth > 0 && (
              <Button variant="outline" size="sm" onClick={handleExportMonth}>
                <Download size={13} style={{ marginRight: 4 }} />CSV
              </Button>
            )}
          </div>
        </div>

        {/* Weekday headers */}
        <div className={styles.calGrid}>
          {WEEKDAYS.map(d => (
            <div key={d} className={styles.calDayHeader}>{d}</div>
          ))}

          {calendarDays.map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} className={styles.calCell} />;
            const key = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayAssets = byDate.get(key) ?? [];
            const isToday = key === todayKey;
            const isPast = new Date(viewYear, viewMonth, day).getTime() < today.setHours(0, 0, 0, 0);

            return (
              <div
                key={key}
                className={`${styles.calCell} ${styles.calCellActive} ${isToday ? styles.calCellToday : ''} ${isPast && dayAssets.length > 0 ? styles.calCellOverdue : ''}`}
              >
                <span className={`${styles.calDayNum} ${isToday ? styles.calDayNumToday : ''}`}>{day}</span>
                <div className={styles.calEvents}>
                  {(expandedDays.has(key) ? dayAssets : dayAssets.slice(0, 3)).map(a => (
                    <button
                      key={a._id}
                      className={`${styles.calEvent} ${isPast ? styles.calEventOverdue : styles.calEventNormal}`}
                      onClick={() => setViewAsset(a)}
                      title={`${a.basic_info.display_name} — ${a.basic_info.type}`}
                    >
                      <CalendarDays size={10} style={{ flexShrink: 0 }} />
                      <span className={styles.calEventName}>{a.basic_info.display_name}</span>
                    </button>
                  ))}
                  {dayAssets.length > 3 && !expandedDays.has(key) && (
                    <button
                      className={styles.calMore}
                      onClick={() => setExpandedDays(prev => new Set([...prev, key]))}
                    >
                      +{dayAssets.length - 3} more
                    </button>
                  )}
                  {dayAssets.length > 3 && expandedDays.has(key) && (
                    <button
                      className={styles.calMore}
                      onClick={() => setExpandedDays(prev => { const s = new Set(prev); s.delete(key); return s; })}
                    >
                      show less
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>}

      {/* Asset details modal */}
      {viewAsset && (
        <AssetDetailsModal
          isOpen={!!viewAsset}
          onClose={() => setViewAsset(null)}
          asset={viewAsset}
        />
      )}
    </div>
  );
};

export default Maintenance;

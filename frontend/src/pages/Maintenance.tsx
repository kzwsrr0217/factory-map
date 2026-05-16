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
import { ChevronLeft, ChevronRight, AlertTriangle, Wrench, CalendarDays, Download } from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import AssetDetailsModal from '../components/asset/AssetDetailsModal';
import { Asset } from '../services/asset.service';
import { useAssets } from '../hooks/queries/useAssets';
import { useToast } from '../contexts/ToastContext';
import styles from '../styles/pages/Maintenance.module.css';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const Maintenance: React.FC = () => {
  const { data: allAssets = [], isLoading: loading } = useAssets();
  const assets = allAssets.filter((a: Asset) => a.maintenance?.next_date);
  const toast = useToast();
  const [today] = useState(() => new Date());
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-based
  const [overdueOpen, setOverdueOpen] = useState(true);
  const [viewAsset, setViewAsset] = useState<Asset | null>(null);

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
          <h1>Maintenance Calendar</h1>
          <p className={styles.subtitle}>
            {assets.length} asset{assets.length !== 1 ? 's' : ''} with scheduled maintenance
            {overdue.length > 0 && ` · `}
            {overdue.length > 0 && <span className={styles.overdueCount}>{overdue.length} overdue</span>}
          </p>
        </div>
      </div>

      {/* Overdue section */}
      {overdue.length > 0 && (
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
      <Card padding="lg">
        {/* Nav */}
        <div className={styles.calNav}>
          <div className={styles.calNavLeft}>
            <button className={styles.navBtn} onClick={prevMonth}><ChevronLeft size={16} /></button>
            <h2 className={styles.monthTitle}>{monthName}</h2>
            <button className={styles.navBtn} onClick={nextMonth}><ChevronRight size={16} /></button>
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
                  {dayAssets.slice(0, 3).map(a => (
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
                  {dayAssets.length > 3 && (
                    <span className={styles.calMore}>+{dayAssets.length - 3} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

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

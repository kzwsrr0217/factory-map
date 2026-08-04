/**
 * Dashboard.tsx — Main landing page after login ("/").
 *
 * Combines a summary stats strip, the full paginated asset list, and inline
 * ITSM-sync / delete / export capabilities in a single page.
 *
 * Sections:
 *   Stats row        — total, active, maintenance, building count.
 *   Search + filters — SearchBar (name/tag/serial) + AdvancedFilter modal.
 *   Asset table      — paginated list with inline status badge, ITSM indicator,
 *                      and quick-action buttons (view, edit, delete).
 *   Bulk actions     — CSV export of visible assets, JSON import modal.
 *   Reports panel    — AssetReports modal triggered from toolbar.
 *
 * Socket.io events (`asset:created`, `asset:updated`, `asset:deleted`) trigger
 * incremental list reloads via `useSocket` so the table stays live without
 * manual refresh.
 */
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Monitor, Activity, Wrench, Building2, AlertTriangle, Bell, Eye, Map, Download, Upload, BarChart2, Filter, Trash2, MoveRight, FileText, LayoutGrid, List, ChevronUp, ChevronDown, ChevronsUpDown, Columns3 } from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import ConfirmDialog from '../components/common/ConfirmDialog';
import SearchBar from '../components/common/SearchBar';
import { CardSkeleton, ListSkeleton } from '../components/common/Skeleton';
import AdvancedFilter, { FilterCriteria } from '../components/filter/AdvancedFilter';
import AssetReports from '../components/asset/AssetReports';
import AssetImportModal from '../components/asset/AssetImportModal';
import AssetDetailsModal from '../components/asset/AssetDetailsModal';
import { assetService, Asset } from '../services/asset.service';
import { getAssetIcon } from '../utils/assetTypes';
import { loadSettings } from '../utils/settings';
import { useToast } from '../contexts/ToastContext';
import { useSocket } from '../hooks/useSocket';
import AssetCreationWizard from '../components/asset/AssetCreationWizard';
import { useAssetPage, useAssetStats, assetKeys } from '../hooks/queries/useAssets';
import { useBuildings } from '../hooks/queries/useBuildings';
import { useFloors } from '../hooks/queries/useFloors';
import { useWorkareas } from '../hooks/queries/useWorkareas';
import { getApiErrorMessage } from '../utils/apiError';
import { usePersonSuggestions } from '../hooks/usePersonSuggestions';
import { useAuditLog } from '../hooks/queries/useAuditLog';
import styles from '../styles/pages/Dashboard.module.css';

// Table-view optional columns — Name (identity) and the trailing actions
// column are always shown and not part of this list.
const COLUMN_DEFS = [
  { key: 'type',         label: 'Type' },
  { key: 'status',       label: 'Status' },
  { key: 'manufacturer', label: 'Manufacturer / Model' },
  { key: 'ip_serial',    label: 'IP / Serial' },
  { key: 'location',     label: 'Location' },
  { key: 'maintenance',  label: 'Next Maint.' },
] as const;
type ColumnKey = typeof COLUMN_DEFS[number]['key'];

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  /**
   * Every tile and chart comes from the stats endpoint, which counts the whole table.
   * They must not be derived from the list: the list is one page now (and before that
   * it was capped at 1000 rows, which had the tiles reading "1000 Total Assets" while
   * the database held 1057, with every breakdown short by the same 57).
   */
  const { data: assetStats } = useAssetStats();

  const { data: buildings = [] } = useBuildings();
  const { data: floors = [] } = useFloors();
  const { data: workareas = [] } = useWorkareas();
  const { data: recentActivity } = useAuditLog({ limit: 8, offset: 0 });
  const [searchQuery, setSearchQuery] = useState(() => localStorage.getItem('db_search') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => (localStorage.getItem('db_search') ?? '').trim());
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterCriteria>(() => {
    try { return JSON.parse(localStorage.getItem('db_filters') ?? ''); } catch { return { itsmManaged: 'all' }; }
  });
  const [reportsOpen, setReportsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  // "Move to floor" grew into a general bulk-edit panel: after an inventory
  // import the corrections that come in groups are the ROOM (not just the floor),
  // the person, and the status — and sometimes "put these back in the tray".
  const [bulkMoveFloorId, setBulkMoveFloorId] = useState<string>('');
  const [bulkMoveWorkareaId, setBulkMoveWorkareaId] = useState<string>('');
  const [bulkPerson, setBulkPerson] = useState<string>('');
  const [bulkClearPlacement, setBulkClearPlacement] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [maintenanceFilter, setMaintenanceFilter] = useState<'overdue' | 'upcoming' | null>(
    () => (localStorage.getItem('db_maint') as 'overdue' | 'upcoming' | null) ?? null
  );
  const [quickStatusFilter, setQuickStatusFilter] = useState<'active' | 'maintenance' | null>(
    () => (localStorage.getItem('db_qstatus') as 'active' | 'maintenance' | null) ?? null
  );
  const [assignedToFilter, setAssignedToFilter] = useState(
    () => localStorage.getItem('db_assigned') ?? ''
  );
  const [viewAsset, setViewAsset] = useState<Asset | null>(null);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [itsmSyncing, setItsmSyncing] = useState(false);
  const [itsmSyncResult, setItsmSyncResult] = useState<{
    created: number; updated: number; snapshotted: number; errors: number;
  } | null>(null);
  const [conflictFilter, setConflictFilter] = useState(
    () => localStorage.getItem('db_conflict') === 'true'
  );
  const [viewMode, setViewMode] = useState<'card' | 'table'>(
    () => (localStorage.getItem('db_view') as 'card' | 'table') ?? 'card'
  );
  const [sortField, setSortField] = useState(() => localStorage.getItem('db_sort') ?? 'name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(
    () => (localStorage.getItem('db_sort_dir') as 'asc' | 'desc') ?? 'asc'
  );
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('db_columns') ?? 'null');
      if (Array.isArray(saved)) return new Set(saved);
    } catch { /* fall through to default */ }
    return new Set(COLUMN_DEFS.map(c => c.key));
  });
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const columnsMenuRef = useRef<HTMLDivElement>(null);
  const itemsPerPage = loadSettings().itemsPerPage;
  const toast = useToast();

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Close column-picker popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target as Node)) {
        setColumnsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Ctrl+N → New Asset shortcut
  useEffect(() => {
    const handler = () => setCreateOpen(true);
    window.addEventListener('app:new-asset', handler);
    return () => window.removeEventListener('app:new-asset', handler);
  }, []);

  // Live updates via WebSocket — update React Query cache directly
  useSocket('asset:created', () => { qc.invalidateQueries({ queryKey: assetKeys.all }); });
  useSocket('asset:updated', (updated) => {
    qc.invalidateQueries({ queryKey: assetKeys.all });
  });
  useSocket('asset:deleted', ({ _id }: { _id: string }) => {
    qc.invalidateQueries({ queryKey: assetKeys.all });
  });

  const now = Date.now();
  const sevenDays = 7 * 86400000;
  const thirtyDays = 30 * 86400000;

  /**
   * The list query, in one place, sent to the server.
   *
   * Every one of these used to be a `.filter()` over a downloaded copy of the estate.
   * That worked, but it meant each visit shipped every asset, and it put the meaning
   * of each filter in two places — the browser's and (for search) the server's. With
   * the list paged, filtering in the browser is not just wasteful but wrong: the page
   * count would describe a set the server never selected.
   */
  const listQuery = useMemo(() => ({
    page,
    limit: itemsPerPage,
    sort: sortField,
    dir: sortDir,
    // The quick pills win over the panel where they overlap, which is what clicking a
    // tile visibly does; the panel's own status field is left for finer matches.
    // The panel's "asset name" and the search box both narrow by name; the server's
    // `q` covers name, serial, tag, manufacturer, model, IP, hostname and person, so
    // whichever was typed goes there. Both at once is a contradiction the panel
    // cannot express, so the box wins.
    q: debouncedSearch || filters.assetName || undefined,
    status: quickStatusFilter ?? filters.status ?? undefined,
    manufacturer: filters.manufacturer || undefined,
    model: filters.model || undefined,
    serial_number: filters.serialNumber || undefined,
    asset_tag: filters.assetTag || undefined,
    person: assignedToFilter || filters.assignedPerson || undefined,
    building_id: filters.buildingId || undefined,
    floor_id: filters.floorId || undefined,
    workarea_id: filters.workareaId || undefined,
    itsm_managed: filters.itsmManaged && filters.itsmManaged !== 'all' ? filters.itsmManaged : undefined,
    maintenance: maintenanceFilter ?? undefined,
    conflicts: conflictFilter || undefined,
  }), [page, itemsPerPage, sortField, sortDir, debouncedSearch, filters,
       maintenanceFilter, conflictFilter, quickStatusFilter, assignedToFilter]);

  const { data: pageData, isLoading, isError, isFetching } = useAssetPage(listQuery);
  const pageAssets = pageData?.assets ?? [];
  const matchingTotal = pageData?.total ?? 0;
  const totalPages = pageData?.totalPages ?? 1;
  /** True when anything narrows the list — used for the empty state's wording. */
  const filterActive = !!(
    listQuery.q || listQuery.status || listQuery.manufacturer || listQuery.model ||
    listQuery.serial_number || listQuery.asset_tag || listQuery.person ||
    listQuery.building_id || listQuery.floor_id || listQuery.workarea_id ||
    listQuery.itsm_managed || listQuery.maintenance || listQuery.conflicts
  );

  // Any change to what is being asked for resets to page 1: page 7 of a narrower
  // result set is usually empty, and an empty page reads as "nothing matches".
  useEffect(() => { setPage(1); }, [debouncedSearch, filters, maintenanceFilter, conflictFilter, quickStatusFilter, assignedToFilter, sortField, sortDir]);

  const handleApplyFilters = (newFilters: FilterCriteria) => {
    setFilters(newFilters);
  };

  const handleSyncAllFromItsm = async () => {
    setItsmSyncing(true);
    setItsmSyncResult(null);
    try {
      const result = await assetService.syncAllFromItsm();
      setItsmSyncResult({
        created: result.created,
        updated: result.updated,
        snapshotted: result.snapshotted,
        errors: result.errors.length,
      });
      toast.success(`Sync complete: ${result.created} new, ${result.updated} updated, ${result.snapshotted} conflicts detected`);
      qc.invalidateQueries({ queryKey: assetKeys.all });
    } catch {
      toast.error('ITSM sync failed. Check server logs.');
    } finally {
      setItsmSyncing(false);
    }
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Every row the current filter matches, for the exports.
   *
   * The exports have always covered the filter rather than the visible page, which
   * used to be free because the whole estate sat in memory. It now costs a paged
   * sweep — worth it for an explicit action, and the alternative (exporting only the
   * page) would silently change what the button means.
   */
  const fetchMatching = async (): Promise<Asset[]> => {
    const { page: _p, limit: _l, ...rest } = listQuery;
    return assetService.getAllMatching(rest);
  };

  const handleExportCSV = async () => {
    const filteredAssets = await fetchMatching();
    const rows = [
      ['Name', 'Type', 'Manufacturer', 'Model', 'Serial', 'Asset Tag', 'Status',
       'IP Address', 'Hostname', 'MAC', 'Assigned Person',
       'Building', 'Floor', 'Work Area',
       'Last Maintenance', 'Next Maintenance',
       'ITSM Managed', 'Notes'],
      ...filteredAssets.map((a) => [
        a.basic_info?.display_name ?? '',
        a.basic_info?.type ?? '',
        a.basic_info?.manufacturer ?? '',
        a.basic_info?.model ?? '',
        a.basic_info?.serial_number ?? '',
        a.basic_info?.asset_tag ?? '',
        a.basic_info?.status ?? '',
        a.network?.ip_address ?? '',
        a.network?.hostname ?? '',
        a.basic_info?.mac_address ?? '',
        a.assigned_person?.full_name ?? '',
        buildings.find((b) => b._id === a.hierarchy?.building_id)?.name ?? '',
        floors.find((f) => f._id === a.hierarchy?.floor_id)?.name ?? '',
        workareas.find((w) => w._id === a.hierarchy?.workarea_id)?.name ?? '',
        a.maintenance?.last_date ? new Date(a.maintenance.last_date).toLocaleDateString() : '',
        a.maintenance?.next_date ? new Date(a.maintenance.next_date).toLocaleDateString() : '',
        a.itsm?.is_managed ? 'Yes' : 'No',
        (a as any).custom_fields?.notes ?? '',
      ]),
    ];
    // UTF-8 BOM so Excel opens it correctly
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `assets-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${filteredAssets.length} assets to CSV`);
  };

  const handleExportJSON = async () => {
    const filteredAssets = await fetchMatching();
    const data = filteredAssets.map((a) => ({
      id: a._id,
      name: a.basic_info?.display_name,
      type: a.basic_info?.type,
      manufacturer: a.basic_info?.manufacturer,
      model: a.basic_info?.model,
      serial_number: a.basic_info?.serial_number,
      asset_tag: a.basic_info?.asset_tag,
      status: a.basic_info?.status,
      ip_address: a.network?.ip_address,
      hostname: a.network?.hostname,
      mac_address: a.basic_info?.mac_address,
      assigned_person: a.assigned_person?.full_name,
      building: buildings.find((b) => b._id === a.hierarchy?.building_id)?.name,
      floor: floors.find((f) => f._id === a.hierarchy?.floor_id)?.name,
      workarea: workareas.find((w) => w._id === a.hierarchy?.workarea_id)?.name,
      maintenance_last: a.maintenance?.last_date,
      maintenance_next: a.maintenance?.next_date,
      itsm_managed: a.itsm?.is_managed,
      connections: a.connections?.length ?? 0,
      notes: (a as any).custom_fields?.notes,
    }));
    const json = JSON.stringify(data, null, 2);
    triggerDownload(new Blob([json], { type: 'application/json' }), `assets-${new Date().toISOString().slice(0, 10)}.json`);
    toast.success(`Exported ${filteredAssets.length} assets to JSON`);
  };

  const handleExportPDF = async () => {
    const filteredAssets = await fetchMatching();
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const date = new Date().toLocaleDateString();

    doc.setFontSize(16);
    doc.text('Factory Map — Asset Report', 14, 16);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generated: ${date}  |  Assets: ${filteredAssets.length}`, 14, 23);
    doc.setTextColor(0);

    autoTable(doc, {
      startY: 28,
      head: [['Name', 'Type', 'Status', 'Manufacturer', 'Model', 'IP Address', 'Assigned Person', 'Next Maintenance']],
      body: filteredAssets.map((a) => [
        a.basic_info?.display_name ?? '',
        a.basic_info?.type ?? '',
        a.basic_info?.status ?? '',
        a.basic_info?.manufacturer ?? '',
        a.basic_info?.model ?? '',
        a.network?.ip_address ?? '',
        a.assigned_person?.full_name ?? '',
        a.maintenance?.next_date ? new Date(a.maintenance.next_date).toLocaleDateString() : '',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { cellWidth: 45 } },
    });

    doc.save(`assets-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success(`Exported ${filteredAssets.length} assets to PDF`);
  };

  const toggleAssetSelection = (assetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAssetIds(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  };

  const handleBulkStatusChange = async (status: string) => {
    if (selectedAssetIds.size === 0) return;
    setBulkUpdating(true);
    try {
      // One request rather than one per asset: this used to fan out N parallel
      // PATCHes, which on a 200-row selection meant 200 round-trips and a partial
      // result if any of them failed.
      await assetService.bulkUpdate(Array.from(selectedAssetIds), { status });
      // The table is a server page now, so there is no local list to patch:
      // invalidate and let the query refetch what the server actually holds.
      qc.invalidateQueries({ queryKey: assetKeys.all });
      toast.success(`${selectedAssetIds.size} asset${selectedAssetIds.size !== 1 ? 's' : ''} set to ${status}`);
      setSelectedAssetIds(new Set());
    } catch {
      toast.error('Bulk status update failed');
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedAssetIds.size === 0) return;
    setBulkUpdating(true);
    try {
      await Promise.all(Array.from(selectedAssetIds).map(id => assetService.deleteAsset(id)));
      // The table is a server page now, so there is no local list to patch:
      // invalidate and let the query refetch what the server actually holds.
      qc.invalidateQueries({ queryKey: assetKeys.all });
      toast.success(`${selectedAssetIds.size} asset${selectedAssetIds.size !== 1 ? 's' : ''} deleted`);
      setSelectedAssetIds(new Set());
    } catch {
      toast.error('Bulk delete failed');
    } finally {
      setBulkUpdating(false);
      setBulkDeleteConfirm(false);
    }
  };

  /** Whether the panel has anything to apply — guards an empty request. */
  const bulkEditHasChanges = !!bulkMoveWorkareaId || bulkPerson.trim() !== '' || bulkClearPlacement;

  const handleBulkEdit = async () => {
    if (selectedAssetIds.size === 0 || !bulkEditHasChanges) return;
    setBulkUpdating(true);
    try {
      // Only the fields actually filled in are sent. The floor and building are
      // NOT sent: the server derives them from the work area, so they cannot end
      // up contradicting it.
      const changes: Parameters<typeof assetService.bulkUpdate>[1] = {};
      if (bulkMoveWorkareaId) changes.workarea_id = bulkMoveWorkareaId;
      if (bulkPerson.trim() !== '') changes.person_full_name = bulkPerson.trim();
      if (bulkClearPlacement) changes.clear_placement = true;

      const res = await assetService.bulkUpdate(Array.from(selectedAssetIds), changes);
      qc.invalidateQueries({ queryKey: assetKeys.all });
      // The server's message already states the counts and whether anything went
      // back to the tray; repeating it here risks the two disagreeing.
      if (res.skipped.length > 0) toast.warning(res.message ?? 'Applied with warnings');
      else toast.success(res.message ?? `${res.updated.length} asset(s) updated`);
      setSelectedAssetIds(new Set());
      setBulkMoveFloorId('');
      setBulkMoveWorkareaId('');
      setBulkPerson('');
      setBulkClearPlacement(false);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Bulk edit failed'));
    } finally {
      setBulkUpdating(false);
      setBulkMoveOpen(false);
      setBulkMoveFloorId('');
    }
  };

  // ── Persist filters + view state ────────────────────────────
  useEffect(() => { localStorage.setItem('db_search', searchQuery); }, [searchQuery]);

  /**
   * The search box is debounced into the query rather than into a second request:
   * `searchQuery` is what the box holds, `debouncedSearch` is what the server is asked
   * for, so typing doesn't fire a request per keystroke.
   */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => { localStorage.setItem('db_filters', JSON.stringify(filters)); }, [filters]);
  useEffect(() => {
    if (maintenanceFilter) localStorage.setItem('db_maint', maintenanceFilter);
    else localStorage.removeItem('db_maint');
  }, [maintenanceFilter]);
  useEffect(() => { localStorage.setItem('db_conflict', String(conflictFilter)); }, [conflictFilter]);
  useEffect(() => {
    if (quickStatusFilter) localStorage.setItem('db_qstatus', quickStatusFilter);
    else localStorage.removeItem('db_qstatus');
  }, [quickStatusFilter]);
  useEffect(() => {
    if (assignedToFilter) localStorage.setItem('db_assigned', assignedToFilter);
    else localStorage.removeItem('db_assigned');
  }, [assignedToFilter]);
  useEffect(() => { localStorage.setItem('db_view', viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem('db_sort', sortField); }, [sortField]);
  useEffect(() => { localStorage.setItem('db_sort_dir', sortDir); }, [sortDir]);
  useEffect(() => { localStorage.setItem('db_columns', JSON.stringify([...visibleColumns])); }, [visibleColumns]);

  // ── Sort ─────────────────────────────────────────────────────
  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
    setPage(1);
  };

  // ── Selection ─────────────────────────────────────────────────
  // The header checkbox is explicitly "this page": with the list paged, a checkbox
  // that silently meant "all 1054 matching" would be a bulk edit nobody asked for.
  // Everything matching is a separate, named action below.
  const allPageSelected = pageAssets.length > 0 && pageAssets.every(a => selectedAssetIds.has(a._id));
  const toggleSelectAllPage = () => {
    setSelectedAssetIds(prev => {
      const next = new Set(prev);
      if (allPageSelected) pageAssets.forEach(a => next.delete(a._id));
      else pageAssets.forEach(a => next.add(a._id));
      return next;
    });
  };

  const [selectingAll, setSelectingAll] = useState(false);
  /**
   * Select every asset the current filter matches, not just the loaded page. Asks the
   * server for the ids — the bulk edit takes ids, so this keeps it on the same audited
   * path, and it means selecting a thousand assets doesn't fetch a thousand rows.
   */
  const selectAllMatching = async () => {
    setSelectingAll(true);
    try {
      const { page: _p, limit: _l, sort: _s, dir: _d, ...filterOnly } = listQuery;
      setSelectedAssetIds(new Set(await assetService.getAssetIds(filterOnly)));
    } catch {
      toast.error('Could not select everything that matches');
    } finally {
      setSelectingAll(false);
    }
  };

  // ── Inline status change ─────────────────────────────────────
  const handleInlineStatusChange = async (assetId: string, status: string) => {
    try {
      await assetService.updateAsset(assetId, { 'basic_info.status': status } as any);
      // The table is a server page now, so there is no local list to patch:
      // invalidate and let the query refetch what the server actually holds.
      qc.invalidateQueries({ queryKey: assetKeys.all });
    } catch {
      toast.error('Failed to update status');
    }
  };

  const activeFilterCount = Object.keys(filters).filter(
    (k) => filters[k as keyof FilterCriteria] && k !== 'itsmManaged' && filters[k as keyof FilterCriteria] !== 'all'
  ).length;

  const conflictCount = assetStats?.itsm_conflicts ?? 0;

  const stats = {
    totalAssets: assetStats?.total ?? 0,
    itsmManaged: assetStats?.itsm_managed ?? 0,
    buildings: buildings.length,
    floors: floors.length,
    active: assetStats?.by_status?.active ?? 0,
    maintenance: assetStats?.by_status?.maintenance ?? 0,
  };

  /**
   * Names for the "assigned to" quick filter. From the persons endpoint rather than
   * scraped off the loaded list — that list is one page now, so it would only ever
   * offer the names that happen to be visible.
   */
  const personSuggestions = usePersonSuggestions();
  const assignedPersons = useMemo(
    () => personSuggestions.map((p) => p.full_name).sort(),
    [personSuggestions],
  );

  const maintenanceStats = {
    overdue: assetStats?.maintenance_overdue ?? 0,
    upcoming: assetStats?.maintenance_due_soon ?? 0,
  };

  const byType = Object.entries(assetStats?.by_type ?? {})
    .sort((a, b) => b[1] - a[1]).slice(0, 5);

  const byFloor = floors
    .map(f => ({
      floor: f,
      count: assetStats?.by_floor?.[f._id] ?? 0,
    }))
    .filter(f => f.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Loading state with skeletons
  if (isLoading) {
    return (
      <div className={styles.dashboard}>
        <div className={styles.header}>
          <div>
            <h1>Dashboard</h1>
            <p>Overview of your factory assets and locations</p>
          </div>
        </div>

        {/* Skeleton for stats cards */}
        <div className={styles.statsGrid}>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>

        {/* Skeleton for assets list */}
        <Card padding="lg">
          <ListSkeleton count={8} />
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={styles.dashboard}>
        <div className={styles.header}><div><h1>Dashboard</h1></div></div>
        <Card padding="lg">
          <div className={styles.emptyState}>
            <AlertTriangle size={32} style={{ color: 'var(--color-danger)' }} />
            <p>Failed to load dashboard data. Please try again.</p>
            <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: assetKeys.all })}>Retry</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <div>
          <h1>Dashboard</h1>
          <p>Overview of your factory assets and locations</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.exportGroup}>
            <span className={styles.exportLabel}>Export:</span>
            <Button variant="outline" onClick={handleExportCSV}>
              <Download size={15} style={{ marginRight: 6 }} />CSV
            </Button>
            <Button variant="outline" onClick={handleExportJSON}>
              <Download size={15} style={{ marginRight: 6 }} />JSON
            </Button>
            <Button variant="outline" onClick={handleExportPDF}>
              <FileText size={15} style={{ marginRight: 6 }} />PDF
            </Button>
          </div>
          <Button variant="outline" onClick={handleSyncAllFromItsm} loading={itsmSyncing}>
            <Upload size={15} style={{ marginRight: 6 }} />Sync All from ITSM
          </Button>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            + New Asset
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className={styles.statsGrid}>
        <Card padding="lg" className={styles.statCard}>
          <div className={styles.statIcon}><Monitor size={36} color="var(--color-primary)" /></div>
          <div className={styles.statContent}>
            <div className={styles.statValue}>{stats.totalAssets}</div>
            <div className={styles.statLabel}>Total Assets</div>
          </div>
        </Card>

        <button
          className={`${styles.statCard} ${styles.statCardBtn} ${quickStatusFilter === 'active' ? styles.statCardActive : ''}`}
          onClick={() => setQuickStatusFilter(f => f === 'active' ? null : 'active')}
          title="Click to filter active assets"
        >
          <div className={styles.statIcon}><Activity size={36} color="#10b981" /></div>
          <div className={styles.statContent}>
            <div className={styles.statValue}>{stats.active}</div>
            <div className={styles.statLabel}>Active</div>
          </div>
        </button>

        <button
          className={`${styles.statCard} ${styles.statCardBtn} ${quickStatusFilter === 'maintenance' ? styles.statCardActive : ''}`}
          onClick={() => setQuickStatusFilter(f => f === 'maintenance' ? null : 'maintenance')}
          title="Click to filter assets in maintenance"
        >
          <div className={styles.statIcon}><Wrench size={36} color="#f59e0b" /></div>
          <div className={styles.statContent}>
            <div className={styles.statValue}>{stats.maintenance}</div>
            <div className={styles.statLabel}>In Maintenance</div>
          </div>
        </button>

        <Card padding="lg" className={styles.statCard}>
          <div className={styles.statIcon}><Building2 size={36} color="var(--color-primary)" /></div>
          <div className={styles.statContent}>
            <div className={styles.statValue}>{stats.buildings}</div>
            <div className={styles.statLabel}>Buildings / {stats.floors} Floors</div>
          </div>
        </Card>

        <button
          className={`${styles.statCard} ${styles.statCardBtn} ${maintenanceStats.overdue > 0 ? styles.statCardDanger : ''} ${maintenanceFilter === 'overdue' ? styles.statCardActive : ''}`}
          onClick={() => setMaintenanceFilter(f => f === 'overdue' ? null : 'overdue')}
          title="Click to filter by overdue"
        >
          <div className={styles.statIcon}><AlertTriangle size={36} color={maintenanceStats.overdue > 0 ? '#dc2626' : '#9ca3af'} /></div>
          <div className={styles.statContent}>
            <div className={styles.statValue} style={{ color: maintenanceStats.overdue > 0 ? '#dc2626' : undefined }}>{maintenanceStats.overdue}</div>
            <div className={styles.statLabel}>Overdue Maintenance</div>
          </div>
        </button>

        <button
          className={`${styles.statCard} ${styles.statCardBtn} ${maintenanceFilter === 'upcoming' ? styles.statCardActive : ''}`}
          onClick={() => setMaintenanceFilter(f => f === 'upcoming' ? null : 'upcoming')}
          title="Click to filter by upcoming (30 days)"
        >
          <div className={styles.statIcon}><Bell size={36} color={maintenanceStats.upcoming > 0 ? '#d97706' : '#9ca3af'} /></div>
          <div className={styles.statContent}>
            <div className={styles.statValue} style={{ color: maintenanceStats.upcoming > 0 ? '#d97706' : undefined }}>{maintenanceStats.upcoming}</div>
            <div className={styles.statLabel}>Due in 30 days</div>
          </div>
        </button>
      </div>

      {/* Recent activity strip */}
      {recentActivity && recentActivity.data.length > 0 && (
        <div className={styles.activityStrip}>
          <span className={styles.activityTitle}>Recent activity</span>
          <div className={styles.activityList}>
            {recentActivity.data.map(entry => {
              const age = Date.now() - new Date(entry.timestamp).getTime();
              const ago = age < 60000 ? 'just now'
                : age < 3600000 ? `${Math.floor(age / 60000)}m ago`
                : age < 86400000 ? `${Math.floor(age / 3600000)}h ago`
                : `${Math.floor(age / 86400000)}d ago`;
              return (
                <span key={entry._id} className={styles.activityItem} title={new Date(entry.timestamp).toLocaleString()}>
                  <strong>{entry.username}</strong>
                  {' '}{entry.action}
                  {entry.entity_type !== 'auth' && <em> {entry.entity_type}</em>}
                  <span className={styles.activityAgo}>{ago}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ITSM sync result card */}
      {itsmSyncResult && (
        <div className={styles.itsmSyncResult}>
          <div className={styles.itsmSyncResultTitle}>
            <Upload size={14} /> Last sync result
            <button className={styles.itsmSyncResultClose} onClick={() => setItsmSyncResult(null)}>✕</button>
          </div>
          <div className={styles.itsmSyncResultStats}>
            <span className={styles.itsmSyncCreated}>+{itsmSyncResult.created} created</span>
            <span className={styles.itsmSyncUpdated}>↑{itsmSyncResult.updated} updated</span>
            <span
              className={`${styles.itsmSyncConflict} ${itsmSyncResult.snapshotted > 0 ? styles.itsmSyncConflictHot : ''}`}
            >
              ⚠ {itsmSyncResult.snapshotted} conflicts
            </span>
            {itsmSyncResult.errors > 0 && (
              <span className={styles.itsmSyncError}>✕ {itsmSyncResult.errors} errors</span>
            )}
          </div>
        </div>
      )}

      {/* ITSM conflict alert */}
      {conflictCount > 0 && (
        <button
          className={`${styles.conflictBar} ${conflictFilter ? styles.conflictBarActive : ''}`}
          onClick={() => setConflictFilter(f => !f)}
        >
          <AlertTriangle size={14} />
          {conflictCount} asset{conflictCount !== 1 ? 's' : ''} have pending ITSM changes
          {conflictFilter
            ? <span className={styles.filterClear}>✕ clear filter</span>
            : <span className={styles.filterClear}>click to filter</span>}
        </button>
      )}

      {/* Maintenance alert bar */}
      {(maintenanceStats.overdue > 0 || maintenanceStats.upcoming > 0) && (
        <div className={styles.maintenanceBar}>
          {maintenanceStats.overdue > 0 && (
            <button
              className={`${styles.maintenanceOverdue} ${maintenanceFilter === 'overdue' ? styles.maintenanceFilterActive : ''}`}
              onClick={() => setMaintenanceFilter(f => f === 'overdue' ? null : 'overdue')}
            >
              <AlertTriangle size={14} />
              {maintenanceStats.overdue} asset{maintenanceStats.overdue !== 1 ? 's' : ''} overdue for maintenance
              {maintenanceFilter === 'overdue' && <span className={styles.filterClear}>✕ clear</span>}
            </button>
          )}
          {maintenanceStats.upcoming > 0 && (
            <button
              className={`${styles.maintenanceUpcoming} ${maintenanceFilter === 'upcoming' ? styles.maintenanceFilterActive : ''}`}
              onClick={() => setMaintenanceFilter(f => f === 'upcoming' ? null : 'upcoming')}
            >
              <Bell size={14} />
              {maintenanceStats.upcoming} asset{maintenanceStats.upcoming !== 1 ? 's' : ''} due within 30 days
              {maintenanceFilter === 'upcoming' && <span className={styles.filterClear}>✕ clear</span>}
            </button>
          )}
        </div>
      )}

      {/* Breakdown rows */}
      {(byType.length > 0 || byFloor.length > 0) && (
        <div className={styles.breakdownGrid}>
          {byType.length > 0 && (
            <Card padding="lg">
              <h3 className={styles.breakdownTitle}>By Asset Type</h3>
              {byType.map(([type, count]) => (
                <div key={type} className={styles.breakdownRow}>
                  <span className={styles.breakdownLabel}>{getAssetIcon(type)} {type}</span>
                  <div className={styles.breakdownBar}>
                    <div
                      className={styles.breakdownFill}
                      style={{ width: `${(count / stats.totalAssets) * 100}%` }}
                    />
                  </div>
                  <span className={styles.breakdownCount}>{count}</span>
                </div>
              ))}
            </Card>
          )}

          {byFloor.length > 0 && (
            <Card padding="lg">
              <h3 className={styles.breakdownTitle}>By Floor</h3>
              {byFloor.map(({ floor, count }) => (
                <div key={floor._id} className={styles.breakdownRow}>
                  <span className={styles.breakdownLabel}>Floor {floor.floor_number} — {floor.name}</span>
                  <div className={styles.breakdownBar}>
                    <div
                      className={styles.breakdownFill}
                      style={{ width: `${(count / stats.totalAssets) * 100}%`, background: 'var(--color-primary)' }}
                    />
                  </div>
                  <span className={styles.breakdownCount}>{count}</span>
                </div>
              ))}
            </Card>
          )}

          {stats.totalAssets > 0 && (
            <Card padding="lg">
              <h3 className={styles.breakdownTitle}>By Status</h3>
              {([
                { key: 'active',      label: 'Active',      color: '#10b981' },
                { key: 'maintenance', label: 'Maintenance',  color: '#f59e0b' },
                { key: 'inactive',    label: 'Inactive',     color: '#6b7280' },
                { key: 'retired',     label: 'Retired',      color: '#ef4444' },
              ] as const).map(({ key, label, color }) => {
                const count = assetStats?.by_status?.[key] ?? 0;
                return (
                  <div key={key} className={styles.breakdownRow}>
                    <span className={styles.breakdownLabel}>{label}</span>
                    <div className={styles.breakdownBar}>
                      <div
                        className={styles.breakdownFill}
                        style={{ width: `${(count / stats.totalAssets) * 100}%`, background: color }}
                      />
                    </div>
                    <span className={styles.breakdownCount}>{count}</span>
                  </div>
                );
              })}
              <div className={styles.statusSegBar}>
                {(['active', 'maintenance', 'inactive', 'retired'] as const).map(key => {
                  const color = key === 'active' ? '#10b981' : key === 'maintenance' ? '#f59e0b' : key === 'inactive' ? '#6b7280' : '#ef4444';
                  const pct = ((assetStats?.by_status?.[key] ?? 0) / (stats.totalAssets || 1)) * 100;
                  return pct > 0 ? <div key={key} style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 0 }} title={`${key}: ${pct.toFixed(0)}%`} /> : null;
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Search and Filters */}
      <Card padding="lg">
        <div className={styles.searchSection}>
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search assets by name, tag, serial number..."
          />
          {assignedPersons.length > 0 && (
            <select
              className={styles.personSelect}
              value={assignedToFilter}
              onChange={e => setAssignedToFilter(e.target.value)}
            >
              <option value="">All assignees</option>
              {assignedPersons.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}
          <div className={styles.searchActions}>
            <Button
              variant={activeFilterCount > 0 ? 'primary' : 'outline'}
              onClick={() => setFilterOpen(true)}
            >
              <Filter size={15} style={{ marginRight: 6 }} />
              Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload size={15} style={{ marginRight: 6 }} />Import CSV
            </Button>
            <Button variant="outline" onClick={() => setReportsOpen(true)}>
              <BarChart2 size={15} style={{ marginRight: 6 }} />Reports
            </Button>
          </div>
        </div>

        {/* Assets List */}
        <div className={styles.assetsList}>
          <div className={styles.assetsHeader}>
            <div className={styles.assetsHeaderLeft}>
              <input
                type="checkbox"
                className={styles.selectAllCheck}
                checked={allPageSelected}
                onChange={toggleSelectAllPage}
                title="Select / deselect all on this page"
              />
              <h3>Assets ({matchingTotal})</h3>
              {/* The count is the whole matching set, not the page; and it comes from
                  the same query that produced the rows, so the two cannot disagree.
                  The old "N more not shown" warning is gone with the cap it described. */}
              {filterActive && (
                <span className={styles.listNote}>
                  of {assetStats?.total ?? '?'} · filtered
                </span>
              )}
              {isFetching && <span className={styles.listNote}>loading…</span>}
            </div>
            <div className={styles.assetsHeaderRight}>
              {viewMode === 'table' && (
                <div className={styles.columnsMenu} ref={columnsMenuRef}>
                  <button
                    className={styles.columnsBtn}
                    onClick={() => setColumnsMenuOpen(v => !v)}
                    title="Choose columns"
                  >
                    <Columns3 size={15} />
                    Columns
                  </button>
                  {columnsMenuOpen && (
                    <div className={styles.columnsDropdown}>
                      {COLUMN_DEFS.map(({ key, label }) => (
                        <button key={key} className={styles.columnsItem} onClick={() => toggleColumn(key)}>
                          <input type="checkbox" checked={visibleColumns.has(key)} readOnly />
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className={styles.viewToggle}>
                <button
                  className={`${styles.viewBtn} ${viewMode === 'card' ? styles.viewBtnActive : ''}`}
                  onClick={() => setViewMode('card')}
                  title="Card view"
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  className={`${styles.viewBtn} ${viewMode === 'table' ? styles.viewBtnActive : ''}`}
                  onClick={() => setViewMode('table')}
                  title="Table view"
                >
                  <List size={15} />
                </button>
              </div>
            </div>
            {selectedAssetIds.size > 0 && (
              <div className={styles.bulkBar}>
                <span className={styles.bulkCount}>{selectedAssetIds.size} selected</span>
                {selectedAssetIds.size < matchingTotal && (
                  <button
                    className={styles.bulkSelectAll}
                    onClick={selectAllMatching}
                    disabled={selectingAll}
                  >
                    {selectingAll ? 'Selecting…' : `Select all ${matchingTotal} matching`}
                  </button>
                )}
                {(['active', 'maintenance', 'inactive', 'retired'] as const).map(s => (
                  <button
                    key={s}
                    className={styles.bulkStatusBtn}
                    onClick={() => handleBulkStatusChange(s)}
                    disabled={bulkUpdating}
                  >
                    <span
                      className={styles.statusDot}
                      style={{
                        background:
                          s === 'active' ? '#10b981' :
                          s === 'maintenance' ? '#f59e0b' :
                          s === 'inactive' ? '#9ca3af' : '#ef4444',
                        marginRight: 4,
                      }}
                    />
                    {s}
                  </button>
                ))}
                <button
                  className={styles.bulkExportBtn}
                  onClick={async () => {
                    // Fetched by id: a selection can span pages, so its rows are not
                    // necessarily the ones on screen.
                    const selected = await assetService.getAssetsByIds([...selectedAssetIds]);
                    const rows = [
                      ['Name', 'Type', 'Status', 'Serial', 'IP Address', 'Assigned Person', 'Building', 'Floor', 'Next Maintenance'],
                      ...selected.map(a => [
                        a.basic_info?.display_name ?? '',
                        a.basic_info?.type ?? '',
                        a.basic_info?.status ?? '',
                        a.basic_info?.serial_number ?? '',
                        a.network?.ip_address ?? '',
                        a.assigned_person?.full_name ?? '',
                        buildings.find(b => b._id === a.hierarchy?.building_id)?.name ?? '',
                        floors.find(f => f._id === a.hierarchy?.floor_id)?.name ?? '',
                        a.maintenance?.next_date ? new Date(a.maintenance.next_date).toLocaleDateString() : '',
                      ]),
                    ];
                    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
                    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `selected-assets-${new Date().toISOString().slice(0, 10)}.csv`);
                    toast.success(`Exported ${selected.length} selected assets`);
                  }}
                  disabled={bulkUpdating}
                >
                  <Download size={13} style={{ marginRight: 3 }} />Export
                </button>
                <button
                  className={styles.bulkMoveBtn}
                  onClick={() => setBulkMoveOpen(o => !o)}
                  disabled={bulkUpdating}
                >
                  <MoveRight size={13} style={{ marginRight: 3 }} />Edit selected
                </button>
                <button
                  className={styles.bulkDeleteBtn}
                  onClick={() => setBulkDeleteConfirm(true)}
                  disabled={bulkUpdating}
                >
                  <Trash2 size={13} style={{ marginRight: 3 }} />Delete
                </button>
                <button
                  className={styles.bulkClearBtn}
                  onClick={() => setSelectedAssetIds(new Set())}
                >
                  ✕ Clear
                </button>
              </div>
            )}
            {bulkMoveOpen && (
              <div className={styles.bulkMovePanel}>
                {/* Floor first, then its rooms — the room is what the survey gets
                    wrong, and picking one derives the floor and building anyway. */}
                <select
                  className={styles.bulkMoveSelect}
                  value={bulkMoveFloorId}
                  onChange={e => { setBulkMoveFloorId(e.target.value); setBulkMoveWorkareaId(''); }}
                >
                  <option value="">Floor…</option>
                  {floors.map(f => (
                    <option key={f._id} value={f._id}>{f.name}</option>
                  ))}
                </select>
                <select
                  className={styles.bulkMoveSelect}
                  value={bulkMoveWorkareaId}
                  onChange={e => setBulkMoveWorkareaId(e.target.value)}
                  disabled={!bulkMoveFloorId}
                  title={bulkMoveFloorId ? 'Work area to move the selected assets into' : 'Pick a floor first'}
                >
                  <option value="">{bulkMoveFloorId ? 'Work area…' : 'Pick a floor first'}</option>
                  {workareas
                    .filter(w => w.floor_id === bulkMoveFloorId)
                    .map(w => (
                      <option key={w._id} value={w._id}>
                        {w.zone?.name ? `${w.name} (${w.zone.name})` : w.name}
                      </option>
                    ))}
                </select>
                <input
                  className={styles.bulkMoveSelect}
                  value={bulkPerson}
                  onChange={e => setBulkPerson(e.target.value)}
                  placeholder="Assign to person…"
                  title="Set the same person on every selected asset"
                />
                <label className={styles.bulkMoveCheck} title="Clear map coordinates so the assets return to the floor map's unplaced tray">
                  <input
                    type="checkbox"
                    checked={bulkClearPlacement}
                    onChange={e => setBulkClearPlacement(e.target.checked)}
                  />
                  Back to unplaced
                </label>
                <Button variant="primary" size="sm" onClick={handleBulkEdit} disabled={!bulkEditHasChanges || bulkUpdating} loading={bulkUpdating}>
                  Apply
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  setBulkMoveOpen(false);
                  setBulkMoveFloorId('');
                  setBulkMoveWorkareaId('');
                  setBulkPerson('');
                  setBulkClearPlacement(false);
                }}>
                  Cancel
                </Button>
              </div>
            )}
          </div>

          {pageAssets.length > 0 ? (
            <>
              {/* ── Card view ──────────────────────────────── */}
              {viewMode === 'card' && (
                <div className={styles.assetsGrid}>
                  {pageAssets.map((asset) => {
                    const isSelected = selectedAssetIds.has(asset._id);
                    return (
                      <div
                        key={asset._id}
                        className={`${styles.assetCard} ${isSelected ? styles.assetCardSelected : ''}`}
                        onClick={() => navigate(`/assets/${asset._id}`)}
                      >
                        <div className={styles.checkboxWrap} onClick={(e) => toggleAssetSelection(asset._id, e)}>
                          <input type="checkbox" className={styles.assetCheckbox} checked={isSelected} readOnly />
                        </div>
                        <div className={styles.assetIcon}>{getAssetIcon(asset.basic_info?.type)}</div>
                        <div className={styles.assetInfo}>
                          <h4>{asset.basic_info?.display_name}</h4>
                          <p>{asset.basic_info?.manufacturer} {asset.basic_info?.model}</p>
                          {asset.basic_info?.serial_number && (
                            <p className={styles.serialNumber}>S/N: {asset.basic_info.serial_number}</p>
                          )}
                        </div>
                        <div className={styles.cardBadges}>
                          {asset.maintenance?.next_date && (() => {
                            const t = new Date(asset.maintenance.next_date).getTime();
                            if (t < now) return <span className={styles.maintenanceBadgeOverdue} title={`Overdue since ${new Date(asset.maintenance.next_date).toLocaleDateString()}`}><AlertTriangle size={11} /> Overdue</span>;
                            if (t - now < sevenDays) return <span className={styles.maintenanceBadgeSoon} title={`Due ${new Date(asset.maintenance.next_date).toLocaleDateString()}`}><Bell size={11} /> Soon</span>;
                            return null;
                          })()}
                          <select
                            className={styles.inlineStatusSelect}
                            value={asset.basic_info?.status ?? ''}
                            onClick={e => e.stopPropagation()}
                            onChange={e => { e.stopPropagation(); handleInlineStatusChange(asset._id, e.target.value); }}
                          >
                            {['active', 'maintenance', 'inactive', 'retired'].map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          <Badge variant={asset.itsm?.is_managed ? 'success' : 'neutral'} size="sm">
                            {asset.itsm?.is_managed ? 'ITSM' : 'Manual'}
                          </Badge>
                          <button className={styles.quickViewBtn} title="Quick view" onClick={(e) => { e.stopPropagation(); setViewAsset(asset); }}>
                            <Eye size={14} />
                          </button>
                          {asset.is_placed && asset.hierarchy?.floor_id && (
                            <button
                              className={styles.quickViewBtn}
                              title="Show on map"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/map?building=${asset.hierarchy?.building_id}&floor=${asset.hierarchy?.floor_id}`);
                              }}
                            >
                              <Map size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Table view ─────────────────────────────── */}
              {viewMode === 'table' && (
                <div className={styles.tableWrapper}>
                  <table className={styles.assetTable}>
                    <thead>
                      <tr>
                        <th className={styles.thCheck}>
                          <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAllPage} />
                        </th>
                        <th key="name" className={styles.thSortable} onClick={() => handleSort('name')}>
                          Name
                          {sortField === 'name'
                            ? sortDir === 'asc' ? <ChevronUp size={12} style={{ marginLeft: 3 }} /> : <ChevronDown size={12} style={{ marginLeft: 3 }} />
                            : <ChevronsUpDown size={12} style={{ marginLeft: 3, opacity: 0.35 }} />}
                        </th>
                        {(['type', 'status', 'manufacturer'] as const).filter(k => visibleColumns.has(k)).map((key) => (
                          <th key={key} className={styles.thSortable} onClick={() => handleSort(key)}>
                            {COLUMN_DEFS.find(c => c.key === key)?.label}
                            {sortField === key
                              ? sortDir === 'asc' ? <ChevronUp size={12} style={{ marginLeft: 3 }} /> : <ChevronDown size={12} style={{ marginLeft: 3 }} />
                              : <ChevronsUpDown size={12} style={{ marginLeft: 3, opacity: 0.35 }} />}
                          </th>
                        ))}
                        {visibleColumns.has('ip_serial') && <th className={styles.th}>IP / Serial</th>}
                        {visibleColumns.has('location') && <th className={styles.th}>Location</th>}
                        {visibleColumns.has('maintenance') && (
                          <th className={`${styles.thSortable}`} onClick={() => handleSort('maintenance')}>
                            Next Maint.
                            {sortField === 'maintenance'
                              ? sortDir === 'asc' ? <ChevronUp size={12} style={{ marginLeft: 3 }} /> : <ChevronDown size={12} style={{ marginLeft: 3 }} />
                              : <ChevronsUpDown size={12} style={{ marginLeft: 3, opacity: 0.35 }} />}
                          </th>
                        )}
                        <th className={styles.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageAssets.map((asset) => {
                        const isSelected = selectedAssetIds.has(asset._id);
                        const building = buildings.find(b => b._id === asset.hierarchy?.building_id);
                        const floor = floors.find(f => f._id === asset.hierarchy?.floor_id);
                        const nextMaint = asset.maintenance?.next_date ? new Date(asset.maintenance.next_date) : null;
                        const maintOverdue = nextMaint && nextMaint.getTime() < now;
                        return (
                          <tr
                            key={asset._id}
                            className={`${styles.tableRow} ${isSelected ? styles.tableRowSelected : ''}`}
                            onClick={() => navigate(`/assets/${asset._id}`)}
                          >
                            <td className={styles.tdCheck} onClick={e => { e.stopPropagation(); toggleAssetSelection(asset._id, e); }}>
                              <input type="checkbox" checked={isSelected} readOnly />
                            </td>
                            <td>
                              <div className={styles.tableName}>
                                <span className={styles.tableIcon}>{getAssetIcon(asset.basic_info?.type)}</span>
                                {asset.basic_info?.display_name}
                              </div>
                            </td>
                            {visibleColumns.has('type') && <td className={styles.tdMuted}>{asset.basic_info?.type ?? '—'}</td>}
                            {visibleColumns.has('status') && (
                              <td onClick={e => e.stopPropagation()}>
                                <select
                                  className={`${styles.inlineStatusSelect} ${styles[`status_${asset.basic_info?.status ?? 'unknown'}`]}`}
                                  value={asset.basic_info?.status ?? ''}
                                  onChange={e => handleInlineStatusChange(asset._id, e.target.value)}
                                >
                                  {['active', 'maintenance', 'inactive', 'retired'].map(s => (
                                    <option key={s} value={s}>{s}</option>
                                  ))}
                                </select>
                              </td>
                            )}
                            {visibleColumns.has('manufacturer') && (
                              <td className={styles.tdMuted}>{[asset.basic_info?.manufacturer, asset.basic_info?.model].filter(Boolean).join(' ') || '—'}</td>
                            )}
                            {visibleColumns.has('ip_serial') && (
                              <td className={styles.tdMono}>{asset.network?.ip_address || asset.basic_info?.serial_number || '—'}</td>
                            )}
                            {visibleColumns.has('location') && (
                              <td className={styles.tdMuted}>{[building?.name, floor?.name].filter(Boolean).join(' · ') || '—'}</td>
                            )}
                            {visibleColumns.has('maintenance') && (
                              <td className={maintOverdue ? styles.tdOverdue : styles.tdMuted}>
                                {nextMaint ? nextMaint.toLocaleDateString() : '—'}
                              </td>
                            )}
                            <td className={styles.tdActions} onClick={e => e.stopPropagation()}>
                              <button className={styles.quickViewBtn} title="Quick view" onClick={() => setViewAsset(asset)}>
                                <Eye size={14} />
                              </button>
                              {asset.is_placed && asset.hierarchy?.floor_id && (
                                <button
                                  className={styles.quickViewBtn}
                                  title="Show on map"
                                  onClick={() => navigate(`/map?building=${asset.hierarchy?.building_id}&floor=${asset.hierarchy?.floor_id}`)}
                                >
                                  <Map size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Pagination ─────────────────────────────── */}
              {totalPages > 1 && (
                <div className={styles.pagination}>
                  <button className={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
                  <span className={styles.pageInfo}>Page {page} of {totalPages} · {matchingTotal} assets</span>
                  <div className={styles.pageJump}>
                    <span>Go to</span>
                    <input
                      type="number"
                      className={styles.pageJumpInput}
                      min={1}
                      max={totalPages}
                      defaultValue={page}
                      key={page}
                      onBlur={e => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v)) setPage(Math.max(1, Math.min(totalPages, v)));
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const v = parseInt((e.target as HTMLInputElement).value, 10);
                          if (!isNaN(v)) setPage(Math.max(1, Math.min(totalPages, v)));
                        }
                      }}
                    />
                  </div>
                  <button className={styles.pageBtn} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next →</button>
                </div>
              )}
            </>
          ) : (
            <div className={styles.emptyState}>
              {/* Two different situations, and they used to read the same. */}
              {filterActive ? (
                <>
                  <p>No assets match the current search and filters.</p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchQuery('');
                      setFilters({ itsmManaged: 'all' });
                      setMaintenanceFilter(null);
                      setQuickStatusFilter(null);
                      setAssignedToFilter('');
                      setConflictFilter(false);
                    }}
                  >
                    Clear search and filters
                  </Button>
                </>
              ) : (
                <>
                  <p>No assets recorded yet.</p>
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>Add the first asset</Button>
                </>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Advanced Filter Modal */}
      <AdvancedFilter
        isOpen={filterOpen}
        onClose={() => setFilterOpen(false)}
        onApply={handleApplyFilters}
        currentFilters={filters}
        buildings={buildings}
        floors={floors}
        workareas={workareas}
      />

      <AssetReports isOpen={reportsOpen} onClose={() => setReportsOpen(false)} />

      <AssetImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => qc.invalidateQueries({ queryKey: assetKeys.all })}
      />

      <AssetDetailsModal
        asset={viewAsset}
        isOpen={!!viewAsset}
        onClose={() => setViewAsset(null)}
      />

      <AssetCreationWizard
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: assetKeys.all });
          toast.success('Asset created successfully');
        }}
      />

      <ConfirmDialog
        isOpen={bulkDeleteConfirm}
        onClose={() => setBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        title="Delete Selected Assets"
        message={`Permanently delete ${selectedAssetIds.size} asset${selectedAssetIds.size !== 1 ? 's' : ''}? This cannot be undone.`}
        confirmText="Delete All"
        loading={bulkUpdating}
      />
    </div>
  );
};

export default Dashboard;
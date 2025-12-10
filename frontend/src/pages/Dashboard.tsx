import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import SearchBar from '../components/common/SearchBar';
import AdvancedFilter, { FilterCriteria } from '../components/filter/AdvancedFilter';
import { assetService, Asset } from '../services/asset.service';
import { hierarchyService, Building } from '../services/hierarchy.service';
import { floorService, Floor } from '../services/floor.service';
import { workareaService, WorkArea } from '../services/workarea.service';
import styles from '../styles/pages/Dashboard.module.css';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filteredAssets, setFilteredAssets] = useState<Asset[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [workareas, setWorkareas] = useState<WorkArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterCriteria>({ itsmManaged: 'all' });

  const applyFilters = useCallback(() => {
    let filtered = [...assets];

    // Search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (asset) =>
          asset.basic_info.display_name.toLowerCase().includes(query) ||
          asset.basic_info.asset_tag?.toLowerCase().includes(query) ||
          asset.basic_info.serial_number?.toLowerCase().includes(query) ||
          asset.basic_info.manufacturer?.toLowerCase().includes(query) ||
          asset.basic_info.model?.toLowerCase().includes(query)
      );
    }

    // Advanced filters
    if (filters.assetName) {
      filtered = filtered.filter((a) =>
        a.basic_info.display_name.toLowerCase().includes(filters.assetName!.toLowerCase())
      );
    }

    if (filters.manufacturer) {
      filtered = filtered.filter((a) =>
        a.basic_info.manufacturer?.toLowerCase().includes(filters.manufacturer!.toLowerCase())
      );
    }

    if (filters.model) {
      filtered = filtered.filter((a) =>
        a.basic_info.model?.toLowerCase().includes(filters.model!.toLowerCase())
      );
    }

    if (filters.serialNumber) {
      filtered = filtered.filter((a) =>
        a.basic_info.serial_number?.toLowerCase().includes(filters.serialNumber!.toLowerCase())
      );
    }

    if (filters.assetTag) {
      filtered = filtered.filter((a) =>
        a.basic_info.asset_tag?.toLowerCase().includes(filters.assetTag!.toLowerCase())
      );
    }

    if (filters.assignedPerson) {
      filtered = filtered.filter((a) =>
        a.assigned_person?.full_name?.toLowerCase().includes(filters.assignedPerson!.toLowerCase())
      );
    }

    if (filters.status) {
      filtered = filtered.filter((a) =>
        a.basic_info.status?.toLowerCase().includes(filters.status!.toLowerCase())
      );
    }

    if (filters.itsmManaged && filters.itsmManaged !== 'all') {
      filtered = filtered.filter((a) =>
        filters.itsmManaged === 'itsm' ? a.itsm.is_managed : !a.itsm.is_managed
      );
    }

    if (filters.buildingId) {
      filtered = filtered.filter((a) => a.hierarchy.building_id === filters.buildingId);
    }

    if (filters.floorId) {
      filtered = filtered.filter((a) => a.hierarchy.floor_id === filters.floorId);
    }

    if (filters.workareaId) {
      filtered = filtered.filter((a) => a.hierarchy.workarea_id === filters.workareaId);
    }

    setFilteredAssets(filtered);
  }, [assets, searchQuery, filters]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [assetsData, buildingsData, floorsData, workareasData] = await Promise.all([
        assetService.getAssets(),
        hierarchyService.getBuildings(),
        floorService.getFloors(),
        workareaService.getWorkAreas(),
      ]);

      setAssets(assetsData);
      setBuildings(buildingsData);
      setFloors(floorsData);
      setWorkareas(workareasData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFilters = (newFilters: FilterCriteria) => {
    setFilters(newFilters);
  };

  const activeFilterCount = Object.keys(filters).filter(
    (k) => filters[k as keyof FilterCriteria] && k !== 'itsmManaged' && filters[k as keyof FilterCriteria] !== 'all'
  ).length;

  const stats = {
    totalAssets: assets.length,
    itsmManaged: assets.filter((a) => a.itsm.is_managed).length,
    buildings: buildings.length,
    floors: floors.length,
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading dashboard...</p>
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
      </div>

      {/* Stats Cards */}
      <div className={styles.statsGrid}>
        <Card padding="lg" className={styles.statCard}>
          <div className={styles.statIcon}>💻</div>
          <div className={styles.statContent}>
            <div className={styles.statValue}>{stats.totalAssets}</div>
            <div className={styles.statLabel}>Total Assets</div>
          </div>
        </Card>

        <Card padding="lg" className={styles.statCard}>
          <div className={styles.statIcon}>✅</div>
          <div className={styles.statContent}>
            <div className={styles.statValue}>{stats.itsmManaged}</div>
            <div className={styles.statLabel}>ITSM Managed</div>
          </div>
        </Card>

        <Card padding="lg" className={styles.statCard}>
          <div className={styles.statIcon}>🏢</div>
          <div className={styles.statContent}>
            <div className={styles.statValue}>{stats.buildings}</div>
            <div className={styles.statLabel}>Buildings</div>
          </div>
        </Card>

        <Card padding="lg" className={styles.statCard}>
          <div className={styles.statIcon}>📐</div>
          <div className={styles.statContent}>
            <div className={styles.statValue}>{stats.floors}</div>
            <div className={styles.statLabel}>Floors</div>
          </div>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card padding="lg">
        <div className={styles.searchSection}>
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search assets by name, tag, serial number..."
          />
          <Button
            variant={activeFilterCount > 0 ? 'primary' : 'outline'}
            onClick={() => setFilterOpen(true)}
          >
            🔍 Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
          </Button>
        </div>

        {/* Assets List */}
        <div className={styles.assetsList}>
          <div className={styles.assetsHeader}>
            <h3>Assets ({filteredAssets.length})</h3>
          </div>

          {filteredAssets.length > 0 ? (
            <div className={styles.assetsGrid}>
              {filteredAssets.map((asset) => (
                <div
                  key={asset._id}
                  className={styles.assetCard}
                  onClick={() => navigate(`/assets/${asset._id}`)}
                >
                  <div className={styles.assetIcon}>💻</div>
                  <div className={styles.assetInfo}>
                    <h4>{asset.basic_info.display_name}</h4>
                    <p>
                      {asset.basic_info.manufacturer} {asset.basic_info.model}
                    </p>
                    {asset.basic_info.serial_number && (
                      <p className={styles.serialNumber}>S/N: {asset.basic_info.serial_number}</p>
                    )}
                  </div>
                  <Badge variant={asset.itsm.is_managed ? 'success' : 'neutral'}>
                    {asset.itsm.is_managed ? 'ITSM' : 'Manual'}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <p>No assets found matching your criteria</p>
              <Button variant="outline" onClick={() => { setSearchQuery(''); setFilters({ itsmManaged: 'all' }); }}>
                Clear Filters
              </Button>
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
    </div>
  );
};

export default Dashboard;
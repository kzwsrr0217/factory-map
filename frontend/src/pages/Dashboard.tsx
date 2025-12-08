import React, { useEffect, useState, useMemo } from 'react';
import Card from '../components/common/Card';
import Badge from '../components/common/Badge';
import Table from '../components/common/Table';
import SearchBar from '../components/common/SearchBar';
import FilterButton from '../components/common/FilterButton';
import Select from '../components/common/Select';
import AssetDetailsModal from '../components/asset/AssetDetailsModal';
import { hierarchyService, Building } from '../services/hierarchy.service';
import { assetService, Asset } from '../services/asset.service';
import styles from '../styles/pages/Dashboard.module.css';

type FilterType = 'all' | 'itsm' | 'manual';

const Dashboard: React.FC = () => {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [selectedBuilding, setSelectedBuilding] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [buildingsData, assetsData] = await Promise.all([
        hierarchyService.getBuildings(),
        assetService.getAssets(),
      ]);
      setBuildings(buildingsData);
      setAssets(assetsData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filtered assets
  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          asset.basic_info.display_name.toLowerCase().includes(query) ||
          asset.basic_info.serial_number?.toLowerCase().includes(query) ||
          asset.basic_info.asset_tag?.toLowerCase().includes(query) ||
          asset.basic_info.model?.toLowerCase().includes(query) ||
          asset.assigned_person?.full_name.toLowerCase().includes(query);

        if (!matchesSearch) return false;
      }

      // Type filter
      if (filterType === 'itsm' && !asset.itsm.is_managed) return false;
      if (filterType === 'manual' && asset.itsm.is_managed) return false;

      // Building filter
      if (selectedBuilding && asset.hierarchy.building_id !== selectedBuilding) {
        return false;
      }

      return true;
    });
  }, [assets, searchQuery, filterType, selectedBuilding]);

  // Stats
  const stats = useMemo(() => {
    return {
      total: assets.length,
      itsm: assets.filter((a) => a.itsm.is_managed).length,
      manual: assets.filter((a) => !a.itsm.is_managed).length,
      assigned: assets.filter((a) => a.assigned_person).length,
    };
  }, [assets]);

  const handleRowClick = (asset: Asset) => {
    setSelectedAsset(asset);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedAsset(null);
  };

  const columns = [
    {
      key: 'basic_info',
      title: 'Asset Name',
      render: (_: any, record: Asset) => record.basic_info.display_name,
    },
    {
      key: 'basic_info.manufacturer',
      title: 'Manufacturer',
      render: (_: any, record: Asset) => record.basic_info.manufacturer || '-',
    },
    {
      key: 'basic_info.model',
      title: 'Model',
      render: (_: any, record: Asset) => record.basic_info.model || '-',
    },
    {
      key: 'itsm',
      title: 'ITSM Status',
      render: (_: any, record: Asset) => (
        <Badge variant={record.itsm.is_managed ? 'success' : 'neutral'}>
          {record.itsm.is_managed ? 'ITSM Managed' : 'Manual'}
        </Badge>
      ),
    },
    {
      key: 'assigned_person',
      title: 'Assigned To',
      render: (_: any, record: Asset) => record.assigned_person?.full_name || '-',
    },
  ];

  // Building options for select
  const buildingOptions = buildings.map((building) => ({
    value: building._id,
    label: building.name,
  }));

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <div>
          <h1>Dashboard</h1>
          <p className={styles.subtitle}>Overview of your factory assets</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className={styles.statsGrid}>
        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}>🏢</div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>Buildings</p>
              <p className={styles.statValue}>{buildings.length}</p>
            </div>
          </div>
        </Card>

        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}>📦</div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>Total Assets</p>
              <p className={styles.statValue}>{stats.total}</p>
            </div>
          </div>
        </Card>

        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}>✅</div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>ITSM Managed</p>
              <p className={styles.statValue}>{stats.itsm}</p>
            </div>
          </div>
        </Card>

        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}>👥</div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>Assigned</p>
              <p className={styles.statValue}>{stats.assigned}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters Section */}
      <Card padding="lg" className={styles.filtersCard}>
        <div className={styles.filtersRow}>
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search assets by name, serial, tag..."
          />

          <div className={styles.filterButtons}>
            <FilterButton
              label="All"
              active={filterType === 'all'}
              onClick={() => setFilterType('all')}
              count={stats.total}
            />
            <FilterButton
              label="ITSM Managed"
              active={filterType === 'itsm'}
              onClick={() => setFilterType('itsm')}
              count={stats.itsm}
            />
            <FilterButton
              label="Manual"
              active={filterType === 'manual'}
              onClick={() => setFilterType('manual')}
              count={stats.manual}
            />
          </div>

          <Select
            value={selectedBuilding}
            onChange={setSelectedBuilding}
            options={buildingOptions}
            placeholder="All Buildings"
          />
        </div>
      </Card>

      {/* Assets Table */}
      <Card padding="none" className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <h2>Assets</h2>
          <p className={styles.tableSubtitle}>
            Showing {filteredAssets.length} of {assets.length} assets
          </p>
        </div>
        <Table
          columns={columns}
          data={filteredAssets}
          loading={loading}
          onRowClick={handleRowClick}
        />
      </Card>

      {/* Asset Details Modal */}
      <AssetDetailsModal
        asset={selectedAsset}
        isOpen={modalOpen}
        onClose={handleCloseModal}
      />
    </div>
  );
};

export default Dashboard;
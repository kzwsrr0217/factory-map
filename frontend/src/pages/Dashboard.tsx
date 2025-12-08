import React, { useEffect, useState } from 'react';
import Card from '../components/common/Card';
import Badge from '../components/common/Badge';
import Table from '../components/common/Table';
import AssetDetailsModal from '../components/asset/AssetDetailsModal';
import { hierarchyService, Building } from '../services/hierarchy.service';
import { assetService, Asset } from '../services/asset.service';
import styles from '../styles/pages/Dashboard.module.css';

const Dashboard: React.FC = () => {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);  // ← ÚJ
  const [modalOpen, setModalOpen] = useState(false);  // ← ÚJ

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

  // ← ÚJ: Handle row click
  const handleRowClick = (asset: Asset) => {
    setSelectedAsset(asset);
    setModalOpen(true);
  };

  // ← ÚJ: Close modal
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

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <h1>Dashboard</h1>
        <p className={styles.subtitle}>Overview of your factory assets</p>
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
              <p className={styles.statValue}>{assets.length}</p>
            </div>
          </div>
        </Card>

        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}>✅</div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>ITSM Managed</p>
              <p className={styles.statValue}>
                {assets.filter((a) => a.itsm.is_managed).length}
              </p>
            </div>
          </div>
        </Card>

        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}>👥</div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>Assigned</p>
              <p className={styles.statValue}>
                {assets.filter((a) => a.assigned_person).length}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Assets Table */}
      <Card padding="none" className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <h2>Assets</h2>
        </div>
        <Table
          columns={columns}
          data={assets}
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
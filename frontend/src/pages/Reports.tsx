/**
 * Reports.tsx — Reports & Analytics page ("/reports").
 *
 * Thin wrapper that renders AssetReports in `inline` mode so the full report
 * content appears on the page rather than inside a modal overlay. The
 * `onClose` no-op is required by the AssetReports prop interface but unused
 * here since there is no modal to close.
 */
import React from 'react';
import AssetReports from '../components/asset/AssetReports';
import styles from '../styles/pages/Reports.module.css';

const Reports: React.FC = () => (
  <div className={styles.page}>
    <div className={styles.header}>
      <h1 className={styles.title}>Reports & Analytics</h1>
      <p className={styles.subtitle}>Comprehensive analytics and reporting for your factory assets</p>
    </div>
    <AssetReports isOpen={true} onClose={() => {}} inline />
  </div>
);

export default Reports;

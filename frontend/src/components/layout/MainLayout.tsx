import React, { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import styles from '../../styles/components/MainLayout.module.css';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const [sidebarOpen] = useState(true); // ← Töröld a setSidebarOpen-t

  return (
    <div className={styles.layout}>
      <Header />
      <div className={styles.container}>
        <Sidebar isOpen={sidebarOpen} />
        <main className={styles.main}>
          {children}
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
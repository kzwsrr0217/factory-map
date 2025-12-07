import React, { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import styles from '../../styles/components/MainLayout.module.css';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <div className={styles.layout}>
      <Header onMenuToggle={toggleSidebar} />
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
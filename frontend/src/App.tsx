import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import MainLayout from './components/layout/MainLayout';
import Dashboard from './pages/Dashboard';
import Buildings from './pages/Buildings';
import BuildingDetails from './pages/BuildingDetails';
import FloorDetails from './pages/FloorDetails';
import AssetDetails from './pages/AssetDetails';

function App() {
  return (
    <ThemeProvider>
      <Router>
        <MainLayout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/buildings" element={<Buildings />} />
            <Route path="/buildings/:id" element={<BuildingDetails />} />
            <Route path="/floors/:id" element={<FloorDetails />} />
            <Route path="/assets" element={<Dashboard />} />
            <Route path="/assets/:id" element={<AssetDetails />} />
            <Route path="/map" element={<div>Map View - Coming Soon</div>} />
            <Route path="/reports" element={<div>Reports - Coming Soon</div>} />
            <Route path="/settings" element={<div>Settings - Coming Soon</div>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </MainLayout>
      </Router>
    </ThemeProvider>
  );
}

export default App;
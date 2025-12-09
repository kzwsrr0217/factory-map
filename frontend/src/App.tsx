import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './components/layout/MainLayout';
import Dashboard from './pages/Dashboard';
import Buildings from './pages/Buildings';
import BuildingDetails from './pages/BuildingDetails';
import FloorDetails from './pages/FloorDetails';  // ← ÚJ
import AssetDetails from './pages/AssetDetails';

function App() {
  return (
    <Router>
      <MainLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/buildings" element={<Buildings />} />
          <Route path="/buildings/:id" element={<BuildingDetails />} />
          <Route path="/floors/:id" element={<FloorDetails />} />  {/* ← ÚJ */}
          <Route path="/assets" element={<Dashboard />} />
          <Route path="/assets/:id" element={<AssetDetails />} />
          <Route path="/map" element={<div>Map View - Coming Soon</div>} />
          <Route path="/reports" element={<div>Reports - Coming Soon</div>} />
          <Route path="/settings" element={<div>Settings - Coming Soon</div>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MainLayout>
    </Router>
  );
}

export default App;
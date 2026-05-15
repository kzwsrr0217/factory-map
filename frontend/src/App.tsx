/**
 * App.tsx — Root component and route configuration.
 *
 * Sets up the provider hierarchy that wraps the entire application:
 *   ErrorBoundary → ThemeProvider → AuthProvider → ToastProvider → Router
 *
 * All routes inside `/*` are protected by `ProtectedRoute` which redirects
 * unauthenticated users to `/login`. The `MainLayout` component wraps all
 * authenticated pages with the shared sidebar and header.
 *
 * Route map:
 *   /              → Dashboard
 *   /buildings     → Buildings list
 *   /buildings/:id → Building detail with floor list
 *   /floors/:id    → Floor detail with asset list
 *   /assets/:id    → Asset full-page detail view
 *   /map           → Interactive floor map view
 *   /reports       → Statistics and ITSM sync
 *   /settings      → App settings and password change
 *   /settings/users→ User management (admin only)
 *   /audit         → Audit log
 *   /unplaced      → Assets not yet on any floor map
 *   /alerts        → Maintenance alert configuration (admin)
 */
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import ErrorBoundary from './components/common/ErrorBoundary';
import ProtectedRoute from './components/common/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Buildings from './pages/Buildings';
import BuildingDetails from './pages/BuildingDetails';
import FloorDetails from './pages/FloorDetails';
import MapView from './pages/MapView';
import AssetDetails from './pages/AssetDetails';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import UserManagement from './pages/UserManagement';
import AuditLog from './pages/AuditLog';
import UnplacedAssets from './pages/UnplacedAssets';
import Alerts from './pages/Alerts';
import NetworkGraph from './pages/NetworkGraph';
import Maintenance from './pages/Maintenance';

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
          <Router>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/buildings" element={<Buildings />} />
                        <Route path="/buildings/:id" element={<BuildingDetails />} />
                        <Route path="/floors/:id" element={<FloorDetails />} />
                        <Route path="/assets/:id" element={<AssetDetails />} />
                        <Route path="/map" element={<MapView />} />
                        <Route path="/reports" element={<Reports />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/settings/users" element={<UserManagement />} />
                        <Route path="/audit" element={<AuditLog />} />
                        <Route path="/unplaced" element={<UnplacedAssets />} />
                        <Route path="/alerts" element={<Alerts />} />
                        <Route path="/network" element={<NetworkGraph />} />
                        <Route path="/maintenance" element={<Maintenance />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
                    </MainLayout>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </Router>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

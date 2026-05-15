/**
 * ProtectedRoute.tsx — Route guard for authenticated pages.
 *
 * Wraps any route that requires a logged-in user. If `isAuthenticated` is
 * false the visitor is redirected to `/login`. The current pathname is passed
 * as `state.from` so AuthContext can navigate back after a successful login.
 *
 * Usage:
 *   <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
 */
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

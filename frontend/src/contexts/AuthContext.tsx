/**
 * AuthContext.tsx — JWT authentication state and session management.
 *
 * Provides application-wide access to:
 *  - `user`: current authenticated user (id, username, role)
 *  - `token`: raw JWT string
 *  - `login(username, password)`: authenticates and stores the token
 *  - `logout()`: clears token and navigates to login
 *  - `isAuthenticated`, `isAdmin`, `isOperator`: derived role booleans
 *  - `passwordExpired`, `clearPasswordExpired`: password expiry warning state
 *
 * Token persistence: stored in `localStorage` under keys `authToken` / `authUser`
 * so the session survives page reloads.
 *
 * Auto-refresh strategy:
 *   On mount (or when the token changes), a timer is scheduled to call
 *   `POST /api/auth/refresh` at 75% of the token's remaining lifetime (or at
 *   least 60 seconds before expiry). This keeps the session alive for active
 *   users without requiring them to re-login every 8 hours.
 *   If the token has already expired when the context initialises, it is
 *   immediately cleared to force a re-login.
 *
 * The axios interceptor in `api.ts` also performs proactive refresh on each
 * request when the token is within 5 minutes of expiry (belt-and-suspenders).
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import api from '../services/api';

interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  password_changed_at?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (username: string, password: string) => Promise<{ passwordExpired: boolean }>;
  logout: () => void;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isOperator: boolean;
  passwordExpired: boolean;
  clearPasswordExpired: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'authToken';
const USER_KEY = 'authUser';

const getTokenExpiry = (tok: string): number | null => {
  try {
    const payload = JSON.parse(atob(tok.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem(USER_KEY);
    return stored ? JSON.parse(stored) : null;
  });
  const [passwordExpired, setPasswordExpired] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  };

  const applyToken = (newToken: string, newUser: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const doRefresh = useCallback(async (currentToken: string) => {
    try {
      const res = await api.post('/auth/refresh', null, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      const { token: newToken, password_expired } = res.data.data;
      const storedUser = localStorage.getItem(USER_KEY);
      const currentUser: AuthUser = storedUser ? JSON.parse(storedUser) : null;
      if (currentUser && newToken) {
        applyToken(newToken, currentUser);
        if (password_expired) setPasswordExpired(true);
      }
    } catch {
      // Refresh failed — let the expiry timer handle logout
    }
  }, []);

  // Schedule auto-refresh at 75% of token lifetime (sliding expiry)
  useEffect(() => {
    clearTimers();
    if (!token) return;

    const expiry = getTokenExpiry(token);
    if (!expiry) {
      setToken(null);
      setUser(null);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return;
    }

    const now = Date.now();
    const lifetime = expiry - now;

    if (lifetime <= 0) {
      setToken(null);
      setUser(null);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return;
    }

    // Refresh at 75% of remaining lifetime (but at least 60s before expiry)
    const refreshIn = Math.max(lifetime * 0.75, lifetime - 60_000);
    refreshTimerRef.current = setTimeout(() => {
      doRefresh(token);
    }, refreshIn);

    return () => clearTimers();
  }, [token, doRefresh]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post('/auth/login', { username, password });
    const { token: newToken, user: newUser, password_expired } = res.data.data;
    applyToken(newToken, newUser);
    if (password_expired) setPasswordExpired(true);
    return { passwordExpired: !!password_expired };
  }, []);

  const logout = useCallback(() => {
    clearTimers();
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setPasswordExpired(false);
  }, []);

  const clearPasswordExpired = useCallback(() => setPasswordExpired(false), []);

  return (
    <AuthContext.Provider value={{
      user,
      token,
      login,
      logout,
      isAuthenticated: !!token && !!user,
      isAdmin: user?.role === 'admin',
      isOperator: user?.role === 'admin' || user?.role === 'operator',
      passwordExpired,
      clearPasswordExpired,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

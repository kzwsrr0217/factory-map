/**
 * api.ts — Configured axios instance for all API calls.
 *
 * Base URL: `REACT_APP_API_URL` env var, defaulting to `http://localhost:4000/api`.
 *
 * Request interceptor:
 *   Attaches the `Authorization: Bearer <token>` header from localStorage on every
 *   request. If the token is within 5 minutes of expiry, proactively calls
 *   `POST /api/auth/refresh` before the request. Concurrent refresh attempts are
 *   deduplicated with a `refreshPromise` singleton — only one refresh call is
 *   in-flight at any time, and all concurrent requests wait for the same promise.
 *
 * Response interceptor:
 *   - 401 responses: clears localStorage and redirects to `/login`.
 *   - Network errors (no response): sets `error.isNetworkError = true` and dispatches
 *     a `factory-map:network-error` custom DOM event so the UI can show a
 *     "backend unreachable" warning.
 */
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Decode JWT expiry without a library — returns ms timestamp or 0 on failure
function getTokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

let refreshPromise: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  const res = await axios.post<{ success: boolean; data: { token: string } }>(
    `${API_BASE_URL}/auth/refresh`,
    {},
    { headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` } }
  );
  const token = res.data.data.token;
  localStorage.setItem('authToken', token);
  return token;
}

// Request interceptor — attach token; proactively refresh if expiring within 5 min
api.interceptors.request.use(
  async (config) => {
    let token = localStorage.getItem('authToken');
    if (token) {
      const expiry = getTokenExpiry(token);
      const fiveMinutes = 5 * 60 * 1000;
      if (expiry && expiry - Date.now() < fiveMinutes) {
        // Deduplicate concurrent refresh attempts
        if (!refreshPromise) {
          refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
        }
        try {
          token = await refreshPromise;
        } catch {
          // Refresh failed — let the request go with the old token;
          // the 401 interceptor will redirect to login
        }
      }
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — handle 401, surface network errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('authToken');
      localStorage.removeItem('authUser');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    // Network / server unreachable — attach a friendly flag for UI consumers
    if (!error.response) {
      error.isNetworkError = true;
      window.dispatchEvent(new CustomEvent('factory-map:network-error'));
    }

    return Promise.reject(error);
  }
);

export default api;

/**
 * index.tsx — React application entry point.
 *
 * Mounts the `<App />` component tree into the `#root` div defined in
 * public/index.html. React.StrictMode is enabled so double-invocations
 * surface side effects during development (no impact in production builds).
 * Global CSS is imported here so it is guaranteed to load before any
 * component-level styles.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/global.css';
import App from './App';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
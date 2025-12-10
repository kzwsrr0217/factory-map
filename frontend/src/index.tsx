import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/global.css';  // ← Globális CSS importálása
import App from './App';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
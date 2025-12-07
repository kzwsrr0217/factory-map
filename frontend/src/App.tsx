import React from 'react';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>🏭 Factory Map</h1>
        <p>Asset Management System</p>
        <div className="status-cards">
          <div className="status-card">
            <h3>Backend</h3>
            <p>Checking...</p>
          </div>
          <div className="status-card">
            <h3>Database</h3>
            <p>Checking...</p>
          </div>
          <div className="status-card">
            <h3>ITSM</h3>
            <p>Mock Mode</p>
          </div>
        </div>
      </header>
    </div>
  );
}

export default App;
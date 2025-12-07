# Factory Map

Asset management system with spatial visualization and ITSM integration.

## 🎯 Features

- **Hierarchical asset organization**: Buildings → Floors → Work Areas → Sections → Workstations → Assets
- **Interactive map visualization**: SVG-based floor plans with drag-and-drop asset placement
- **ITSM integration (READ-ONLY)**: Sync hardware, software, and person data from ITSM
- **Conflict detection**: Alerts when Factory Map and ITSM data differ
- **Role-based access control**: Admin, Manager, Editor, Viewer roles

## 🛠️ Tech Stack

- **Backend**: Node.js + Express + TypeScript + MongoDB
- **Frontend**: React + TypeScript + Leaflet.js
- **Containerization**: Docker + Docker Compose
- **Database**: MongoDB 7

## 📋 Prerequisites

- Docker Desktop installed
- Git
- Visual Studio Code (recommended)
- Node.js 18+ (for local development without Docker)

## 🚀 Quick Start

1. **Clone the repository**
```bash
   git clone https://github.com/YOUR_USERNAME/factory-map.git
   cd factory-map
```

2. **Setup environment variables**
```bash
   cp .env.example .env
   # Edit .env and change passwords and secrets!
```

3. **Start with Docker Compose**
```bash
   docker-compose up --build
```

4. **Access the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5000
   - Mock ITSM: http://localhost:5000/mock-itsm

## 📁 Project Structure
```
factory-map/
├── backend/          # Express API (TypeScript)
├── frontend/         # React UI (TypeScript)
├── scripts/          # Utility scripts
└── docker-compose.yml
```

## 🔒 ITSM Integration (READ-ONLY)

**IMPORTANT**: Factory Map **never writes** to ITSM. It only reads data.

- Hardware, Software, Person data is synced FROM ITSM
- If conflict detected: ITSM data overwrites Factory Map + user gets warning
- Sync interval: configurable in `.env` (default: 5 minutes)

## 🧪 Development

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm start
```

## 📝 License

Proprietary - Internal Use Only
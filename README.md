# Factory Map - Asset Management System

Modern, full-stack asset management solution for factory environments with ITSM integration, hierarchical location tracking, and interactive floor plans.

![Factory Map Dashboard](docs/screenshots/dashboard.png)

## 🚀 Features

### Core Functionality
- ✅ **Hierarchical Asset Management** - Buildings → Floors → Work Areas → Sections → Workstations
- ✅ **ITSM Integration** - Sync with external ITSM systems (ServiceNow, etc.)
- ✅ **Real-time Search & Filtering** - Find assets instantly
- ✅ **Interactive Floor Plans** - Visual asset positioning (SVG-based)
- ✅ **Complete CRUD Operations** - Create, Read, Update, Delete for all entities
- ✅ **Responsive Design** - Works on desktop, tablet, and mobile

### Technical Features
- 🔒 **Type-Safe** - Full TypeScript implementation (frontend + backend)
- 🏗️ **Adapter Pattern** - Flexible ITSM integration (mock/real)
- 🎨 **Design System** - Consistent UI with CSS custom properties
- 🐳 **Docker Compose** - Easy development setup
- 📦 **MongoDB** - Flexible NoSQL database
- ⚡ **Fast** - Optimized queries and efficient rendering

---

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
- [Development](#development)
- [Deployment](#deployment)
- [Contributing](#contributing)

---

## 🏁 Quick Start

### Prerequisites
- Docker Desktop installed
- Node.js 18+ (for local development)
- Git

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/kzwsrr0217/factory-map.git
cd factory-map

2. **Start with Docker Compose:**
```bashdocker-compose up

3. **Seed the database (first time only):**
```bashdocker-compose exec backend npm run seed

4. **Access the application:**
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:5000/api
- **MongoDB:** localhost:27017

### First Steps
1. Navigate to http://localhost:3000
2. Explore the **Dashboard** with pre-seeded data
3. Check **Buildings** → Click a building → See floors and assets
4. Try **Search & Filter** on the dashboard
5. Click an asset to see detailed information

---

## 🏛️ Architecture

### System Overview┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   React     │────▶│   Express   │────▶│   MongoDB   │
│  Frontend   │     │   Backend   │     │  Database   │
└─────────────┘     └─────────────┘     └─────────────┘
│
│ Adapter Pattern
▼
┌─────────────┐
│    ITSM     │
│  (Mock/Real)│
└─────────────┘

### Data Model HierarchyBuilding
└── Floor
└── WorkArea
└── Section
└── Workstation
└── Asset

### Key Design Patterns
- **Adapter Pattern** - ITSM integration abstraction
- **Repository Pattern** - Data access layer
- **Component Pattern** - Reusable UI components
- **Service Layer** - Business logic separation

---

## 🛠️ Tech Stack

### Frontend
- **React 18** - UI library
- **TypeScript** - Type safety
- **React Router** - Client-side routing
- **Axios** - HTTP client
- **CSS Modules** - Scoped styling

### Backend
- **Node.js** - JavaScript runtime
- **Express** - Web framework
- **TypeScript** - Type safety
- **MongoDB** - NoSQL database
- **Mongoose** - ODM

### DevOps
- **Docker** - Containerization
- **Docker Compose** - Multi-container orchestration
- **Nodemon** - Hot reload

---

## 📁 Project Structurefactory-map/
├── backend/
│   ├── src/
│   │   ├── adapters/       # ITSM adapters (mock/real)
│   │   ├── config/         # Configuration
│   │   ├── controllers/    # Route controllers
│   │   ├── models/         # MongoDB models
│   │   ├── routes/         # API routes
│   │   ├── scripts/        # Utility scripts (seed, etc.)
│   │   └── server.ts       # Entry point
│   ├── Dockerfile
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/     # React components
│   │   │   ├── common/     # Shared components
│   │   │   ├── layout/     # Layout components
│   │   │   ├── asset/      # Asset-specific
│   │   │   ├── building/   # Building-specific
│   │   │   └── floor/      # Floor-specific
│   │   ├── pages/          # Page components
│   │   ├── services/       # API services
│   │   ├── styles/         # CSS modules
│   │   ├── App.tsx
│   │   └── index.tsx
│   ├── Dockerfile
│   └── package.json
│
├── docker-compose.yml
└── README.md

---

## 📡 API Documentation

### Base URLhttp://localhost:5000/api

### Endpoints

#### BuildingsGET    /api/buildings          # List all buildings
GET    /api/buildings/:id      # Get building by ID
POST   /api/buildings          # Create building
PATCH  /api/buildings/:id      # Update building
DELETE /api/buildings/:id      # Delete building

#### FloorsGET    /api/floors                         # List all floors
GET    /api/floors?building_id=<id>       # Filter by building
GET    /api/floors/:id                    # Get floor by ID
POST   /api/floors                        # Create floor
PATCH  /api/floors/:id                    # Update floor
DELETE /api/floors/:id                    # Delete floor

#### AssetsGET    /api/assets             # List all assets
GET    /api/assets/:id         # Get asset by ID
POST   /api/assets             # Create asset
PATCH  /api/assets/:id         # Update asset
DELETE /api/assets/:id         # Delete asset
POST   /api/assets/:id/sync    # Sync from ITSM

#### Work Areas, Sections, Workstations
Similar CRUD patterns as above.

### Example Request

**Create Building:**
```bashcurl -X POST http://localhost:5000/api/buildings 
-H "Content-Type: application/json" 
-d '{
"name": "Factory Building C",
"address": "123 Industrial Ave",
"metadata": {
"total_area": 8000,
"construction_year": 2020
}
}'

---

## 💻 Development

### Local Development (without Docker)

#### Backend
```bashcd backend
npm install
npm run dev

#### Frontend
```bashcd frontend
npm install
npm start

#### MongoDB
```bashInstall MongoDB locally or use MongoDB Atlas
mongod --dbpath /path/to/data

### Environment Variables

**Backend (.env):**
```envPORT=5000
MONGODB_URI=mongodb://mongo:27017/factory_map
ITSM_MODE=mock
NODE_ENV=development

**Frontend (.env):**
```envREACT_APP_API_URL=http://localhost:5000/api

### Database Seeding

Seed with sample data:
```bashnpm run seed              # Inside backend container
or
docker-compose exec backend npm run seed

This creates:
- 2 Buildings
- 2 Floors per building
- 3 Work Areas
- 4 Sections
- 15 Workstations
- 3 Assets (2 ITSM managed, 1 manual)

---

## 🚀 Deployment

### Production Build

#### Frontend
```bashcd frontend
npm run build
Output: build/ directory

#### Backend
```bashcd backend
npm run build
Output: dist/ directory

### Docker Production
```bashBuild production images
docker-compose -f docker-compose.prod.yml buildStart production containers
docker-compose -f docker-compose.prod.yml up -d

### Environment Considerations
- Set `NODE_ENV=production`
- Use proper MongoDB credentials
- Enable HTTPS
- Configure CORS properly
- Set up monitoring/logging

---

## 🧪 Testing

### Run Tests
```bashBackend tests
cd backend
npm testFrontend tests
cd frontend
npm test

### Manual Testing Checklist
- [ ] Create building
- [ ] Add floors to building
- [ ] Create assets
- [ ] Search and filter assets
- [ ] Edit building/floor/asset
- [ ] Delete entities
- [ ] ITSM sync (if real adapter configured)
- [ ] Navigate between pages
- [ ] Responsive design on mobile

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style
- Use TypeScript strict mode
- Follow ESLint configuration
- Use meaningful variable names
- Write comments for complex logic
- Keep components small and focused

---

## 📝 License

This project is licensed under the MIT License - see LICENSE file for details.

---

## 🙏 Acknowledgments

- Built with React, Express, and MongoDB
- Icons from emoji (temporary - replace with icon library)
- Inspired by modern asset management systems

---

## 📞 Contact

- **Project Link:** https://github.com/kzwsrr0217/factory-map
- **Issues:** https://github.com/kzwsrr0217/factory-map/issues

---

## 📸 Screenshots

### Dashboard
![Dashboard](docs/screenshots/dashboard.png)

### Building Details
![Building Details](docs/screenshots/building-details.png)

### Asset Details
![Asset Details](docs/screenshots/asset-details.png)

---

## 🗺️ Roadmap

- [ ] **Map Component** - Interactive SVG floor plans
- [ ] **File Upload** - Upload floor plan images
- [ ] **Advanced Search** - Full-text search
- [ ] **Reporting** - Export data to Excel/PDF
- [ ] **User Authentication** - Login system
- [ ] **Real-time Updates** - WebSocket integration
- [ ] **Mobile App** - React Native version
- [ ] **QR Code Scanning** - Asset identification
- [ ] **Barcode Integration** - Asset tracking
- [ ] **Notifications** - Email/SMS alerts

---

**Made with ❤️ for efficient factory asset management**
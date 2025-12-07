# Factory Map

Asset management system with spatial visualization and ITSM integration.

## 🚀 Quick Start

1. **Clone and setup**
```bash
   git clone https://github.com/YOUR_USERNAME/factory-map.git
   cd factory-map
   cp .env.example .env
   # Edit .env with your settings
```

2. **Start with Docker Compose**
```bash
   docker-compose up --build
```

3. **Seed database with test data**
```bash
   npm run seed
   # OR
   docker-compose exec backend npm run seed
```

4. **Access the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5000
   - API Docs: http://localhost:5000/api

## 📝 Development Scripts

### Root level (requires package.json in root)
```bash
npm run dev              # Start all containers
npm run dev:build        # Rebuild and start
npm run down             # Stop all containers
npm run seed             # Seed database
npm run logs             # View all logs
npm run logs:backend     # View backend logs only
npm run logs:frontend    # View frontend logs only
```

### Backend
```bash
cd backend
npm run dev              # Development mode
npm run build            # Build TypeScript
npm run seed             # Seed database (local)
npm run lint             # Check code quality
```

### Frontend
```bash
cd frontend
npm start                # Development mode
npm run build            # Production build
```

## 🌱 Database Seeding

The seed script creates test data:
- 2 Buildings
- 2 Floors
- 3 Work Areas
- 4 Sections
- 15 Workstations
- 3 Assets (2 ITSM-managed, 1 manual)

**Run seed:**
```bash
# From project root (recommended)
npm run seed

# OR directly in Docker
docker-compose exec backend npm run seed

# OR locally (if MongoDB is accessible on localhost)
cd scripts
npm run seed
```

## 🔧 Troubleshooting

### MongoDB Connection Issues

**In Docker:**
- MongoDB hostname: `mongo`
- URI: `mongodb://mongo:27017/factorymap`

**Locally:**
- MongoDB hostname: `localhost`
- URI: `mongodb://localhost:27017/factorymap`

**If seed fails:**
```bash
# Check if MongoDB is running
docker-compose ps

# Restart MongoDB
docker-compose restart mongo

# View MongoDB logs
docker-compose logs mongo
```
# Factory Map - Architecture Documentation

## Overview

Factory Map is a full-stack TypeScript application designed for hierarchical asset management in factory environments with ITSM integration capabilities.

## System Architecture

### High-Level Architecture
```
┌──────────────────────────────────────────────────────────────┐
│                         Client Layer                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │  Browser   │  │   Mobile   │  │   Tablet   │             │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘             │
└────────┼───────────────┼───────────────┼────────────────────┘
         │               │               │
         └───────────────┴───────────────┘
                         │
         ┌───────────────▼────────────────┐
         │      React Frontend App         │
         │  (TypeScript + React Router)    │
         └───────────────┬────────────────┘
                         │ REST API
         ┌───────────────▼────────────────┐
         │    Express Backend API          │
         │     (TypeScript + Node.js)      │
         ├─────────────────────────────────┤
         │    Controllers & Routes         │
         │    Business Logic Layer         │
         │    ITSM Adapter Layer          │
         └───────────────┬────────────────┘
                         │
         ┌───────────────▼────────────────┐
         │        MongoDB Database         │
         │      (NoSQL Document Store)     │
         └─────────────────────────────────┘
```

### Component Diagram
```
Frontend Components
├── Layout
│   ├── Header (navigation, user info)
│   ├── Sidebar (menu, navigation)
│   └── MainLayout (wrapper)
├── Pages
│   ├── Dashboard (stats, search, assets list)
│   ├── Buildings (list, CRUD)
│   ├── BuildingDetails (floors, assets)
│   ├── FloorDetails (work areas, map)
│   └── AssetDetails (full info, ITSM)
└── Common Components
    ├── Button, Card, Badge, Modal
    ├── Input, Textarea, Select
    ├── Table, SearchBar, FilterButton
    └── ConfirmDialog

Backend Structure
├── Routes (API endpoints)
├── Controllers (request handlers)
├── Models (Mongoose schemas)
├── Adapters (ITSM integration)
└── Scripts (seed, utilities)
```

## Data Model

### Entity Relationships
```
Building (1) ──────< Floor (N)
                       │
                       └──────< WorkArea (N)
                                   │
                                   └──────< Section (N)
                                               │
                                               └──────< Workstation (N)
                                                           │
                                                           └──────< Asset (N)
```

### MongoDB Collections

#### Buildings
```typescript
{
  _id: ObjectId,
  name: string,
  address?: string,
  metadata?: {
    total_area?: number,
    construction_year?: number
  },
  created_at: Date,
  updated_at: Date
}
```

#### Assets
```typescript
{
  _id: ObjectId,
  hierarchy: {
    building_id: ObjectId,
    floor_id: ObjectId,
    workarea_id: ObjectId,
    section_id: ObjectId,
    workstation_id: ObjectId
  },
  itsm: {
    hardware_id: string | null,
    is_managed: boolean,
    last_synced: Date | null,
    sync_status: 'success' | 'failed' | 'never'
  },
  basic_info: {
    display_name: string,
    manufacturer?: string,
    model?: string,
    serial_number?: string,
    // ...
  },
  // ...
}
```

## Design Patterns

### 1. Adapter Pattern (ITSM Integration)

**Purpose:** Abstract ITSM system differences
```typescript
// Interface
interface ITSMAdapter {
  searchHardware(query: string): Promise<Hardware[]>;
  getHardwareDetails(id: string): Promise<HardwareDetails>;
  syncAsset(assetId: string): Promise<SyncResult>;
}

// Implementations
class MockITSMAdapter implements ITSMAdapter { /* ... */ }
class ServiceNowAdapter implements ITSMAdapter { /* ... */ }

// Usage
const adapter = getAdapter(config.itsm.mode);
```

### 2. Service Layer Pattern

**Purpose:** Separate business logic from routes
```typescript
// Service
export const hierarchyService = {
  getBuildings: () => api.get('/buildings'),
  createBuilding: (data) => api.post('/buildings', data),
  // ...
};

// Component
const buildings = await hierarchyService.getBuildings();
```

### 3. Component Composition

**Purpose:** Reusable UI components
```typescript
<Modal title="Delete Building">
  <ConfirmDialog
    message="Are you sure?"
    onConfirm={handleDelete}
  />
</Modal>
```

## API Design

### RESTful Principles

- Use HTTP methods semantically (GET, POST, PATCH, DELETE)
- Resource-based URLs
- Consistent response format
- Proper status codes

### Response Format
```typescript
// Success
{
  success: true,
  data: { /* ... */ }
}

// Error
{
  success: false,
  error: "Error message"
}
```

## State Management

### Frontend State
```typescript
// Component State (useState)
const [assets, setAssets] = useState<Asset[]>([]);

// URL State (React Router)
const { id } = useParams();

// Form State
const [formData, setFormData] = useState({ /* ... */ });
```

### Data Flow
```
User Action → Event Handler → API Call → Update State → Re-render
```

## Security Considerations

### Current Implementation
- Input validation (TypeScript types)
- MongoDB injection prevention (Mongoose)
- CORS configuration
- Environment variables for secrets

### Future Enhancements
- [ ] Authentication (JWT)
- [ ] Authorization (RBAC)
- [ ] API rate limiting
- [ ] Input sanitization
- [ ] HTTPS enforcement

## Performance Optimizations

### Implemented
- MongoDB indexing
- CSS modules (scoped styles)
- Lazy loading (React.lazy)
- Efficient re-renders (React.memo)

### Future
- [ ] Redis caching
- [ ] CDN for static assets
- [ ] Database query optimization
- [ ] Image compression
- [ ] Code splitting

## Scalability

### Horizontal Scaling
- Stateless backend (easy to replicate)
- MongoDB sharding support
- Load balancer ready

### Vertical Scaling
- Node.js cluster mode
- MongoDB replica sets
- Efficient queries

## Monitoring & Logging

### Current
- Console logging
- Docker logs

### Recommended
- Winston/Pino for structured logging
- Application Performance Monitoring (APM)
- Error tracking (Sentry)
- Health check endpoints

## Testing Strategy

### Unit Tests
- Components (Jest + React Testing Library)
- Services (Jest)
- Controllers (Jest + Supertest)

### Integration Tests
- API endpoints
- Database operations

### E2E Tests
- Critical user flows (Cypress/Playwright)

## Deployment Architecture

### Development
```
Docker Compose → Local containers
```

### Production (Recommended)
```
Frontend → Vercel/Netlify
Backend → AWS ECS / Google Cloud Run
Database → MongoDB Atlas
```

## Technology Decisions

### Why TypeScript?
- Type safety
- Better IDE support
- Fewer runtime errors
- Self-documenting code

### Why MongoDB?
- Flexible schema
- Easy to evolve
- Good for hierarchical data
- Horizontal scaling

### Why React?
- Component-based
- Large ecosystem
- Virtual DOM performance
- Wide adoption

### Why Docker?
- Consistent environments
- Easy setup
- Portable
- Production-ready

## Future Architectural Improvements

1. **Microservices** - Split backend into services
2. **Event-Driven** - WebSocket real-time updates
3. **GraphQL** - More flexible API
4. **Caching Layer** - Redis for performance
5. **Message Queue** - RabbitMQ for async tasks
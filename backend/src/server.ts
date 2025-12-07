import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import config from './config/config';
import { connectDatabase } from './config/database';
import routes from './routes';

// Initialize Express app
const app: Application = express();

// ==========================================
// MIDDLEWARE
// ==========================================

// Security headers
app.use(helmet());

// CORS
app.use(cors({
  origin: config.env === 'production' 
    ? ['https://your-production-domain.com'] 
    : ['http://localhost:3000'],
  credentials: true,
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
if (config.env === 'development') {
  app.use(morgan('dev'));
}

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: config.env,
    itsm_mode: config.itsm.mode,
  });
});

// ==========================================
// API ROUTES (will be added later)
// ==========================================

app.get('/api', (_req: Request, res: Response) => {
    res.json({
    message: 'Factory Map API',
    version: '1.0.0',
    itsm_mode: config.itsm.mode,
    endpoints: {
      health: '/health',
      api: '/api',
      buildings: '/api/buildings',
      itsm: '/api/itsm',
    },
  });
});

// Mount API routes
app.use('/api', routes);

// ==========================================
// ERROR HANDLING
// ==========================================

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
  });
});

// Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('❌ Error:', err);
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.env === 'development' ? err.message : 'Something went wrong',
  });
});

// ==========================================
// START SERVER
// ==========================================

const startServer = async () => {
  try {
    // Connect to database
    await connectDatabase();
    
    // Start listening
    app.listen(config.port, () => {
      console.log('\n🚀 ================================');
      console.log(`   Factory Map Backend Started`);
      console.log('   ================================');
      console.log(`   Environment: ${config.env}`);
      console.log(`   Port: ${config.port}`);
      console.log(`   URL: http://localhost:${config.port}`);
      console.log(`   Health: http://localhost:${config.port}/health`);
      console.log(`   ITSM Mode: ${config.itsm.mode}`);
      console.log('   ================================\n');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

export default app;
/**
 * server.ts — Application entry point.
 *
 * Bootstraps the Express HTTP server, attaches all middleware (security headers,
 * CORS, rate limiting, body parsing, request logging), mounts the API router,
 * initialises the Socket.io server for real-time asset events, connects to the
 * SQL Server database, and registers graceful shutdown handlers for SIGTERM/SIGINT.
 *
 * Cron jobs registered after DB connect:
 *   07:00 daily  — checkAndSend(): scan assets for upcoming/overdue maintenance
 *                  and work-item due dates; send email + Teams notifications.
 *   Top of hour  — checkScheduledAlerts(): fire any user-defined one-off alerts
 *                  whose scheduled_for timestamp has passed; mark them sent.
 *
 * The exported `io` instance is used by controllers to broadcast asset changes
 * (asset:created, asset:updated, asset:deleted) to all connected browser tabs.
 */
import 'reflect-metadata';
import http from 'http';
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import swaggerUi from 'swagger-ui-express';
import { Server as SocketServer } from 'socket.io';
import config from './config/config';
import { connectDatabase, AppDataSource } from './config/database';
import { loadRevokedSessions } from './middleware/auth.middleware';
import { swaggerSpec } from './config/swagger';
import { checkAndSend, checkScheduledAlerts } from './services/alert/AlertService';
import routes from './routes';

// Initialize Express app
const app: Application = express();
const httpServer = http.createServer(app);

// Socket.io — accessible to controllers via app.locals
export const io = new SocketServer(httpServer, {
  cors: {
    origin: config.corsOrigin || false,
    methods: ['GET', 'POST'],
  },
});

// ==========================================
// MIDDLEWARE
// ==========================================

// Security headers
app.use(helmet());

// Disable ETag for API responses to avoid stale 304 responses in dev
app.disable('etag');

// Trust the first reverse-proxy hop so X-Forwarded-For is correct for rate
// limiting and audit logs, but cannot be spoofed by the client directly.
app.set('trust proxy', 1);

// CORS — restricted to the configured origin in all environments
app.use(cors({
  origin: config.corsOrigin || false,
  credentials: true,
}));

// Prevent browser caching of API responses in development
app.use('/api', (_req, res, next) => {
  if (config.env !== 'production') {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

// Rate limiting — auth routes only (prevent brute-force)
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many login attempts — try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
}));

// Body parsing — 20 MB limit to support base64-encoded floor plan image uploads
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Logging
if (config.env === 'development') {
  app.use(morgan('dev'));
}

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ==========================================
// API ROUTES (will be added later)
// ==========================================

app.get('/api', (_req: Request, res: Response) => {
  res.json({
    message: 'Factory Map API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      docs: '/api/docs',
      buildings: '/api/buildings',
      assets: '/api/assets',
      itsm: '/api/itsm',
    },
  });
});

// Swagger — raw JSON spec at /api/docs.json, UI at /api/docs
app.get('/api/docs.json', (_req: Request, res: Response) => res.json(swaggerSpec));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Factory Map API Docs',
  swaggerUrl: '/api/docs.json',
}));

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
    await loadRevokedSessions();

    // Schedule daily maintenance alert check at 07:00 every day
    cron.schedule('0 7 * * *', async () => {
      console.log('⏰ Running scheduled maintenance alert check...');
      try {
        const result = await checkAndSend();
        console.log(`   Alerts: ${result.upcoming} upcoming, ${result.overdue} overdue, email=${result.emailSent}, teams=${result.teamsSent}`);
        if (result.errors.length) console.warn('   Alert errors:', result.errors);
      } catch (err) {
        console.error('❌ Alert scheduler error:', err);
      }
    });

    // Hourly cron — fire any user-defined scheduled alerts whose time has passed
    cron.schedule('0 * * * *', async () => {
      try {
        await checkScheduledAlerts();
      } catch (err) {
        console.error('❌ Scheduled alert check error:', err);
      }
    });

    // Start listening
    httpServer.listen(config.port, () => {
      console.log('\n🚀 ================================');
      console.log(`   Factory Map Backend Started`);
      console.log('   ================================');
      console.log(`   Environment: ${config.env}`);
      console.log(`   Port: ${config.port}`);
      console.log(`   URL: http://localhost:${config.port}`);
      console.log(`   Health: http://localhost:${config.port}/health`);
      console.log(`   API Docs: http://localhost:${config.port}/api/docs`);
      console.log(`   ITSM Mode: ${config.itsm.mode}`);
      console.log('   ================================\n');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server — skipped in test environment so Jest can import app without side effects
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

// Graceful shutdown — drain in-flight requests, then close DB
const shutdown = (signal: string) => {
  console.log(`\n⏹  ${signal} received — shutting down gracefully…`);
  httpServer.close(async () => {
    try {
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
      console.log('✅ SQL Server connection closed');
    } catch {
      // ignore close errors on the way out
    }
    process.exit(0);
  });
  // Force-exit after 10 s if requests don't drain
  setTimeout(() => {
    console.error('⚠️  Forced exit after timeout');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default app;
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface Config {
  env: string;
  port: number;
  mongodb: {
    uri: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  itsm: {
    mode: 'mock' | 'real';
    mockApiUrl: string;
    realApiUrl: string;
    apiKey: string;
    webUrl: string;
    syncInterval: number;
  };
}

const config: Config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.BACKEND_PORT || '5000', 10),
  
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/factorymap',
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiresIn: '24h',
  },
  
  itsm: {
    mode: (process.env.ITSM_MODE as 'mock' | 'real') || 'mock',
    mockApiUrl: process.env.ITSM_MOCK_API_URL || 'http://localhost:5000/mock-itsm',
    realApiUrl: process.env.ITSM_REAL_API_URL || '',
    apiKey: process.env.ITSM_API_KEY || '',
    webUrl: process.env.ITSM_WEB_URL || '',
    syncInterval: parseInt(process.env.ITSM_SYNC_INTERVAL || '300000', 10), // 5 min default
  },
};

// Validation
if (config.env === 'production' && config.jwt.secret === 'default-secret-change-in-production') {
  console.error('❌ FATAL: JWT_SECRET is not set in production!');
  process.exit(1);
}

if (config.itsm.mode === 'real' && !config.itsm.realApiUrl) {
  console.warn('⚠️  WARNING: ITSM_MODE is "real" but ITSM_REAL_API_URL is not set. Falling back to mock mode.');
  config.itsm.mode = 'mock';
}

export default config;
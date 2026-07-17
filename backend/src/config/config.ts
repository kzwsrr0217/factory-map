/**
 * config.ts — Central application configuration.
 *
 * Reads all environment variables (from .env via dotenv), validates critical
 * values, and exports a single typed `config` object consumed throughout the
 * backend. Keeping all env-var references here means the rest of the code
 * never calls `process.env` directly.
 *
 * Startup validations:
 *  - Exits with code 1 if JWT_SECRET is the default placeholder in production.
 *  - Falls back to mock ITSM mode if real mode is configured without a URL.
 */
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Parse the optional ITSM_COLUMN_MAP override (JSON) that maps canonical field
 * names to the Alemba view's column captions, e.g.
 *   {"serial_number":["Serial Number"],"status":["Status"]}
 * Lets a deployment retune the RealITSMAdapter mapping without a code change.
 */
function parseColumnMap(raw: string | undefined): Record<string, string[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string[]>;
    }
    console.warn('⚠️  ITSM_COLUMN_MAP is not a JSON object — ignoring.');
  } catch {
    console.warn('⚠️  ITSM_COLUMN_MAP is not valid JSON — ignoring.');
  }
  return {};
}

interface Config {
  env: string;
  port: number;
  corsOrigin: string;
  mssql: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    encrypt: boolean;
    trustServerCertificate: boolean;
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
    viewId: string;
    columnMap: Record<string, string[]>;
    syncInterval: number;
  };
  ldap: {
    enabled: boolean;
    url: string;
    bindDN: string;
    bindCredentials: string;
    searchBase: string;
    searchFilter: string;
    usernameAttribute: string;
    tlsEnabled: boolean;
    defaultRole: 'admin' | 'operator' | 'viewer';
  };
  azure: {
    enabled: boolean;
    tenantId: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
}

const config: Config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || process.env.BACKEND_PORT || '5000', 10),
  corsOrigin: process.env.CORS_ORIGIN || '',

  mssql: {
    host: process.env.MSSQL_HOST || 'localhost',
    port: parseInt(process.env.MSSQL_PORT || '1433', 10),
    username: process.env.MSSQL_USER || 'sa',
    password: process.env.MSSQL_PASSWORD || 'YourStrong@Passw0rd',
    database: process.env.MSSQL_DATABASE || 'factorymap',
    encrypt: process.env.MSSQL_ENCRYPT === 'true',
    trustServerCertificate: process.env.MSSQL_TRUST_CERT !== 'false',
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
    viewId: process.env.ITSM_VIEW_ID || '',
    columnMap: parseColumnMap(process.env.ITSM_COLUMN_MAP),
    syncInterval: parseInt(process.env.ITSM_SYNC_INTERVAL || '300000', 10),
  },
  ldap: {
    enabled: process.env.LDAP_ENABLED === 'true',
    url: process.env.LDAP_URL || 'ldap://localhost:389',
    bindDN: process.env.LDAP_BIND_DN || '',
    bindCredentials: process.env.LDAP_BIND_PASSWORD || '',
    searchBase: process.env.LDAP_SEARCH_BASE || 'dc=example,dc=com',
    searchFilter: process.env.LDAP_SEARCH_FILTER || '(sAMAccountName={{username}})',
    usernameAttribute: process.env.LDAP_USERNAME_ATTR || 'sAMAccountName',
    tlsEnabled: process.env.LDAP_TLS_ENABLED === 'true',
    defaultRole: (process.env.LDAP_DEFAULT_ROLE as 'admin' | 'operator' | 'viewer') || 'viewer',
  },
  azure: {
    enabled: process.env.AZURE_AD_ENABLED === 'true',
    tenantId: process.env.AZURE_AD_TENANT_ID || '',
    clientId: process.env.AZURE_AD_CLIENT_ID || '',
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET || '',
    redirectUri: process.env.AZURE_AD_REDIRECT_URI || 'http://localhost:3000/auth/callback',
  },
};

// Validation
if (config.env === 'production' && config.jwt.secret === 'default-secret-change-in-production') {
  console.error('❌ FATAL: JWT_SECRET is not set in production!');
  process.exit(1);
}

if (config.env === 'production' && !process.env.MSSQL_PASSWORD) {
  console.error('❌ FATAL: MSSQL_PASSWORD is not set in production!');
  process.exit(1);
}

if (config.env === 'production' && !process.env.CORS_ORIGIN) {
  console.error('❌ FATAL: CORS_ORIGIN is not set in production!');
  process.exit(1);
}

if (config.itsm.mode === 'real' && !config.itsm.realApiUrl) {
  console.warn('⚠️  WARNING: ITSM_MODE is "real" but ITSM_REAL_API_URL is not set. Falling back to mock mode.');
  config.itsm.mode = 'mock';
}

export default config;
// Set NODE_ENV to 'test' before any module (including server.ts) is imported.
// This prevents server.ts from calling startServer() and trying to bind the port.
process.env.NODE_ENV = 'test';

# Base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies.
# `strict-ssl false`: dev-only workaround for corporate TLS/SSL inspection —
# the container does not carry the corporate root CA, so npm cannot validate the
# re-signed registry cert. Scoped to the build; do NOT use for shipped images.
# Also pin a known-good npm (node:18-alpine's 10.8.2 crashes with
# "Exit handler never called!" here) and force dev deps in so `tsc` is present.
RUN npm config set strict-ssl false \
 && npm install -g npm@10.9.2 \
 && npm install --include=dev --no-audit --no-fund

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 5000

# Probe the port the app actually listens on ($PORT/$BACKEND_PORT, default 5000).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const p=process.env.PORT||process.env.BACKEND_PORT||5000;require('http').get('http://localhost:'+p+'/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start command (override in docker-compose for dev)
CMD ["npm", "start"]

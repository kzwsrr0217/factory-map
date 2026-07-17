# Base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies.
# `strict-ssl false`: dev-only workaround for corporate TLS/SSL inspection (the
# container lacks the corporate root CA). Scoped to the build; not for shipping.
# Pin a known-good npm to dodge node:18-alpine's npm 10.8.2 crash.
RUN npm config set strict-ssl false \
 && npm install -g npm@10.9.2 \
 && npm install --include=dev --no-audit --no-fund

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start command
CMD ["npm", "start"]



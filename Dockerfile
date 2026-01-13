# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application (Vite frontend + TypeScript backend)
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy other necessary files
COPY --from=builder /app/personas ./personas
COPY --from=builder /app/scenarios ./scenarios
COPY --from=builder /app/public ./public
COPY --from=builder /app/attached_assets ./attached_assets

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose port (Cloud Run uses 8080 by default)
EXPOSE 8080

# Start the application
CMD ["node", "dist/index.js"]

#!/bin/bash
echo "Running database schema migration..."
npx drizzle-kit push --force
echo "Building application..."
npm run build

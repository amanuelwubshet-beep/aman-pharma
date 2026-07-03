#!/usr/bin/env bash
set -e

echo "=== Aman Pharma - Starting Application ==="
echo ""

# Install backend dependencies if needed
if [ ! -d "backend/node_modules" ]; then
  echo "Installing backend dependencies..."
  cd backend && npm install && cd ..
fi

# Initialize database if not present
if [ ! -f "backend/store.db" ]; then
  echo "Initializing database..."
  cd backend && node init-db.js && cd ..
fi

# Start server
echo ""
echo "Starting server on http://localhost:3001"
echo "  Frontend: http://localhost:3001"
echo "  Store:    http://localhost:3001/store.html"
echo "  Admin:    http://localhost:3001/admin.html"
echo "  API:      http://localhost:3001/api"
echo ""
cd backend && node server.js

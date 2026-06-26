#!/usr/bin/env bash
# Production build script — run before deploying
set -e

echo "📦 Installing dependencies..."
pnpm install --no-frozen-lockfile

echo "⚛️  Building React frontend..."
pnpm --filter @workspace/investment-agent run build

echo "🔨 Building API server (includes frontend copy)..."
pnpm --filter @workspace/api-server run build

echo "🗄️  Pushing database schema..."
pnpm --filter @workspace/db run push

echo "✅ Production build complete!"
echo "▶  Start with: NODE_ENV=production node artifacts/api-server/dist/index.mjs"

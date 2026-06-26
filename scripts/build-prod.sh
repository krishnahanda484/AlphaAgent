#!/usr/bin/env bash
# Production build script — run before deploying
set -e

echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

echo "⚛️  Building React frontend..."
pnpm --filter @workspace/investment-agent run build

echo "📂 Copying frontend dist to API server public folder..."
mkdir -p artifacts/api-server/public
cp -r artifacts/investment-agent/dist/* artifacts/api-server/public/

echo "🔨 Building API server..."
pnpm --filter @workspace/api-server run build

echo "✅ Production build complete!"
echo "▶  Start with: NODE_ENV=production node artifacts/api-server/dist/index.mjs"

#!/usr/bin/env bash
set -euo pipefail
unset DATABASE_URL ADMIN_EMAIL ADMIN_PASSWORD
npm ci --include=dev
npm run build:api
cp -r backend/migrations dist/api/migrations
npm run build:web

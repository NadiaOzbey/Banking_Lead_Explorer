#!/usr/bin/env bash
set -euo pipefail
export NODE_ENV=production
export STATIC_DIR=dist/web
exec node dist/api/server.js

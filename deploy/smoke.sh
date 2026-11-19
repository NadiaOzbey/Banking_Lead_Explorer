#!/usr/bin/env bash
set -euo pipefail
: "${DEPLOY_SHA:?Set the commit SHA}"
: "${DEPLOY_URL:?Set the HTTPS origin}"
[[ "$DEPLOY_URL" == https://* ]]

for ((attempt=1; attempt<=12; attempt++)); do
  if health=$(curl --silent --fail --connect-timeout 5 --max-time 20 "${DEPLOY_URL%/}/api/health") &&
    jq -e --arg sha "$DEPLOY_SHA" '.status == "ok" and .commit == $sha' <<< "$health" >/dev/null 2>&1; then
    echo "HTTPS health verified for $DEPLOY_SHA"
    exit 0
  fi
  sleep 5
done
echo "Health endpoint did not confirm commit $DEPLOY_SHA" >&2
exit 1

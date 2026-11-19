#!/usr/bin/env bash
set -euo pipefail

: "${RENDER_API_KEY:?Set RENDER_API_KEY in the GitHub environment secrets}"
: "${RENDER_SERVICE_ID:?Set RENDER_SERVICE_ID in the GitHub environment variables}"
: "${DEPLOY_SHA:?Set the commit SHA}"
: "${DEPLOY_URL:?Set the HTTPS origin}"
[[ "$DEPLOY_URL" == https://* ]]
[[ "$RENDER_SERVICE_ID" =~ ^srv-[a-z0-9]+$ ]]
[[ "$DEPLOY_SHA" =~ ^[a-f0-9]{40}$ ]]

request() {
  curl --silent --show-error --fail --max-time 30 \
    -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" "$@"
}

deploys="https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys"
deploy_id=$(request --data "$(jq -nc --arg commit "$DEPLOY_SHA" '{commitId: $commit}')" "$deploys" | jq -er '.id')
for ((attempt=1; attempt<=90; attempt++)); do
  status=$(request "$deploys/$deploy_id" | jq -er '.status')
  case "$status" in
    live) exec bash deploy/smoke.sh ;;
    build_failed|update_failed|pre_deploy_failed|canceled|deactivated)
      echo "Render deployment ended with status $status" >&2
      exit 1 ;;
  esac
  sleep 10
done
echo 'Render deployment timed out' >&2
exit 1

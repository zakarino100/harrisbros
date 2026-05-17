#!/bin/bash
# Self-healing wrapper for Swell server.
# If the node process crashes, it restarts with exponential backoff.
# Replit should run this script instead of node directly.

BACKOFF=5
MAX_BACKOFF=60
CRASHES=0

cd /home/runner/workspace 2>/dev/null || cd "$(dirname "$0")"

while true; do
  echo "[swell-wrapper] Starting server (attempt $((CRASHES+1)))..."
  node dist/server/index.js
  EXIT=$?
  CRASHES=$((CRASHES+1))
  echo "[swell-wrapper] Server exited (code $EXIT). Restart #$CRASHES in ${BACKOFF}s..."
  sleep $BACKOFF
  BACKOFF=$(( BACKOFF * 2 > MAX_BACKOFF ? MAX_BACKOFF : BACKOFF * 2 ))
done

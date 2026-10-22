#!/usr/bin/env bash
# Ship server code to the VPS and rebuild only this app's container.
# Usage: VPS=root@186.240.148.169 scripts/deploy.sh
set -euo pipefail
VPS=${VPS:-root@186.240.148.169}
cd "$(dirname "$0")/.."
tar czf - --exclude=node_modules --exclude=data --exclude=test server deploy/docker-compose.yml \
  | ssh "$VPS" 'cd /opt/mamatee && tar xzf -'
ssh "$VPS" 'cd /opt/mamatee/deploy && docker compose -p mamatee up -d --build 2>&1 | tail -1'
for i in $(seq 20); do curl -sf https://foodagent.devomogo.tech/health && echo && exit 0; sleep 1; done
echo "health check failed" >&2; exit 1

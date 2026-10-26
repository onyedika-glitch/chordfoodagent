#!/usr/bin/env bash
# Live, readable view of what the tool server is doing; for demos and the recording.
# Usage: scripts/watch.sh   (Ctrl+C to stop)
VPS=${VPS:-root@186.240.148.169}
ssh "$VPS" 'docker logs -f --since 10s mamatee_mcp 2>&1' | python3 -u "$(dirname "$0")/watch_fmt.py"

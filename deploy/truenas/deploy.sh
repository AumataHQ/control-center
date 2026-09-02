#!/usr/bin/env bash
# Push the compose file to the TrueNAS stack directory and bring it up.
#
# Secrets live in the .env file on the host, written once by hand; this script
# never sends one. It refuses to run if that file is missing.
set -euo pipefail

host="${TRUENAS_SSH_HOST:-truenas}"
stack="${TRUENAS_STACK_DIR:-/mnt/Pool/apps/stacks/newsroom}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ssh "$host" "sudo -n test -f ${stack}/.env" || {
  echo "No ${stack}/.env on ${host}." >&2
  echo "Create it from deploy/truenas/.env.example and fill in the MinIO credentials." >&2
  exit 1
}

ssh "$host" "sudo -n mkdir -p ${stack}"
scp "${here}/compose.yaml" "${host}:/tmp/newsroom-compose.yaml"
ssh "$host" "sudo -n mv /tmp/newsroom-compose.yaml ${stack}/compose.yaml && sudo -n chmod 0644 ${stack}/compose.yaml"
ssh "$host" "cd ${stack} && sudo -n docker compose up -d --remove-orphans && sudo -n docker compose ps"

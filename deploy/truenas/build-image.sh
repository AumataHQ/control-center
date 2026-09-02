#!/usr/bin/env bash
# Build the Control Center image on the TrueNAS host from committed source.
#
# The build context is `git archive` of the current HEAD, streamed over SSH, so
# the image contains exactly what is committed — no stray local files, no
# credentials, and nothing that depends on this Mac's architecture.
set -euo pipefail

host="${TRUENAS_SSH_HOST:-truenas}"
ref="${1:-HEAD}"
sha="$(git rev-parse --short "$ref")"
# Untracked files are not in `git archive` either, so only tracked edits matter.
if [ -n "$(git status --porcelain --untracked-files=no)" ] && [ "$ref" = "HEAD" ]; then
  echo "Tracked files have uncommitted edits, which the image would not contain." >&2
  echo "Commit them first, or pass an explicit ref." >&2
  exit 1
fi

echo "Building control-center:${sha} on ${host} from ${ref}"
git archive --format=tar "$ref" \
  | ssh "$host" "sudo -n docker build -t control-center:${sha} -t control-center:local -"
echo
echo "Built control-center:${sha} (also tagged control-center:local)"

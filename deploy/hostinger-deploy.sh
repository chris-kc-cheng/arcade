#!/usr/bin/env bash
set -Eeuo pipefail

deploy_path=${1:?deploy path is required}
revision=${2:?revision is required}
caddy_network=${3:-caddy}
archive="/tmp/arcade-${revision}.tar.gz"
release_path="${deploy_path}/releases/${revision}"

if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid Git revision." >&2
  exit 2
fi

if [[ ! -f "$archive" ]]; then
  echo "Release archive not found: $archive" >&2
  exit 2
fi

if ! docker network inspect "$caddy_network" >/dev/null 2>&1; then
  echo "Docker network '$caddy_network' does not exist." >&2
  exit 2
fi

mkdir -p "$release_path"
tar -xzf "$archive" -C "$release_path"
rm -f "$archive"

cd "$release_path"
CADDY_NETWORK="$caddy_network" docker compose \
  --project-name arcade \
  -f compose.yaml \
  -f compose.prod.yaml \
  up -d --build --remove-orphans

container_id=$(CADDY_NETWORK="$caddy_network" docker compose \
  --project-name arcade \
  -f compose.yaml \
  -f compose.prod.yaml \
  ps -q arcade)

for _ in {1..30}; do
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
  if [[ "$health" == healthy ]]; then
    ln -sfn "$release_path/public" "${deploy_path}/current"
    find "${deploy_path}/releases" -mindepth 1 -maxdepth 1 -type d ! -path "$release_path" -printf '%T@ %p\n' \
      | sort -nr | tail -n +4 | cut -d' ' -f2- | xargs -r rm -rf
    echo "Deployed Arcade revision $revision."
    exit 0
  fi
  if [[ "$health" == unhealthy || "$health" == exited || "$health" == dead ]]; then
    break
  fi
  sleep 2
done

docker logs "$container_id" --tail 100 >&2 || true
echo "Arcade did not become healthy after deployment." >&2
exit 1

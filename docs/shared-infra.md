# Running Arcade on the shared platform

Arcade is one Node container (`arcade`, port 3000) behind the platform's single Caddy proxy. It has no database. The
optional login and the app switcher use two platform services: `https://auth.<domain>` (the browser asks it who you are)
and `https://apps.<domain>/app.json` (the server reads the list of apps). The route file lives in the **infrastructure
repository**; nothing here edits that repository.

## What changed

| Concern | Before | On the shared platform |
|---|---|---|
| Container | Compose project `arcade`, service `arcade`, joined the `CADDY_NETWORK` (default `caddy`) | Compose project `arcade-shared`, `container_name: arcade`, alias `arcade`, external network `platform-edge` (`compose.prod.yaml`) |
| Route | hand-written Caddyfile block `arcade.<domain> -> arcade:3000` on the old edge Caddy | `sites/arcade.caddy` in the infrastructure repo (same block, see below) |
| Login | none (players type a name) | still optional; the browser asks `auth.<domain>/me` and fills in the name |
| App switcher | `GET /api/apps` from `https://www.hedgies.cloud/app.json` | `GET /api/platform-apps` from `APPS_URL` (default `https://apps.hedgies.cloud/app.json`) |
| Deploy | GitHub Actions: test, build, SSH upload of the source, build on the server | **unchanged mechanism**, new network and project name (below) |

## The current deploy path (kept)

`.github/workflows/deploy-hostinger.yml` runs on every push to `main` (and manually), in the `production` environment:
`npm ci`, `npm test`, `npm run build`, `docker build` and `docker compose config --quiet` as validation, then it tars the
source, uploads it with `scp` to the VPS and pipes `deploy/hostinger-deploy.sh` over SSH. The script extracts the archive to
`/opt/arcade/releases/<sha>` (path from `HOSTINGER_DEPLOY_PATH`), builds the image **on the server**, starts it, waits for the
health check, points `/opt/arcade/current` at the release's `public/` folder and keeps the three newest other releases. It never
pushes or pulls an image from any registry, so nothing was changed in that respect. Same secrets: `HOSTINGER_HOST`,
`HOSTINGER_USER`, `HOSTINGER_SSH_KEY`, `HOSTINGER_KNOWN_HOSTS`, `HOSTINGER_SSH_PORT`, `HOSTINGER_DEPLOY_PATH`.

Changes to it in this branch:

- `compose.prod.yaml`: external network `platform-edge` (override the name with `PLATFORM_EDGE_NETWORK`), `container_name: arcade`,
  alias `arcade`, `restart: unless-stopped`, a health check, `APPS_URL`. Compose project name `arcade-shared`, so the new
  container can run **beside** the old one (project `arcade`) until the route is switched. A deploy of the old project name
  would have replaced the old container in place and taken the site down.
- `deploy/hostinger-deploy.sh`: guard that `platform-edge` exists (it fails before touching anything if the platform is not
  running), `docker compose config --quiet`, then `up -d --build --remove-orphans`. It reads `${HOSTINGER_DEPLOY_PATH}/.env` for
  optional settings when that file exists and never writes, changes or deletes it.
- Workflow: no `CADDY_NETWORK` any more (the secret can be deleted), plus a `docker compose config --quiet` validation step.
- `deploy/Caddyfile.example` is replaced by `deploy/arcade.caddy.example` (the platform route).

## The route (infrastructure repository)

`sites/arcade.caddy`:

```caddyfile
arcade.{$DOMAIN} {
	encode zstd gzip
	reverse_proxy arcade:3000
}
```

WebSockets work through `reverse_proxy` automatically (Arcade uses `ws://`/`wss://` on the same origin). Remove the `arcade`
block from the legacy Caddyfile in the same change, so the two proxies never both claim the hostname. Apply with
`docker compose exec proxy caddy reload --config /etc/caddy/Caddyfile`.

## First production cutover (in this order)

**Before you start:** the platform stack is up (proxy, auth, registry), the `platform-edge` network exists, and the old Arcade
is still serving `arcade.<domain>` through the old edge Caddy. Note the old container's name (it is the one in the Compose
project `arcade`, usually `arcade-arcade-1`):

```bash
docker ps --filter label=com.docker.compose.project=arcade --format '{{.Names}}  {{.Image}}  {{.Status}}'
docker network inspect platform-edge --format '{{.Name}}'
```

**(a) Merge: the new container starts beside the old one.** Merging the branch to `main` triggers the workflow. The new
container `arcade` starts on `platform-edge` only; nothing routes to it yet and the old site is untouched. Check on the VPS:

```bash
docker ps --filter name=^arcade$ --format '{{.Names}}  {{.Status}}'         # arcade  Up ... (healthy)
docker exec arcade wget -qO- http://127.0.0.1:3000/healthz                   # {"status":"ok"}
docker exec arcade wget -qO- http://127.0.0.1:3000/api/platform-apps | head -c 200
```

If the deploy job fails at the guard ("Docker network 'platform-edge' does not exist"), start the infrastructure first and
re-run the workflow; the old Arcade keeps running meanwhile. Optional settings (for example a different registry) go in
`/opt/arcade/.env` as `APPS_URL=...` (an empty value hides the app switcher) before the first deploy or followed by a re-run.

**(b) Switch the route (infrastructure repository).** Add `sites/arcade.caddy` (above), delete the `arcade` block from the
legacy Caddyfile, reload both proxies. Then verify through the public name:

```bash
curl -sI https://arcade.<domain>/healthz | head -n 1                         # HTTP/2 200
curl -s https://arcade.<domain>/api/platform-apps | head -c 200
```

In a browser, open two tabs on a game and check that they see each other (WebSocket through the new proxy), then check the
toolbar's **Log in** button: signing in should show your name and fill the player-name field. If it does not, look at the
browser console for the call to `https://auth.<domain>/me` (the auth service allows every `*.<domain>` origin).

**(c) Remove the old container, once (b) has been fine for a day or so.**

```bash
docker rm -f $(docker ps -aq --filter label=com.docker.compose.project=arcade)
docker image rm arcade:latest        # the old image tag; the new one is arcade:platform
```

Old release folders under `/opt/arcade/releases` rotate out by themselves.

**(d) Rollback.**

- *Before (c):* put the `arcade` block back into the legacy Caddyfile, remove `sites/arcade.caddy` from the infrastructure
  repository and reload both proxies. The old container still has its old network and name, so the old site is back
  immediately. The new container can stay running; it is harmless without a route.
- *After (c):* revert the branch's merge on `main` (or re-run the workflow from the last commit before it). The old
  `compose.prod.yaml` starts the project `arcade` again on the old network; then restore the legacy Caddy block. Arcade keeps
  no data (no database, in-memory rooms), so there is nothing to restore.
- *A bad release only* (route already switched): re-run the workflow from the previous good commit; the script replaces the
  container in place and the `current` link moves back to a release that is still on disk.

## What the platform does for the login

Arcade only reads `GET https://auth.<domain>/me` in the browser (with credentials) and offers the auth service's
`/login`, `/logout`, `/forgot-password` and the Google/Microsoft start links. It never verifies the cookie on its server and
never stores anything per user. The name is for display. Using the account to protect something (a leaderboard, a private
room) would need the WebSocket server to verify `sso_access` (RS256 against `auth.<domain>/.well-known/jwks.json`, with
`clients/python/sso_auth.py` as the reference); nothing in Arcade needs that today.

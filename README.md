# Arcade

## Gameplay showcase

| Drawing Board | Tank | Penalty Shootout |
| --- | --- | --- |
| <img src="public/screenshots/board.png" alt="Collaborative drawing board gameplay" width="320" height="180"> | <img src="public/screenshots/tank.png" alt="Tank arena gameplay" width="320" height="180"> | <img src="public/screenshots/penalty.png" alt="Penalty shootout gameplay" width="320" height="180"> |
| Collaborate on a shared live drawing canvas with chat. | Drive a first-person 3D tank arena with mouse-box controls. | Take alternating penalty kicks in a two-player shootout. |

| Line Fighter | Snake | Big-D |
| --- | --- | --- |
| <img src="public/screenshots/fighter.png" alt="Line Fighter gameplay" width="320" height="180"> | <img src="public/screenshots/snake.png" alt="Snake gameplay" width="320" height="180"> | <img src="public/screenshots/bigtwo.png" alt="Big-D gameplay" width="320" height="180"> |
| Fight a CPU or another player with stick-figure special moves. | Share one real-time Snake grid with every connected player. | Play a shared Big Two card game for one to four players. |

| Type/Off | Many Words | Quick Poll |
| --- | --- | --- |
| <img src="public/screenshots/typing.png" alt="Type/Off typing challenge screenshot" width="320" height="180"> | <img src="public/screenshots/wordle.png" alt="Many Words variable-length word game screenshot" width="320" height="180"> | <img src="public/screenshots/poll.png" alt="Quick Poll screenshot" width="320" height="180"> |
| Race head-to-head with karaoke-style feedback, three difficulties, and detailed results. | Play a private Wordle-style puzzle with two- through eight-letter words, including all 14,855 accepted five-letter Wordle guesses. | Create a live multiple-choice poll, share it by QR code, and reveal synchronized results. |

| Cube Lab |
| --- |
| <img src="public/screenshots/cube.png" alt="Cube Lab interactive cube solver screenshot" width="320" height="180"> |
| Click stickers to enter your cube, then follow synchronized 3D turns with pause, back, and next controls. [Open Cube Lab](/cube). |

<!-- screenshot-status:start -->
All ten previews are actual local app captures at 1920×1080, using synthetic test players. Every thumbnail is displayed at 320×180.
<!-- screenshot-status:end -->

A small real-time browser arcade with a collaborative drawing board, multiplayer tank arena, two-player penalty shootout, Line Fighter, Snake, Big-D, a typing challenge with solo and head-to-head modes, the solo variable-length Many Words game, and live shareable Quick Polls. Game state and presence live only in the Node.js process and reset whenever it restarts.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000> in multiple browser windows to try the real-time modes. Development mode watches the React client and Node server and reloads connected tabs automatically. Use `npm start` for a production build and server.

### Visual assets

Run `npm run screenshots:check` to verify all ten showcase assets and their uniform dimensions. On a machine that permits a local Chrome/Chromium browser, `npm run screenshots` captures the actual app with synthetic test players and updates the showcase to ten PNGs. See [capture requirements and scene details](docs/screenshot-capture.md).

The shared browser and install icons come from `public/icons/arcade.svg`. Run `python3 scripts/generate-icons.py` to regenerate them; see [icon source and output details](public/icons/README.md).

## How HTTPS and WebSockets work

HTTPS and WebSockets serve different purposes in this application:

- **HTTP/HTTPS** handles request-and-response traffic. The browser requests the HTML, CSS, JavaScript, and `/healthz`, and the server returns a response for each request.
- **WebSocket** creates one persistent, two-way connection after the page loads. The browser and server can then send game state, drawing strokes, chat messages, presence changes, and synchronized app switches immediately without polling or reloading the page.
- Local development uses `http://` plus `ws://`. Production uses encrypted `https://` plus `wss://`.

The browser selects the WebSocket protocol from the page protocol:

```js
const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${protocol}://${location.host}?room=tanks`);
```

In production, Caddy terminates HTTPS and forwards both ordinary HTTP requests and WebSocket upgrade requests to the Node container. Caddy handles the WebSocket upgrade automatically:

```text
Browser -- HTTPS/WSS --> Caddy -- HTTP/WS --> arcade:3000
```

`server.js` uses the native Node HTTP server for files and health checks and the `ws` package for WebSocket connections. The `room` query parameter routes a connection to the drawing board or a particular game. Authoritative multiplayer state stays in the Node process and is broadcast to connected clients. Each browser tab has its own session identity, so two tabs on the same computer are treated as two users. A disconnected player is retained for 10 seconds for reconnection; after that, returning creates a new player.

Because game state is currently held in memory, restarting the Node container resets the active boards and games. Run only one Arcade server instance unless a shared state and pub/sub service such as Redis is added.

### Run with Docker Compose

The default Compose configuration builds the development image, publishes the app only on localhost, mounts the source tree, and runs the frontend/server watchers:

```bash
docker compose up --build
```

Open <http://localhost:3000>. Compose automatically combines `compose.yaml` with `compose.override.yaml`, so edits made on the host are rebuilt or reloaded without rebuilding the image. The named volume keeps the container's Linux dependencies separate from host dependencies.

Stop it with:

```bash
docker compose down
```

## Deploy on Hostinger with Docker and Caddy

> This deployment requires a **Hostinger VPS** (or another plan with SSH and Docker access). Shared hosting cannot run this app because Arcade needs a persistent Node.js process and WebSocket connections.

The included multi-stage image builds the React application, removes development dependencies, runs as the unprivileged `node` user, and exposes a `/healthz` container health check.

1. Clone the repository on the VPS.
2. Confirm the external network used by Caddy exists. The default expected name is `caddy`:

   ```bash
   docker network inspect caddy
   ```

3. If your network has a different name, provide it when deploying:

   ```bash
   CADDY_NETWORK=your-caddy-network docker compose -f compose.yaml -f compose.prod.yaml up -d --build
   ```

   Otherwise run:

   ```bash
   docker compose -f compose.yaml -f compose.prod.yaml up -d --build
   ```

4. Add the following site to the Caddy container's configuration, replacing the hostname:

   ```caddyfile
   arcade.example.com {
       encode zstd gzip
       reverse_proxy arcade:3000
   }
   ```

5. Reload Caddy and verify the application:

   ```bash
   docker compose -f compose.yaml -f compose.prod.yaml ps
   docker compose -f compose.yaml -f compose.prod.yaml logs -f arcade
   ```

Caddy automatically proxies WebSocket upgrades. The Node port is exposed only to the shared Docker network and is not published on the VPS host.

Because state is in memory, run one Node.js instance for now. Multiple instances would need a shared pub/sub and state layer (such as Redis), which is a natural next step before scaling games horizontally.

### Continuous deployment from GitHub

The `Deploy production to Hostinger` GitHub Actions workflow targets the GitHub environment named `production`. It tests the app, builds the production Docker image, uploads an immutable source archive over SSH, and starts it with the production Compose configuration. It runs on pushes to `main` and can also be started manually from the Actions tab. Configure any required reviewers or deployment-branch restrictions under **Settings → Environments → production**.

Prepare the VPS once:

```bash
# Run as the SSH deployment user. Docker must already be installed.
docker network create caddy
sudo mkdir -p /opt/arcade/releases
sudo chown -R "$USER:$USER" /opt/arcade
```

Add these repository **Actions secrets** under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `HOSTINGER_HOST` | VPS hostname or IP address |
| `HOSTINGER_USER` | SSH user with permission to run Docker |
| `HOSTINGER_SSH_KEY` | Private key for that user (the full multi-line value) |
| `HOSTINGER_KNOWN_HOSTS` | Pinned host-key line from `ssh-keyscan -H your-vps-host` after verifying its fingerprint in Hostinger |
| `HOSTINGER_SSH_PORT` | SSH port; optional, defaults to `22` |
| `HOSTINGER_DEPLOY_PATH` | Release directory; optional, defaults to `/opt/arcade` |
| `CADDY_NETWORK` | External Docker network; optional, defaults to `caddy` |

Add the matching public key to `~/.ssh/authorized_keys` on the VPS. Keep the Caddy site configuration shown above in the Caddy deployment, and ensure both Caddy and Arcade use the same external network. Then push to `main`, or run **Deploy production to Hostinger** with `workflow_dispatch`.

Each deployment keeps the three most recent inactive releases under `HOSTINGER_DEPLOY_PATH/releases`, including the generated browser bundle at `public/react-app.js`. After the container health check succeeds, `HOSTINGER_DEPLOY_PATH/current` points to the active release's `public` directory, so `index.html` and `react-app.js` are directly available beneath `current`. Failed startups print the last container logs, and the workflow deliberately prevents concurrent production deployments.

## Cube Lab

Open `/cube`. Click the six face grids to cycle white, red, green, yellow, orange, and blue. Centers remain fixed; view each face from outside with white on top and green in front. Start computes a two-phase solution on a server worker, validates color counts and physical solvability, and animates each turn. Pause, Next, Back, Scramble, and Reset synchronize for everyone in the cube room. View rotation is local. State is held in memory. The browser uses dependency-free CSS 3D; `cubejs` is used only on the server.

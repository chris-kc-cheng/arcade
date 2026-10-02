# Doodle Together

A small real-time browser arcade with a collaborative drawing board, multiplayer tank arena, two-player penalty shootout, Line Fighter, and Snake. Game state and presence live only in the Node.js process and reset whenever it restarts.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000> in multiple browser windows to try the real-time modes. Development mode watches the React client and Node server and reloads connected tabs automatically. Use `npm start` for a production build and server.

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

### Local Docker development

The base Compose file is combined with the local override, which publishes port 3000, mounts the source tree, and runs the frontend/server watchers:

```bash
docker compose -f compose.yaml -f compose.local.yaml up --build
```

Stop it with:

```bash
docker compose -f compose.yaml -f compose.local.yaml down
```

## Deploy on Hostinger with Docker and Caddy

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

## Arcade games

## Gameplay showcase

| Drawing Board | Tank | Penalty Shootout |
| --- | --- | --- |
| ![Collaborative drawing board gameplay](public/screenshots/board.png) | ![Tank arena gameplay](public/screenshots/tank.png) | ![Penalty shootout gameplay](public/screenshots/penalty.png) |

| Line Fighter | Snake | Big-D |
| --- | --- | --- |
| ![Line Fighter gameplay](public/screenshots/fighter.png) | ![Snake gameplay](public/screenshots/snake.png) | ![Big-D gameplay](public/screenshots/bigtwo.png) |

- **Line Fighter** is available at `/fighter.html`. Move with **WASD**, punch with **J**, and kick with **K**. A solo visitor fights the computer; a second visitor immediately replaces it. Later visitors spectate and rotate into the next match in pairs.
- **Tank** is available at `/tank.html` with a nine-sector 3D arena, tactical map, and BZFlag-style mouse-box controls.
- **Penalty Shootout** is available at `/penalty.html` and follows a five-kicks-per-team format before sudden death.
- **Snake** is available at `/snake.html` as a retro single-player challenge against bot snakes.
- **Big-D** is available at `/bigtwo.html` for a shared 1–4 player Big Two card game.
- Each experience has in-app links to the others, and multiplayer state is synchronized by the Node.js WebSocket server.

### Big-D

**Big-D (Big Two)** is available at `/bigtwo.html` for one to four active players. The server deals and validates every play, restarts the game when an active player joins or leaves, keeps hands private, and uses zero-sum remaining-card scoring.

![Big-D live multiplayer card table](docs/screenshots/big-d.svg)

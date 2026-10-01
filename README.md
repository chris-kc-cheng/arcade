# Doodle Together

A small real-time browser arcade with a collaborative drawing board, multiplayer tank arena, and two-player penalty shootout. The shootout follows a five-kicks-per-team format before sudden death; arrivals after the first two players spectate the live match. Game state and presence live only in the Node.js process and reset whenever it restarts.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000> in multiple browser windows to try the real-time modes. Development mode watches the React client and Node server and reloads connected tabs automatically. Use `npm start` for a production build and server.

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

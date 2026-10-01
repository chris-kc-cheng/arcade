# Doodle Together

A deliberately small real-time collaborative drawing board. Visitors are assigned names like **User 1**, **User 2**, and see each other's strokes, cursors, tools, and online status instantly. Board history and presence live only in the Node.js process and reset whenever it restarts.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open <http://localhost:3000> in two browser windows to try collaboration. Set a different port with `PORT=8080 npm start`.

## Deploy on Hostinger

Use a Hostinger plan with **Node.js application support** (typically a VPS or a supported Web App/Node.js hosting plan):

1. Upload or clone this repository on the server.
2. Run `npm ci --omit=dev` in the project directory.
3. Configure the application entry point as `server.js`, the start command as `npm start`, and Node.js 18 or newer. Hostinger supplies `PORT`; the server reads it automatically.
4. Point your domain to the application and enable SSL. The browser automatically uses secure `wss://` WebSockets when the page is served over HTTPS.
5. If using a VPS, keep the process alive with PM2: `pm2 start server.js --name doodle-together && pm2 save`. Reverse-proxy the domain to port 3000 with WebSocket upgrade headers enabled.

For an Nginx proxy on a VPS, the relevant location block is:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

Because state is in memory, run one Node.js instance for now. Multiple instances would need a shared pub/sub and state layer (such as Redis), which is a natural next step before scaling games horizontally.

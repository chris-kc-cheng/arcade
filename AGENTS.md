# Arcade platform rules

- Every app is a shared, real-time experience served by `server.js`; use a dedicated WebSocket `room` query parameter and synchronize authoritative state through the server.
- Give every app an obvious route to the other apps so all visitors can agree on which experience to open.
- Multiplayer games must tolerate joins, disconnects, and reconnects without leaving stale players behind.
- The drawing board top bar always shows the number of currently connected users. Disconnected drawing users disappear from presence immediately; their reconnect record is released after the grace period, and clients discard their cursor state.
- Every game must provide a visible reset control. A reset is synchronized for all active participants and must not grant spectators control of the current match.
- Keep browser clients dependency-free and responsive, and preserve keyboard accessibility and useful ARIA labels.
- Validate all client messages at the server boundary and never trust client-owned scores, health, positions, or roles.
- Add or update automated tests for shared protocol validation and run `npm test` before committing.
- Whenever a new mini-game is added, generate an up-to-date screenshot of it, keep the screenshot in the repository, and add a visual showcase for the game to `README.md` in the same change.

# Arcade platform rules

- Every app is a shared, real-time experience served by `server.js`; use a dedicated WebSocket `room` query parameter and synchronize authoritative state through the server.
- Give every app an obvious route to the other apps so all visitors can agree on which experience to open.
- Multiplayer games must tolerate joins, disconnects, and reconnects without leaving stale players behind.
- Every game must provide a visible reset control. A reset is synchronized for all active participants and must not grant spectators control of the current match.
- Keep browser clients dependency-free and responsive, and preserve keyboard accessibility and useful ARIA labels.
- Validate all client messages at the server boundary and never trust client-owned scores, health, positions, or roles.
- Add or update automated tests for shared protocol validation and run `npm test` before committing.

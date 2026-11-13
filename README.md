# Arcade

## Gameplay showcase

| Drawing Board | Tank | Penalty Shootout |
| --- | --- | --- |
| <img src="public/screenshots/board.png" alt="Collaborative drawing board gameplay" width="320" height="180"> | <img src="public/screenshots/tank.png" alt="Tank arena gameplay" width="320" height="180"> | <img src="public/screenshots/penalty.png" alt="Penalty shootout gameplay" width="320" height="180"> |
| Collaborate on a shared live drawing canvas with chat. | Drive a first-person 3D tank arena with mouse-box controls. | World Cup style penalty shootout on a FIFA-accurate pitch, with an O/X tracker (O goal, X save). |

| Line Fighter | Snake | Big-D |
| --- | --- | --- |
| <img src="public/screenshots/fighter.png" alt="Line Fighter gameplay" width="320" height="180"> | <img src="public/screenshots/snake.png" alt="Snake gameplay" width="320" height="180"> | <img src="public/screenshots/bigtwo.png" alt="Big-D gameplay" width="320" height="180"> |
| Fight a CPU or another player with stick-figure special moves. | Share one real-time Snake grid with every connected player. | Play a shared Big Two card game for one to four players. |

| Type/Off | Many Words | Quick Poll |
| --- | --- | --- |
| <img src="public/screenshots/typing.png" alt="Type/Off typing challenge screenshot" width="320" height="180"> | <img src="public/screenshots/wordle.png" alt="Many Words variable-length word game screenshot" width="320" height="180"> | <img src="public/screenshots/poll.png" alt="Quick Poll screenshot" width="320" height="180"> |
| Race head-to-head with karaoke-style feedback, three difficulties, and detailed results. | Play a private Wordle-style puzzle with two- through eight-letter words, including all 14,855 accepted five-letter Wordle guesses. | Create a live multiple-choice poll, share it by QR code, and reveal synchronized results. |

| Cube Lab | Slush Rush | Typo Hunt |
| --- | --- | --- |
| <img src="public/screenshots/cube.png" alt="Cube Lab interactive cube solver screenshot" width="320" height="180"> | <img src="public/screenshots/slushy.png" alt="Slush Rush cartoon slushy dispenser gameplay" width="320" height="180"> | <img src="public/screenshots/typohunt.png" alt="Typo Hunt spelling and grammar race with a live ranking screenshot" width="320" height="180"> |
| Click stickers to enter your cube, then follow synchronized 3D turns with pause, back, and next controls. [Open Cube Lab](/cube). | Pour four fruity flavors into S–XL cups in a private 60-second shift. Fill the dome for a bonus, avoid spills, and chase the shared best score. [Play Slush Rush](/slushy). | A proofreading race: the whole room hunts the same spelling and grammar mistakes across five levels, with a live ranking. [Play Typo Hunt](/typohunt). |

| Twin Spot |
| --- |
| <img src="public/screenshots/twinspot.png" alt="Twin Spot two-card emoji matching game screenshot" width="320" height="180"> |
| A Spot-It style race: find the one emoji (or its word, on hard) that appears on both round cards, with a live ranking. [Play Twin Spot](/twinspot). |

| Flight Sim |
| --- |
| <img src="public/screenshots/flight.png" alt="Flight simulator: a small plane on final approach to Billy Bishop airport over 3D Toronto" width="320" height="180"> |
| Land a small plane at Billy Bishop airport from the west, over a 3D Toronto built from live OpenStreetMap data. [Fly it](/flight). |

<!-- screenshot-status:start -->
All fourteen previews are actual local app captures at 1920×1080, using synthetic test players. Every thumbnail is displayed at 320×180.
<!-- screenshot-status:end -->

A small real-time browser arcade with a collaborative drawing board, multiplayer tank arena, two-player penalty shootout, Line Fighter, Snake, Big-D, a typing challenge with solo and head-to-head modes, the solo variable-length Many Words game, live shareable Quick Polls, Cube Lab, the solo Slush Rush dispenser, the shared Typo Hunt proofreading game, the Twin Spot card-matching race, with an app switcher to the other Hedgies apps. Game state and presence live only in the Node.js process and reset whenever it restarts.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000> in multiple browser windows to try the real-time modes. Development mode watches the React client and Node server and reloads connected tabs automatically. Use `npm start` for a production build and server.

### Visual assets

Run `npm run screenshots:check` to verify all fourteen showcase assets and their uniform dimensions. On a machine that permits a local Chrome/Chromium browser, `npm run screenshots` captures the actual app with synthetic test players and updates the showcase to fourteen PNGs. See [capture requirements and scene details](docs/screenshot-capture.md).

A cute lime-green gecko unifies the toolbar logo, browser favicon and installed app icons. The original artwork is `public/icons/gecko-source.png`; `public/icons/arcade.svg` defines its evergreen icon background. Run `python3 scripts/generate-icons.py` (needs Inkscape) to regenerate them; see [icon source and output details](public/icons/README.md).

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

Because game state is currently held in memory, restarting the Node container resets the active boards and games. Each named arcade room has independent game state. Run only one Arcade server instance unless a shared state and pub/sub service such as Redis is added.

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

## Deploy on the shared platform (Hostinger VPS)

> This deployment requires a **Hostinger VPS** (or another host with SSH and Docker access). Shared hosting cannot run this app because Arcade needs a persistent Node.js process and WebSocket connections.

Arcade runs as one container (`arcade`, port 3000) on the platform's external Docker network `platform-edge`. The platform's single Caddy proxy routes `arcade.<domain>` to `arcade:3000` (WebSockets pass through automatically), and the optional login and the app list come from the platform (`auth.<domain>`, `apps.<domain>`). The route file lives in the **infrastructure repository**, not here; [`deploy/arcade.caddy.example`](deploy/arcade.caddy.example) is the file to copy. The full first-production cutover, with rollback, is in [docs/shared-infra.md](docs/shared-infra.md).

The multi-stage image builds the React application, removes development dependencies, runs as the unprivileged `node` user, and has a `/healthz` health check. `compose.prod.yaml` adds `container_name: arcade`, the network alias `arcade`, `restart: unless-stopped`, the health check and the optional `APPS_URL` setting; nothing is published on the host. `compose.yaml` and `compose.override.yaml` stay the local-development setup.

Because state is in memory, run one Node.js instance for now. Multiple instances would need a shared pub/sub and state layer (such as Redis), which is a natural next step before scaling games horizontally.

To start it by hand on the VPS (the platform network must already exist):

```bash
docker network inspect platform-edge
docker compose --project-name arcade-shared -f compose.yaml -f compose.prod.yaml up -d --build
docker compose --project-name arcade-shared -f compose.yaml -f compose.prod.yaml ps
```

### Continuous deployment from GitHub

The `Deploy production to Hostinger` GitHub Actions workflow targets the GitHub environment named `production`. On every push to `main` (or a manual run) it tests the app, builds the browser bundle, validates the production image and the production Compose file, uploads an immutable source archive over SSH, and `deploy/hostinger-deploy.sh` builds and starts the container **on the server** (no container registry is involved). The script first checks that the `platform-edge` network exists, then runs `docker compose config --quiet` and `up -d --build --remove-orphans` as the Compose project `arcade-shared`, and waits for the health check.

Prepare the VPS once:

```bash
# Run as the SSH deployment user. Docker must already be installed and the platform infrastructure running.
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

The former `CADDY_NETWORK` secret is no longer used and can be deleted. An optional settings file `${HOSTINGER_DEPLOY_PATH}/.env` (for example `APPS_URL=...`) is read by Compose when it exists and is never created, changed or deleted by a deploy.

Each deployment keeps the three most recent inactive releases under `HOSTINGER_DEPLOY_PATH/releases`, including the generated browser bundle at `public/react-app.js`. After the container health check succeeds, `HOSTINGER_DEPLOY_PATH/current` points to the active release's `public` directory.

## Cube Lab

Open `/cube`. Click the six face grids to cycle white, red, green, yellow, orange, and blue. Centers remain fixed; view each face from outside with white on top and green in front. Start computes a two-phase solution on a server worker, validates color counts and physical solvability, and animates each turn. Pause, Next, Back, Scramble, and Reset synchronize for everyone in the cube room. View rotation is local. State is held in memory. The browser uses dependency-free CSS 3D; `cubejs` is used only on the server.

## Slush Rush

Open `/slushy` for a private 60-second slushy shift. Hold keys **1–4** or the matching dispenser levers with mouse/touch; release at the rim to serve automatically. S, M, L and XL cups have different fill times and point values. Clear domed lids hold another 24%: extra slush earns bonus points, but exceeding the dome spills the cup and triggers a cloth cleanup. The clock pauses during cleaning. Serve 3, 7 and 12 cups to unlock two, three and four simultaneous cups. Reset starts only your shift. Only the best score is shared, calculated by the server, and retained until the Node process restarts. Disconnected shifts pause and can reconnect within the normal 10-second grace period.

## Flight simulator

Open `/flight`. The simulator fills the window below the top bar. You start in a small plane on a 3 degree final approach and try to land it. Pick the airport in the toolbar: **Toronto Billy Bishop** (default, from the west over Lake Ontario), **Hong Kong International** (from the west over the sea) or **Tokyo Haneda** (from the south over Tokyo Bay). The map is read from **OpenStreetMap**, and everything is drawn in 3D in your browser with plain WebGL (no libraries).

- **OpenStreetMap data.** The page asks the Overpass API for the airport (ICAO CYTZ, VHHH or RJTT: its name, elevation, runways, taxiways and aprons), roughly 17,000 buildings between the western approach and downtown, the lake or sea shore and islands, and open water (lakes, harbours, lagoons, rivers, reservoirs: anything OpenStreetMap marks as water is drawn blue) (Haneda's dense city is thinned to the 30,000 buildings nearest the airport). The airport position, the runway line and the landing direction all come from that data: the runway is OpenStreetMap way 5687568, whose true heading (about 071°) is runway 08 from the west. Buildings are extruded from their footprints using the `height` tag, else `building:levels` times 3.2 m, else a stable guess. Answers are cached in the browser (IndexedDB) for a week. If every Overpass server is unreachable, the page says so and falls back to a small bundled snapshot of the airport's runways with generated buildings; the repository screenshot is taken this way. Only a small © OpenStreetMap credit link stays on screen. Map data © OpenStreetMap contributors (ODbL).
- **More map as you fly.** The first region is read when you pick an airport. When you fly towards or past its edge, the next 3 km cells of OpenStreetMap (buildings, shore and water) are read automatically a couple at a time, ahead of the plane, and cells far behind are dropped again; the map in the corner says "Loading map…" while it works.
- **Map.** A 2D map in the top right corner (north up, zoom + / −) shows the land, water, runways, buildings, your plane as a yellow arrow and every other pilot's plane as a coloured arrow with their name (on the map's rim when off it).
- **Controls.** Like a real stick: **W / ↑ pushes forward and points the nose down; S / ↓ pulls back and points the nose up** (pull too far and the wing stalls). **A / ←** and **D / →** bank, **Q / E** rudder, **Shift / PgUp** and **Z / PgDn** (or the slider) set the throttle, **Space / B** brakes on the ground, **C** switches between chase and cockpit views, **R** respawns on final approach, **H** lists the keys. **F / V** lower and raise the flaps (0°, 10°, 20°, 30°). The plane is a Cessna 172: high wing with struts, fixed tricycle gear, 11 m span, and Cessna 172 numbers for the flight model (point mass); the stick sets the angle of attack and the plane can take off, fly and land.
- **Units.** Speed, altitude, climb rate and the distance to the runway are shown in aviation units and in metric (kt and km/h, ft and m, fpm and m/s, nm and km). The numbers update four times a second so they stay readable.
- **Flight modes.** The first drop-down in the toolbar picks the aircraft. **Cessna 172** is the realistic plane above. **Airbus A320** (in Cathay Pacific colours: a dark green tail with the brushwing strokes) is flown like the Cessna but with airliner numbers: 64 t, 122.6 m² wing, two engines, a 3° approach at about 148 knots with flaps 3, flaps UP/1/2/3/FULL on **F / V**, a takeoff roll of about 1.5 km, and a 37.6 m body with 35.8 m swept wings (the cockpit camera sits at the nose and the chase camera stays 55 m back). The vehicles are smooth 3D models rather than boxes (`public/flight-models.js`): fuselages are lofted through elliptical cross-sections, wings and tails are tapered, swept airfoils, engines and gear legs are tubes, canopies are ellipsoids, and normals are averaged so curved parts shade smoothly; there is also a fighter-style model for the jet. Vehicles are drawn at real size: the Cessna is 8.3 m long with an 11 m span, and the A320 is 37.6 m long, and the drone is a minimal grey FPV drone about 0.2 m across (a small body, four thin arms and motors, a camera, no prop guards) with four semi-transparent spinning rotors. Other pilots see the vehicle you fly (only its type is shared, as a label, with your position). **Jet** is a fighter-class aircraft (9.5 t, 27.9 m² wing, 78 kN of thrust and 130 kN with afterburner above 75% throttle) flown on real forces instead of on/off controls: thrust along the nose, drag (with wave drag near Mach 1 and an air brake on **Space / B**), and lift from the angle of attack, which stalls past about 23°. The stick ramps in and out, and a flight control computer turns it into an angle of attack between "hold the flight path" (stick released keeps a 1 g path) and a limit of 9 g (−3 g pushing forward), so you can pull a smooth 4 g turn or a full 9 g loop. Pitch and roll authority fall at low speed, the nose falls through below about 60 m/s, turns bleed speed, and air density thins thrust with height. The HUD shows G, Mach and AB (afterburner). Loops, barrel rolls and inverted flight all work, and it still crashes into buildings, water and the ground. The view is fixed to the jet like a pilot's: it starts in the cockpit and turns, rolls and loops with the aircraft, **C** switches to an outside view that is also fixed to it, and you can look around by dragging the view or with **J / L / I / K** (**Home** or a double-click looks straight ahead). **Drone** can't be damaged: **↑ / ↓** go up and down, **← / →** turn, **A / D** slide sideways, **W / S** fly forward and backward, **I / K** tilt the camera up and down, and there is no throttle (the slider is hidden): it stays exactly where it is when no key is pressed, and flies forward at about 72 km/h or backward at about 43 km/h only while W or S is held; buildings stop it and the ground holds it up. You can switch vehicle in mid-flight (the drop-down, or **M** to cycle): your position, heading, speed and throttle carry over, and a drone becoming a plane or jet is given flying speed and a little height. The choice is remembered, or use `?mode=jet` / `?mode=drone`.
- **Approach assist.** For the Cessna and the Airbus, within about 16 km of an airport and below 3,000 m, a panel at the left shows the phase of the approach (Cruise, Slow down, Approach, Final, Flare; Takeoff and Rollout on the ground; Departure when flying away) with the **suggested throttle, flaps and speed** next to the current values, green when they match. The throttle is worked out from the aircraft's own lift and drag as the thrust that holds the target speed on that path (a 3° glide, or 5.5° at London City). **Auto throttle** holds the target speed and **Auto flaps** steps to the suggested setting; both are off until you tick them, are remembered, pause for a few seconds when you use the throttle or flap controls yourself, and the panel is hidden away from airports, over the city, in the jet and the drone.
- **Any airport by code.** Type a 3 letter IATA code (YTZ, HKG, JFK, LHR) or a 4 letter ICAO code (CYTZ, KJFK, EGLL) in the box at the left of the toolbar and press Enter (the list suggests some). OpenStreetMap is asked for the aerodrome with that tag, and the game starts you on final approach to its **longest runway**, from the end that points into the usual wind: landing towards the west outside the tropics (westerlies) and towards the east within 30° of the equator (trade winds). The **full airport name** from OpenStreetMap, with its ICAO and IATA codes and the runway number, is shown at the top left. You can also type a **name** (Heathrow, Kennedy, Nice) and press Enter: the search uses Nominatim, OpenStreetMap's geocoder (one request a second, results cached), the codes are read from the matching OpenStreetMap elements, and a list shows each airport's name with its **ICAO / IATA codes** beside it and its city and country below (it also matches **cities and regions** (typing Osaka finds Kansai KIX and Itami ITM although their names have no Osaka: the text is geocoded as a place, then OpenStreetMap is asked for airports with an IATA code within 70 km of it, as well as for airports whose name, English name or alternative names contain the text; those near the place show their distance); a single match opens at once; a 4 letter word that is not a code, such as Nice, is searched as a name). An airport that does not exist (a code or name that matches nothing, a bad `?airport=` address or a bad saved code) never breaks the game: it shows a message and goes to the default, **Hong Kong International (VHHH)**, which is built in and works even offline. The last airport is remembered.
- **More places.** **London City** is landed from the east on the steep 5.5° approach over the Thames and the docks (rivers and docks come from OpenStreetMap water; a river that crosses the loaded area is closed between its two banks). **Hong Kong Victoria Harbour** is for sightseeing, a place and not an airport, so it has no code (type its name): it starts you level at 420 m over the sea west of Hong Kong Island, heading east into the harbour, with no runway and no assist. The Cessna's propeller turns with the throttle, and its wings and tail are joined to the body.
- **Autopilot.** Off by default: the **Auto pilot** checkbox in the assist panel at the left (or **P**), for any vehicle, anywhere. For the **Cessna and the Airbus at an airport it lands the plane on the runway you started on**: wherever you are, it flies to a point on the extended centreline (6.5 km out, 9 km for the Airbus), intercepts the centreline at an angle that shrinks with the error, lines up (`FINAL`) and flies the airport's glide path (3°, 5.5° at London City) by correcting the height error with the flight path angle, using the landing schedule's flaps, speed and throttle; in the last metres it flares (`FLARE`, sink rate falling with height, throttle idle), touches down, steers along the centreline with the rudder and brakes to a stop (`ROLLOUT`), then switches itself off. If it arrives high or off to the side it goes around and tries again. The last 4 km are flown in real time whatever the simulation speed. One button does it all: moving the stick yourself switches the autopilot off, as in a real aircraft. For the jet, the drone and places there is no landing: it holds the heading and altitude you had when you switched it on (**A / D** turn the heading target and **W / S** raise and lower the altitude target; for the drone ↑ ↓ and ← →). The HUD shows `AUTOLAND  FINAL  3.2 km to the runway` or `AUTOPILOT HDG … ALT …`. Climb and bank limits are what each aircraft can do (about 26° for the Cessna, 23° for the Airbus). It switches itself off on the ground, after a crash, on a respawn and when you switch vehicle. In the simulation tests both aircraft land from on final, from far away flying the wrong way and from overhead heading away, always softly (under 3.6 m/s), within 12 m of the centreline and stopped on the runway.
- **Night mode.** The **Night** button (or **N**, or `?night=1`) fades the day into night: a dark sky with stars, haze and ground, lit building windows (a procedural grid of windows, which average into a faint city glow in the distance), blinking red obstruction lights on towers of 100 m and more, and navigation lights, strobes and beacons on every aircraft (red left, green right, white tail; other pilots' too). **Airport lights come from what OpenStreetMap records**: its `aeroway=navigationaid` nodes (approach lights `als`, runway edge/centreline/threshold/touchdown-zone lights, taxiway centre and edge lights, the beacon, and PAPI / VASI), with the colour from `light:colour`. The approach lights on the centreline beyond 150 m flash in sequence towards the runway, the beacon alternates white and green, and the PAPI changes with your height: white above the slope, red below (two and two on the glide path, 3° or 5.5° at London City) and only from the approach side. Nothing is invented beyond the basic lights every lit runway has (edge lights, green threshold, red end, centreline on long runways) when OpenStreetMap lists no runway lights, unless the runway is tagged `lit=no`; taxiway lights only where tagged `lit=yes`. John F. Kennedy and London City have real light data; many small airports only get the basic runway lights.
- **Simulation speed.** Buttons or keys **1–6** run the simulation at **1×, 2×, 5×, 10×, 50× or 100×**, in small time steps so the flight stays accurate; the speed setting changes distance only: the plane covers that much more ground in the same time, while turning, pitching and rolling stay exactly as at 1×.
- **Crashes.** A hard or nose-first landing, a wing low, the lake, and any building are crashes, and three seconds later the same vehicle is put back in the same place and heading, higher up (at least 300 m, and above any building there), flying level; **R** or the button starts over on final approach instead.
- **Sharing.** Each pilot flies their own plane in the browser; **only the plane's position and attitude is sent to the server** (latitude, longitude, altitude, heading, pitch, roll and throttle, ten times a second). The server checks the numbers are valid, rate limits them and rejects impossible jumps (it allows the speed of a plane at 100×), then relays everyone's position, so pilots see each other's planes with name tags. Respawning removes your plane from others' view until it reports again, and a pilot who disconnects disappears at once. The top bar shows the number of pilots as for every game, and RESPAWN is the reset control.

## Penalty shootout

Open `/penalty`. Two players take alternating penalties: the taker picks a corner of the goal, the keeper picks a side to dive, and both choices are locked in before the kick is taken. A kick is a goal unless the keeper dived to the zone it was aimed at. Each side takes five kicks (the shoot-out ends early once one side can no longer be caught), and a tie goes to sudden death.

- **Real pitch.** The scene is drawn from true measurements in metres and projected through a camera behind the penalty mark, so the lines converge like a broadcast: goal 7.32 m wide and 2.44 m high, goal area 5.5 m from each post and 5.5 m deep, penalty area 16.5 m from each post and 16.5 m deep, penalty mark 11 m out on the line through the middle of the goal (22 cm across), and the penalty arc (the crescent) with a 9.15 m radius from the mark, drawn only outside the penalty area. Lines are 12 cm wide, the ball is 22 cm across, the keeper stands on the goal line, and the net has a sloping back. `test/penalty-scene.test.js` checks these numbers.
- **Shoot-out tracker.** A World Cup style scorebug lists both sides with one circle per kick: **O** for a goal and **X** for a save, with a pulsing circle for the kick about to be taken. After five kicks each, sudden death adds one circle at a time. A GOAL! or SAVED! banner appears when the ball arrives.
- **Controls.** Click a zone of the goal, or tab to it and press Enter or Space (each zone is a labelled button). The server still decides the result of every kick and the score.

## Typo Hunt

Open `/typohunt`. Everyone in the same arcade room races on the same passage: only the wrong version is shown (no original to compare), and the first player to click a mistake scores it. Mistakes are common spelling and grammar slips: misspellings such as *definately* or *recieve*, mixed-up words (*there/their*, *loose/lose*, *its/it's*), *could of*, *a/an*, and subject-verb agreement.

- **Five levels.** Level *n* hides *n* mistakes. Level 1 is one short sentence (45 s); level 5 is a six-sentence paragraph with five mistakes (2 min). Any player can pick the level, which restarts the round for the whole room.
- **1,500 questions, built without an LLM.** `lib/typohunt-bank.json` holds a fixed bank per level: **500** at level 1, **400** at level 2, **300** at level 3, **200** at level 4 and **100** at level 5. Questions are dealt in a shuffled order, so none repeats until a level's whole bank has been seen. They are produced by plain rules in `lib/typohunt.js`: clean sentences (about 500 short ones for level 1, expanded from slotted templates such as "It's too {adj} to {verb}"; and for levels 2 to 5, 30 short stories whose sentences are in time order and stay in one tense) get a few words swapped for a known wrong form from a table of about 180 patterns, each with its own explanation. They cover the errors English learners make most: spelling (including dropped double consonants), homophones, missing apostrophes, subject-verb agreement (*she like*, *the news are*), verb forms (*buyed*, *has ate*, *is play*), prepositions (*in Monday*, *good in math*, *since three years*), plurals and counting (*childrens*, *advices*, *much people*), *a/an*, pronoun case (*me went*), and word choice (*said me*, *do a cake*). Each swap is guarded so that it is certain to be wrong in place, and the bank builder prefers the least-used patterns so questions do not keep repeating the same few mistakes. A level 2 to 5 passage is always a run of 2, 3, 4 or 6 consecutive sentences from a single story with one protagonist name, and every sentence names its own subject (no stray "she" or "they" pointing back to a sentence that is not there), so the passage reads as one sensible piece of writing wherever the run starts. Regenerate the bank (it is seeded, so the output only changes when the tables or sentences change) with `node scripts/generate-typohunt-bank.js`. `test/typohunt.test.js` checks every question.
- **Compete live.** A correct find scores 100 plus 25 per level above the first plus a time bonus; a wrong click deducts 25 points and locks that player out for 1.5 seconds. A wrong click is not highlighted in the passage, and found words show the fix and the kind of mistake. The live ranking is a sorted bar chart of everyone in the room (your own bar is highlighted; hover a bar for the exact score, and ties share a rank).
- **Celebration.** If every mistake is found and you found at least one of them without a single wrong click that round, your screen gets confetti and a PERFECT! banner (banner only when reduced motion is on). The server tracks each player's finds and wrong clicks per round for this.
- **Skip and answers.** *Skip · show answers* gives up on the passage for the whole room: no points are awarded, every missed mistake is revealed, and each answer (found or missed) lists the wrong word, the fix, the kind of mistake and a short reason (for example "a contraction needs an apostrophe where letters are missing"). The wrong word is shown in red and the fix in green, with no strikethrough.
- **Next question is a click.** Rounds never start on their own. When all mistakes are found, time runs out or someone skips, the answers stay on screen until an active player presses *Next question*, which keeps everyone's scores. *Reset ranking* (or changing level) zeroes the scores for the room. Up to 20 players compete; anyone beyond that watches and cannot act. A player who disconnects keeps their score during the reconnect grace period.
- **Server-authoritative.** The server alone knows which words are wrong; scores, penalties, finds and the clock never come from the browser, and the passage is withheld until the countdown ends.

## Twin Spot

Open `/twinspot`. Two round cards sit side by side and share exactly one symbol. Everyone in the same arcade room races to click it (on either card): a correct click scores, a wrong click deducts 25 points and locks that player out for one second. A live bar-chart ranking shows the room.

- **Difficulty.** *Easy*: five emoji on each card. *Medium*: seven. *Hard*: seven symbols, but three on each card are shown as their word instead of the emoji, so the match can be an emoji on one card and its word on the other (or two words). Emoji come in different sizes and are rotated to a random angle; no country flags are used.
- **Layout.** Every symbol is modelled as a capsule (a circle for an emoji, a long thin capsule for a rotated word) and placed where it has the most clear space, so items are spread across the card and never touch, even long words such as *elephant* or *scissors* turned at odd angles. Long words also get a smaller font. Emoji are sized by how wide they are actually drawn (about 1.2 times their font size), and as a safety net the page measures every symbol after it is drawn and shrinks any that would come within a few percent of the circle's edge, whatever emoji font the device uses.
- **Dealing.** After a match only the clicked card is replaced. The card that stays on the table keeps its layout, and the new card shares exactly one symbol with it (never the symbol just found). Skipping a pair reveals the match and replaces one card at random. Changing the level or resetting the ranking deals two new cards and zeroes the scores.
- **Scoring.** 100 / 150 / 200 points by difficulty plus up to 50 for speed. Up to 20 players compete; anyone beyond that watches and cannot act.
- **Server-authoritative.** The server builds the cards, places every symbol so nothing overlaps, and alone decides whether a click is the match; the card data it sends carries no symbol ids.

## Toolbar

Every page shares one calm, fully fluid toolbar (`public/platform.js` and `public/platform.css`). On the left are the gecko logo (it links home) and the current game's name, which opens the list of all thirteen games. On the right are a few icon buttons:

| Button | What it does |
| --- | --- |
| People icon and number | The count of active players. Hover, focus or click reveals each player's name, IP address, room and connected time. |
| Reset | The game's reset control (it keeps its own label, such as "Reset match"). It never gives spectators control. |
| Door icon | Opens **Room and player**: your player name, the named rooms, **New room**, and the protocol log. |
| Nine dots | The other apps on the shared platform. Hidden when the platform's app list cannot be read. |
| **Log in** / your first name | The optional shared login (below). |

![The toolbar at 1280, 768 and 320 pixels wide, and the 320 pixel login dialog](public/screenshots/toolbar.png)

Layout rules: sizes are in `rem`, nothing in the bar has a fixed text width, long titles truncate with an ellipsis and a tooltip, and the right-hand group wraps below the title on phones from 320 px wide. Labels collapse into icon-only buttons under 40 rem, every button keeps its `aria-label` and tooltip, touch targets are at least 44 px, keyboard focus is always visible, menus open with Enter or Space, move with the arrow keys and close with Escape (focus returns to the button), colours follow `prefers-color-scheme`, and transitions are off under `prefers-reduced-motion`. The icons are inline SVG line icons on a 24 px grid with a 2 px `currentColor` stroke; there is no icon font and no emoji in the interface.

## Optional login

Nobody has to log in: every game works anonymously, exactly as before, and a slow or unreachable login service never delays a game. On load the page asks the platform's auth service (`https://auth.hedgies.cloud/me`, with the shared `sso_access` cookie) who you are. If you are signed in, your name appears in the toolbar and fills the player-name field in every game; you can still type another name, and a name you type wins for the rest of the session. If you are not, a small **Log in** button opens a dialog with email-or-username and password, **Continue with Google**, **Continue with Microsoft** and **Forgot password**. There is no sign-up form: new accounts are enabled by an administrator, and the dialog shows the server's message (for example "waiting for an administrator to enable it"). An OAuth return with `?auth_error=...` is shown in the dialog and removed from the address. **Log out** ends the session and clears a name that came from the account.

The client is `public/sso.js` (the same contract as the infrastructure repository's `clients/js/sso-auth.js`, including the single `/refresh` retry after a 401), loaded before `platform.js` on every page. The name is **display only**: the Arcade server does not verify the cookie, adds no authorization and stores nothing per user. The auth address can be changed for a test environment by setting `window.ARCADE_SSO_BASE` before `platform.js` loads.

## App switcher

The nine-dot button in the toolbar opens the other apps on the shared platform. The server (`GET /api/platform-apps`, `lib/apps.js`) reads the platform's registry from `APPS_URL` (default <https://apps.hedgies.cloud/app.json>; set it to an empty value to turn the switcher off), hides this app by its `id` (`arcade`), and takes each app's name and icon from that app's own page and web manifest (`<link rel=manifest>`, otherwise `manifest.webmanifest`; a small `apple-touch-icon` wins over a huge manifest image). Nothing about the other apps is hard coded. The registry is read on every request with a 2 second limit, and the visitor's platform cookie (`sso_access` only, nothing else from the Cookie header) is forwarded to the registry alone, never to an app page or after a redirect to another origin, so an administrator also gets the administrator-only entry the platform adds for them. The answer is `private, no-store` and the list is never cached between visitors; only each app's name and icon are cached (ten minutes, per app URL). Every fetch is https-only, refuses private and loopback addresses (also after redirects and on the address actually connected to), reads at most 512 KB, and when the registry cannot be read the last public list (read without a cookie) is served, never an admin entry, and with none the list is empty, so the browser hides the button. Apps open in a new tab.

## Named arcade rooms

Use the door button in the shared toolbar (**Room and player**) to see each room's random name, current game and player count. Choose **New room** to start a separate room or select another room to join its game. Game switches, drawing, chat, matches and resets affect only your room. Your room selection is kept for this browser tab across game changes and reconnects. Empty rooms disappear from the directory immediately and are destroyed after a 10-second reconnect grace period, including all game state, timers and cube-solving workers. Rooms and game state reset when the server restarts. Slush Rush shifts remain private and its best score is shared across all rooms. Slushy dispensing is now twice as fast (a small cup reaches the rim in about 1.2 seconds).

# Shared galaxy server

One authoritative galaxy, up to eight anonymous pilots, Node 22+, and the `ws`
WebSocket library. The existing browser frontend and the server share
`public/scripts/conquestPhysics.mjs`.

## Class-box requirements

Complete the assignment's manual folder step yourself first. Keep this repository
inside your assigned `$HOME/projects` area, with `public` and `server` adjacent.
The teacher-owned `~/README.md`/AGENTS files remain authoritative and untouched.

From the repository root, after the code has been copied/pulled into your project:

```sh
npm ci --prefix server
svc start game "node server/server.mjs"
```

For an existing service, use `svc restart game`. Inspect only your own service with
`svc list` and `svc logs game`. Do not use a foreground long-running server,
`nohup`, `&`, `screen`, or `tmux` on the class box.

The entrypoint requires `$PORT`, binds `0.0.0.0`, and checks the assigned range
when `$PORT_BASE`/`$PORT_END` are provided. There is no default port. Caddy supplies
HTTPS, redirects, WebSocket forwarding, and CORS. The app adds none of those.
The public address is `$STUDENT_URL`; the WebSocket path is `/game`, and a read-only
health response is at `/health`. No SSH login, password, or key belongs in this repo.
No AI tool or model is installed or run by this server.

## Browser connection

- Visiting the game at `$STUDENT_URL/` connects to its own server automatically.
- For Firebase Hosting, set the **public** endpoint in
  `public/scripts/multiplayerConfig.mjs` to the assigned HTTPS service URL. This
  value is not a credential. Publish the frontend only after the service is ready.
- An empty endpoint keeps local practice available; it does not pretend to be online.
- For local testing, a `?server=` query can point to a localhost HTTP/WS endpoint.
  Public endpoints must use HTTPS/WSS and cannot contain URL credentials.

The production origin allowlist includes the existing Firebase Hosting domains
and `$STUDENT_URL`. Set `GAME_ORIGINS` to a comma-separated list if an additional
frontend origin is needed. This validates WebSocket origins; it does not add CORS
headers. Local development origins also need to be explicitly allowed.

## Durable state and privacy

`server/.runtime/galaxy.json` is the default private state file, ignored by Git and
outside public web assets. `GAME_DATA_FILE` may choose another path inside the
assigned `$HOME`; do not put it under `public`. Files use owner-only permissions.
Atomic replacement and fsync preserve complete snapshots. Critical action outcomes
are saved before confirmation. Ordinary state is checkpointed at least once a
second while running. A crash can roll back unconfirmed/most recent movement;
confirmed critical state is committed before it is announced.

Malformed snapshots stop startup instead of silently erasing territory. Preserve
or back up this private file before replacing the service directory. Never commit
it: it contains hashed reconnect reservations and game state.

A controlled restart preserves online-player reservations. After restart they
have 30 seconds to reconnect. Already disconnected players keep their existing
expiry deadlines. Expiry releases all of that pilot's territory; deliberate Leave
releases it immediately. The world does not advance during a service outage.

Reconnect tokens are random, stored in the player's session storage, and hashed
on disk. They never appear in URLs, analytics, chat, or application logs. Messages
are transient room broadcasts: no chat history is written to the save file or
analytics. Pilot labels and colors are generated, not personal names. Transient `announcement` messages report joins, disconnects, rejoins, departures and deaths, with attacker attribution for projectile kills.

## Simulation and protocol

The server owns movement, gravity, fuel, damage, pickups, projectile hits, docking,
hacking, planet purchases, rocket purchases, death, and respawn. Per-pilot context
selection is synchronous; shared entities are integrated only once per tick.

Inputs expire after 300 ms without updates. Snapshots are sent at up to 20 Hz;
clients smooth visible ship poses without applying authoritative resource changes.
Full distant ship state is withheld unless recently firing. The map receives a separate public list of generated pilot labels, colors, positions, headings and connection status; it contains no fuel, cargo, upgrade or reconnect data. Planet ownership colors remain public. One pilot can occupy a relay receiver at a time.

Messages have size/rate limits, slow-client buffering is bounded, origins are
checked, and heartbeat detects broken sockets. Monotonic command IDs survive
reconnects so replaying a purchase cannot charge cargo twice. Invalid positions,
resource amounts, and hit claims are never accepted as controls.

Rocket costs initially use 8/16/28/40 cargo. All tiers slightly improve steering
and braking. Tier 1 adds speed-fading acceleration, faster fire and lower heat;
tier 2 fires pairs; tier 3 reduces powered-control fuel use by 20%; tier 4 alternates
faster barrels and increases bullet speed by 30%. Death removes one tier, at most
once, and the death notice identifies the loss. These are initial playtest values.

Each planet upgrade adds one turret, with three fixed surface slots spaced 120 degrees apart. Each has independent health, aim, firing and recovery timers. Existing single-turret saves migrate their original gun state into the first slot, then add the remaining guns required by the saved tier. Turrets choose their nearest eligible enemy in the shared simulation, so the owner's barrel moves identically to the attacker's. Five hostile player shots disable one for ten seconds. Its shared health refills during recovery; friendly shots cannot damage it, and hits during recovery do not extend the timer. Capture and departure reset turret state. Existing saves without turret fields remain supported.

## Local verification

From the repository root:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
node --test server/tests/*.test.mjs
```

The server tests open ephemeral **localhost-only** listeners and keep temporary
snapshots under the ignored `server/.test-runtime` directory. They do not connect
to the class box or choose its service port. Do not run them on the class box in
place of following its assigned-port rules.

Before live release, walk the flow with two browsers/devices using the real public
endpoint, verify Caddy forwarding, and check server restart/reconnect under `svc`.
Keep the code in the public repository as required by the assignment; keep runtime
state and secrets out of it. Commit/push authorization follows the user's active
repository instructions.

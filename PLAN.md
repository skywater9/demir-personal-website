# Orbital Freight — multiplayer planning draft

Live site: https://demir-personal-website.web.app/

Status: approved experience with a local multiplayer implementation prepared. The
class-box service has not been deployed. This is an AI-assisted planning record,
not a claim that the assignment's personal setup or neighbor review is complete. Replace the marked questions with the owner's own words and
review every proposed choice before treating this as submission-ready.

## 1. Who is there together?

**Confirmed by the owner:** “two people are playing on the same server.” The
first release has one room for everyone; server selection is deferred. Both
participants use anonymous pilot labels and colors.

**Owner's description:**

> each person will spawn in a shared galaxy, and they must compete against each other to conquer planets and upgrade their rocket.

The shared moment is simultaneous play in the same galaxy. The owner has now defined
four rocket upgrade tiers for multiplayer. These are planned features; the
currently published game still has a rocket-upgrade placeholder.

The established game idea is anonymous pilots sharing a galaxy, each with a
protected home and their own color. Players explore, capture planets, collect
cargo, refuel, buy planet defenses, and contest other pilots' territory.

## 2. What does one person do, and what do the others see?

The following preserves the current game rather than restoring older prototype
rules. Timing below is a proposed target to verify on the class box, not a promise.

| One pilot's action | What the other pilots see | Proposed response |
| --- | --- | --- |
| Press Play | A new pilot appears at an available protected home; the map shows its owner color. | After the server accepts the join. |
| Fly, brake, or turn | Nearby pilots see the rocket move and turn smoothly. | Aim for roughly 100–200 ms under ordinary class-network conditions. |
| Fire | Relevant pilots see bullets, gun heat, recoil, hits, and any destruction. | Continuous updates at the same pace as movement. |
| Dock and enter capture digits | Nearby pilots see a rocket attached to the relay; the hacker sees their own code and progress. | Each input receives server confirmation. |
| Finish a hack | Everyone sees the planet's new owner color; nearby pilots see the expanding shield; server chat announces the anonymous pilot and planet in that pilot's color. | Aim for under 250 ms after server confirmation. |
| Collect a cargo pod | The pod disappears for everyone and the collector's cargo increases. Only one pilot can collect it. | Same shared update as the collection result. |
| Land on an owned pad | The pilot refuels gradually; nearby players see the landed rocket. | Refueling advances continuously on the server. |
| Press T to buy a defense | The attached planet gains its next defense, and the buyer pays cargo once. | One confirmed purchase, reflected in shared updates. |
| Press R to buy a rocket upgrade | The buyer pays cargo once and gains the next tier. Other pilots see its weapon configuration and flight behavior when nearby. | One server-confirmed purchase. |
| Send chat | All pilots in that room see the message with the sender's anonymous label/color. | Aim for under 250 ms after acceptance. |
| Die | Nearby players see the explosion and dropped cargo. The dying pilot sees the rocket tier loss on the death screen, then respawns at home one tier lower. | One server-decided death and respawn; never duplicate the tier loss. |

Keep the current W thrust, S axial braking, mouse steering, Space firing, E
interaction, changing-digit hacking, T planet purchases, and / chat controls.
R will buy the next rocket upgrade at an owned relay. Docking needs proximity and low speed,
not rotation. Cargo is collected in flight and gently attracts nearby pilots.
Home planets provide refueling but have no relay or cargo production. Combat
uses the current fuel-damage and gun-overheat rules, not the old one-hit draft.

Keep the previously discussed visibility rule: planet ownership is public on the
map, while distant hidden rockets are not continuously exposed to everyone.
Nearby pilots are visible; firing can reveal a pilot farther away. Exact visibility
and reveal distances still need tuning.

## 3. What must everyone agree on?

**One shared truth: the server's galaxy state.** This includes the current owner
and defense level of every planet, each pilot's rocket/fuel/cargo, cargo pods,
projectiles, active captures, and deaths.

The browser requests actions. It cannot award itself territory or cargo, report
its own hits, or buy an upgrade without the server checking the cost. The server
applies each successful capture, pickup, purchase, and death once and sends the
result to the relevant players. Chat is shared within the same room.

A concrete example: pilot A and pilot B approach the same cargo pod. Only the
server chooses who collected it. Both screens then remove that same pod; they
cannot each receive a copy.

**Proposal to approve:** one pilot can occupy a relay's docking receiver at a
time. A second pilot sees an occupied message and can wait or attack. Simultaneous
requests are resolved in a stable server order. The exact contention rule is not
yet a settled gameplay decision.

## 4. Joining and leaving

- Play connects to a shared room. A late arrival receives its current state,
  including existing ownership, defenses, ships, and pods—not a fresh local galaxy.
- Assign a free home and a distinct pilot color. A home remains uncapturable,
  blocks hostile rockets/shots, and has neither a relay nor cargo production.
- Earth players can retain the Moon introduction. Other home locations need an
  equivalent nearby neutral-relay destination; the exact home assignment and
  introduction rule must be approved before implementation.
- Refresh/network loss clears held thrust/fire, detaches the rocket, and cancels
  partial hacking. Keep the agreed 30-second reconnect window. The world continues
  for everyone else; a disconnected rocket is not granted invulnerability.
- Reconnecting within that window restores the server's current state, including
  any death that occurred while disconnected. It never uploads a local saved world.
- A deliberate Leave action, if provided, releases territory immediately. Closing
  the tab or losing the network uses the existing reconnect window because the
  server cannot reliably distinguish a refresh from a permanent departure.
- After the window expires, release the player's territory and home for reuse.
  The returning visitor starts as a new pilot. Death itself still keeps territory
  and drops carried cargo. Death now also removes one rocket upgrade tier, down
  to a minimum of tier 0, as confirmed by the owner.
- If the connection cannot be established or the room has no free home, show a
  clear unavailable/full message and allow retry or return to the menu.

**Confirmed:** one shared room for the first release. Play joins that room
directly. Server selection/search is deferred. A player limit must still leave
neutral planets available to capture; do not assign every planet as a home.

## 5. Why is it better together?

**Owner's explanation:**

> Each player can attack and take over another players planets, which creates a never ending and engaging battle of ownership.

Other people make territory worth defending and can overturn a player's progress.
In a solo galaxy there is no human opponent to attack, interrupt, or reclaim a
planet. The shared ownership contest is the reason to keep returning to the loop.

**Neighbor act-out check to do:** One pilot docks and hacks a relay. The other
pilot approaches, attacks, and tries to take the same territory. Both see the same
owner color, shield, and capture announcement. Read the reviewed plan to a neighbor
and confirm they can act out both sides without extra explanation.

## Proposed implementation after the plan is approved

1. Keep Firebase Hosting for the existing static frontend and existing analytics.
2. Run a long-lived game server inside the assigned project area on the class box.
   The box provides Node 22 and npm. The local implementation now reuses JavaScript
   rules in a Node HTTP process with the approved `ws` dependency. Shared code is
   under `public/scripts`; server code is under `server`. Nothing has been installed
   or created remotely. The student must create the required folders personally first.
3. Connect browsers through secure WebSockets at the public hostname supplied
   by `$STUDENT_URL`. Caddy explicitly supports WebSocket forwarding. The game
   process serves plain HTTP/WebSocket traffic on `0.0.0.0` using
   `process.env.PORT`; Caddy handles the public HTTPS/WSS connection, certificates,
   redirects, and CORS. Do not add HTTPS or CORS code to the game server. [MDN browser connection guide](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications)
4. Adapt the current single-player rule engine to one world with multiple pilots.
   The current hardcoded `pilot` owner, one `world.player`, and local save validation
   cannot simply be broadcast to other browsers. Share the movement/combat rules
   and put final authority on the server.
5. Send bounded controls/actions; broadcast relevant state snapshots and confirmed
   outcomes. Smooth remote ships between updates. Exact simulation and broadcast
   rates depend on measuring the assigned box, not guessed resources.
6. Replace device-only chat with room chat. Limit message length/rate and render
   text safely. Keep chat bodies and reconnect credentials out of analytics.
7. Exercise the complete flow with two real browsers/devices: join, contest a
   capture, collect a pod, upgrade, fight, respawn, refresh/reconnect, and leave.
   Verify shared outcomes and readable anonymous event logs before publishing.

## Rocket upgrades — defined by the owner

Purchase sequential tiers with carried cargo at an owned non-home relay, using
R or the existing rocket shop button. Upgrades belong to the player's rocket,
while T continues to upgrade only the attached planet. Prior benefits carry
forward; tier 4 changes the double gun's firing pattern.

| Tier | Rocket and weapon behavior |
| --- | --- |
| 0 | Standard rocket and single gun. |
| 1 | Extra low-speed acceleration for maneuverability; only the bonus fades as speed rises, leaving normal engine strength. Faster firing and slower heating, so continuous fire takes longer to overheat. |
| 2 | Double shooter fires two bullets together, retaining earlier benefits; maneuverability improves slightly again. |
| 3 | Increased fuel efficiency, retaining the double shooter and previous benefits; maneuverability improves slightly again. |
| 4 | Double shooter alternates barrels at a faster rate and fires faster-moving bullets; maneuverability improves slightly again. |

**Owner's description:**

> First upgrade makes rocket acceleration faster, but this acceleration ramps down so as you get faster it slows down the acceleration, so mainly it is increased maneuverability, and also this makes shooter shoot faster, and heat up slower.

> Throughout all these upgrades, the maneuverability is slightly increased.

Keep the visible gun heating, smoke, and 2.5-second overheat cooldown. Tune heat
and firing together: a lower heat amount per shot is not enough if the higher
firing rate makes the gun overheat sooner. The first upgrade must actually make
sustained firing last longer before overheating.

The server validates tier, cargo cost, fire cadence, projectile speed, heat,
fuel use, and steering. Confirm the purchase once, deduct cargo once, and save
the resulting cargo and rocket tier together. Persist that tier across reconnects
and server restarts. Include relevant rocket/weapon tier information in snapshots
so other pilots see the correct gun and projectiles.

**Confirmed behavior:**

- At high speed only the upgrade's added acceleration fades; ordinary engine
  strength remains. This is an acceleration bonus, not a new speed cap.
- Tier 2 fires both barrels together. Tier 4 switches to faster alternating
  barrels and increased bullet speed.
- Each death loses exactly one rocket upgrade tier, clamped at tier 0. Retained
  lower-tier benefits apply immediately to the respawned rocket. Territory stays
  owned and carried cargo drops, preserving the other agreed death rules.
- The death/respawn screen explicitly reports the lost upgrade tier, for example
  **ROCKET UPGRADE LOST: TIER 3 → TIER 2**. If the rocket was already tier 0, do
  not claim an upgrade was lost. Keep the existing automatic respawn flow; this
  does not add an end-of-run screen or a retry requirement.
- Apply the downgrade once on the server, alongside the death/cargo transaction,
  and persist it. Duplicate hit/death messages or reconnecting must not remove
  another tier. A reconnect after death restores the already downgraded rocket.

**Initial playtest tuning:** costs 8/16/28/40 cargo are approved starting values.
Exact implemented initial bonuses and protocol limits are documented in
`server/README.md` and `assumptions.md`; tune these after two-device playtesting.
There are four tiers, with no additional upgrade tiers introduced.

## Restart persistence and leaving

**Owner's requirement:**

> territory should ideally survive restarts, but if a player leaves their territory is erased, like a .io game

The server therefore needs durable state, not just in-memory ownership. Save the
shared galaxy state in the student's own workspace, outside public assets and
excluded from Git. Persist planet owners, upgrades, rocket/cargo state, anonymous
player reservations, and reconnect information together so a restart cannot
restore ownership while forgetting the corresponding resource transaction. Chat
bodies do not belong in the saved state or analytics.

A restart must load the saved galaxy rather than creating a neutral replacement.
The implementation uses a private, Git-ignored JSON snapshot with atomic rename
and fsync. Critical transactions save before confirmation; ordinary state saves
at least once a second while a room is occupied. Corrupt saves stop startup.

**Confirmed restart behavior:** pilots online at shutdown
get a fresh 30-second reconnect window after the server comes back. Those who
return keep their saved territory. Those who do not return lose it when that
window expires. Players already disconnected before shutdown keep their original
expiry time; restarting cannot keep abandoned territory forever. No gameplay
simulation advances while the server is down.

This preserves an active match through a server restart without turning it into
permanent offline ownership. One shared room, four rocket upgrade tiers, durable
territory, and the 30-second restart reconnect window are confirmed. The remaining
numerical tuning choices above still need review; rocket behavior is confirmed.

The class box supplies the game process; the plan does not require paid Firebase
Functions or a high-frequency Firestore game-state feed. This is not a claim that
class hosting has unlimited capacity.

## Confirmed class-box operating rules

These facts come from the README pasted by the owner. Its teacher-owned remote
README/AGENTS files must not be edited.

- Only work inside the assigned `$HOME`; the project belongs under
  `$HOME/projects/<chosen-project>`. Use `$STUDENT`, `$HOME`, `$PORT`,
  `$PORT_BASE`, `$PORT_END`, and `$STUDENT_URL` from the login environment, never
  hardcoded student identities or guessed ports.
- The main game process must listen on `0.0.0.0` and `process.env.PORT`. Use one
  process for the game and room chat. No extra service/port is needed for chat.
- Caddy supplies HTTPS/certificates and HTTP-to-HTTPS redirects. It also routes
  the public student hostname to the assigned port, forwards WebSockets, and
  supplies CORS headers/preflight handling. Do not duplicate those in app code.
- Start the process with `svc start game "node server/server.mjs"` from the eventual
  project directory, from the repository root. Use `svc list`,
  `svc logs game`, and `svc restart game` for that student's own service only.
  `svc` keeps it running after logout and restarts it after crashes. Do not use
  `nohup`, background `&`, `screen`, or `tmux`.
- Install project dependencies only inside the student's project area. No system
  packages, sudo, other students' directories, or other students' services.
- No AI tools, models, or AI API scripts may run on the box. The assistant stays
  on the local computer; any future SSH command must carry the correct STUDENT
  environment through the verified connection configuration.
- Exclude `.env*`, `node_modules`, and `.venv` from Git. If secrets become needed,
  store them outside the repository at `~/.env.<project>` and load them from the
  environment. No class login/password, SSH keys, tokens, or personal data belong
  in the repository or shared game/chat logs. Use made-up pilot labels.
- Keep the project in the owner's public GitHub repository and push working
  sessions, as required by the server instructions. This planning update does
  not claim any commit, push, deployment, or server setup has occurred.

The student must personally run `myports` to obtain their actual public URL and
assigned port. The pasted README describes how assignments work; it does not
supply this student's concrete values or verify SSH/key setup.

Use `addkey` for public-key registration, never hand-edit the shared
`authorized_keys`. Verify the first SSH fingerprint against the classroom value.
The class login and connection example from the pasted prompt are redacted in
`prompts.md` to honor the assignment's no-login-in-the-repository requirement.

Part 4 explicitly requires the owner to type every folder-creation command by
hand. AI must not perform that step. Suggested component responsibilities are
browser client and game server; folder names remain the owner's choice. Create
one project and at least two component folders inside the assigned `~/projects`.
Do not claim that step is complete until the owner has done it.

## Submission information to fill in after verification

Link to my current live site (required): https://demir-personal-website.web.app/
My address on the box: [the public $STUDENT_URL printed by myports, not the SSH login]
The port my service must listen on: [the value of $PORT printed by myports]
What stays up after I log out, and how: the game server, managed by svc; proposed launch is svc start game "node server/server.mjs"
Two things the proxy does for me: handles HTTPS/certificates and routes my public hostname to my assigned port (it also handles WebSockets and CORS)
Folders I made: [the folders you personally created]

For the screenshot, personally run `clear`, then `myports`, then
`ls -R ~/projects`, as the assignment specifies. Exclude the welcome/login message.
Do not claim the SSH, key, README, folder, or neighbor-review checks are complete
until you have actually done them. Keep this draft out of the final submission
until the personal answers and unresolved choices have been reviewed.

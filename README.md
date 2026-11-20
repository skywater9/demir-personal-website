# Orbital Freight

An open-world pixel-art conquest game with local practice and a shared multiplayer server. Explore three scattered star systems,
hack relays to capture planets, collect cargo, refuel, and upgrade your territory.
This replaces the finite story journey. A configured server hosts one shared galaxy;
without an endpoint the game runs locally. The shared class-box service is live; its URL is configured in the frontend. See [server setup](server/README.md).

## Current upgrades and capture

- BOOSTER and WEAPON are independent tracks, each capped at 10. Owned planets sell both plus PLANET upgrades; home stations sell BOOSTER and WEAPON only. R buys BOOSTER, F buys WEAPON, and T buys PLANET or repairs. Each track uses prices 5/10/15/20/25/30/35/40/45/50 cargo.
- BOOSTER increases low-speed acceleration by 15% per level; the extra acceleration fades with speed, leaving normal engine strength. Propulsion fuel use falls by 3.5% per level. WEAPON gradually increases fire rate, heat endurance and projectile lifetime. Level 3 unlocks twin shots, level 5 alternating twin shots, and level 10 a player-colored instant laser with a 12,000 m range. Lasers stop at their first target, solid surface or hostile home shield; soft planet fields do not bend them.
- Death drops carried cargo and removes one level from both tracks, floored at zero. Both losses appear during respawn and in the death notification.
- Initiate capture with E while aiming at a planet, then press E repeatedly. Holding E and number keys do not advance capture. Required presses are 8 + 2 × planet level; progress decays at 0.65 press-equivalents per second. Cursor movement is allowed; leaving the growing shield range resets capture. Concurrent sectors and first-finish-wins rules remain. Capturing resets defenses but preserves banked and floating cargo for the new owner to collect; no cargo is credited automatically.
- PLANET caps at 10. Each level costs the next 5-cargo step and adds a turret, grows the shield and expands interaction range for capture, shops and repairs. Turrets added at levels 6–10 have double barrels. Larger hitboxes make one-hit turret destruction more forgiving. Nearby friendly planets prioritize shield intruders within each turret's normal range and line of sight.
- Destroyed guns replace the PLANET button with REPAIR TURRET. Each purchase restores one turret after its cooldown for 2 × planet level. Upgrades unlock once every turret is restored. Only the loss of the final turret sends a private owner alert; individual losses and capture attempts do not.
- Refueling is twice as fast, retaining its slower finish near full and faster home-station rate. The black hole produces cargo for its owner only. First spawn shows a large blinking yellow CAPTURE PLANET arrow to the nearest capturable planet. Player colors are stronger on hulls and glow, with a light tint on the cursor and aim line.
- Existing combined rocket upgrades migrate into separate tracks without clearing territory or cargo. Planet levels above ten are capped, with a private server backup before migration. Historical notes below describe earlier iterations when they differ from this section.

## Starter station prototype

- Rollback checkpoint before this prototype: `f19dd66`.
- Preview with `python3 -m http.server 8765 --bind 127.0.0.1 --directory public`, then open
  `http://127.0.0.1:8765/?prototype=stations`. This preview explicitly uses local practice,
  preserving the configured multiplayer endpoint for a later coordinated server update.
- Players start at a small protected station, owning no planet. The station refuels,
  provides one cargo per minute directly to its pilot, and sells rocket upgrades.
- Planets are 20% smaller and have no separate relays. Aim the cursor at a planet,
  approach within 250 m of its surface and press E, then press E repeatedly: eight presses for neutral planets, increasing by two per planet level. Capture has no speed or heading restriction.
  Active turrets prevent capture; destroy every turret first. Once started, capture continues
  when the cursor moves away. Leaving range, cancelling, dying or disconnecting resets progress.
- Captured planets produce orbiting cargo and offer defense upgrades through E.
  Return to the starter station for rocket upgrades. Planet ownership excludes stations.
- Prototype saves use a separate local storage key. Existing multiplayer save files
  use the station-compatible server state format. The shared server runs this version,
  and Firebase now serves its matching frontend.
- Focused checks: `node --test tests/stationPrototype.test.mjs`. Legacy relay and
  initial-Earth UI tests still describe the previous design and need revision before release.


- Planet interaction is hover-driven: white hover outline and gray prompt at a distance; ready prompts
  turn green in range and the planet outline pulses. Small arrowheads move toward hovered
  planets, which reveal a dotted capture-range ring. No solid cursor-line segment is used.
- Each correct code animates a green ring and translucent sector over the planet.
  Defenders see red enemy capture progress; completion pulses green and leaves a
  gently glowing ownership outline. Neutral planets have no idle labels or range rings. The panel uses a white code key with an outward square pulse; progress is displayed on the planet.
- Planet shops open in flight without teleporting, slowing, or attaching the rocket.
  The yellow **FUEL** square refuels owned ships at any orientation. Turrets redistribute evenly around the surface after each upgrade.
- E docks anywhere inside the home station bubble, at any speed or orientation.
- Dropped cargo uses swept planet collisions and bounces off surfaces.
- A larger black hole sits above the three-system center, with circular glowing rings and orbiting particles, a lethal core and strong gravity extending 3,500 m beyond its surface.
- Pilots spawn and refuel at the starter station's left bay. Its home icon and label sit above a breathing double-ring shield.
- Brake exhaust points along travel, with faster particles (170 m/s before power scaling); main engine particle speed remains unchanged.
- UI checks: `node --test tests/planetInteraction.test.mjs tests/stationPrototype.test.mjs`.

## Combat and room activity

- Capture requires 8 + 2 × planet level fresh E presses, with slow backward progress when idle. Level ten requires 28 press-equivalents.

- Gentle planet bumps rebound at contact. Only slow upright pad contact lands, and landed rockets stay at their actual contact point rather than snapping to the pad center.

- Turrets lead moving rockets, fire every 1.4 seconds, and launch slightly homing bullets. Bullets steer toward their original target at up to 0.28 radians/second while preserving speed; they stop steering if the target dies or leaves. Ordinary player bullets remain unguided.
- A planet's initial inner bubble matches its capture-range ring. While inside it, only its owner can attract and collect that planet's cargo. Pods stay within the bubble, route around the surface, and pull increasingly strongly as the owner approaches the planet (up to 100 m/s and 100 m/s²). Unavailable pods are faded gray; available pods glow gold. Dropped death cargo remains shareable and looks larger/brighter for larger amounts.

- Local and remote rockets have a faint steady glow in their player color beneath the crisp pixel hull.

- Planets support ten upgrades. Each adds one independently aiming turret and grows/strengthens a soft shield. Turrets redistribute evenly, retaining their individual health. Upgrade prices start at 8/16/28 cargo, then increase by 12 per level (40 through 112). Planet shields slow and deflect hostile shots but never form a hard bullet barrier; friendly shots pass freely. Starter-station hard shields remain protected.
- Capture progress is split into equal pie sectors for simultaneous hackers. Enemy sectors and takeover flashes are red from your view. The first completion wins, exits other capture panels and locks recapture for five seconds.
- Basic guns fire roughly eight consecutive shots before overheating; firing speed and the 2.5-second cooldown are unchanged.
- Hover arrowheads keep following the actual cursor over planets.
- Turret heads share one server-controlled aim for owners and attackers. Bright bases and outlined barrels make them easier to spot.
- One hostile player-bullet hit destroys a turret. After five seconds, its owner can use REPAIR TURRET to restore one gun for **2 × current planet level**. Each press buys one repair; upgrades are blocked until every gun is repaired. Every live gun must be destroyed before capture. Owners receive a private notification only when all their turrets are destroyed.
- New pilots at every home get a large flashing relay arrow and “CAPTURE PLANETS TO GAIN CARGO” guidance until their first capture. Earth prefers Moon when neutral; other homes target nearby neutral relays.
- The map shows every pilot using generated labels and ownership colors. Distant off-map pilots get edge direction markers; disconnected pilots dim during their grace window. The flight view still reveals nearby or recently firing ships only.
- Room chat announces joins, disconnects, returns, departures, and deaths, including the attacker for projectile kills. Activity messages are transient and do not save chat text or credentials.
- Fuel-empty, respawn and other notifications appear directly above the map. At the empty-fuel warning, release and press **Space** to self-destruct, or click the matching button. Holding fire never accepts the warning automatically. Space otherwise fires normally.

## Local conquest

- **Play** starts on protected Earth with full fuel and no cargo. Other planets are neutral.
- **W** thrusts forward at 240 m/s²; **S** rapidly brakes in every direction, cancelling both forward and sideways drift regardless of heading. One brake plume points opposite world velocity regardless of hull rotation; braking tapers near rest without reversing motion. Rocket speed has no cap. Mouse/trackpad steers the rocket toward the cursor with fast, smooth turning (8 rad/s maximum, 150 rad/s² acceleration). Turning has no thruster particles; the main engine and braking retain their effects. **Space** shoots, **E** attaches/detaches, and the displayed number key advances hacking. A W/S/Space guide follows the cursor; each line highlights and fades one second after its key is pressed.
- The larger bottom-right flight readout shows remaining fuel with a pale usage overlay and red damage overlay, plus a large cargo count. Cargo pickups fly from the rocket to the cargo icon, which enlarges and flashes after arrival; an empty cargo count shows a “COLLECT CARGO” prompt. The square galaxy map stays centered on the player, uses true world distances between solar systems, and outlines the rocket in its player color. Clicking a planet chooses its relay or landing pad based on ownership.
- Camera zoom widens gently as speed rises and eases back in when slowing.
  Landing and docking retain a close view.
- Click a neutral planet to target its relay, or an owned planet to target its landing pad. Cargo must be collected in flight.
- Dock within 100 m at 20 m/s or less, at any rocket rotation. Within 200 m, a flashing ghost ship marks the docking position and a dotted line connects your right-side bay to it. The station shows a small square E docking cue; an unavailable attempt explains why in red below the relay dialog. Successful docking plays a 140 ms visual alignment animation. Complete the displayed changing-digit
  challenge to capture neutral planets. Wrong keys do nothing; detaching resets it.
- Owned planets bank cargo, then release pods from their surfaces into close orbits
  at 0.3 cargo per second (one pod about every 3.34 seconds), at random altitudes 70–160 m above the surface, with small random variations in orbital speed and direction. Fly through the pods to collect cargo; landing only refuels.
  The small force field
  extends 200 m above the surface. Refilling is free of cargo cost, faster when empty,
  slower near full, and faster at home. Zero fuel leaves you coasting, with an explicit
  self-destruct choice.
- At an owned planet shop, buy the next turret and stronger soft shield, up to level ten. Starter stations keep their special hard shields.
- Shots cost 5 fuel points. Fast impacts cost more fuel as speed rises above the
  former crash thresholds (25 m/s at surfaces, 30 m/s at stations): half a fuel
  point per excess m/s, rounded up with a minimum of one. Damage briefly flashes the hull red for the pilot and nearby players, and releases white
  fuel-leak particles; surviving impacts bounce gently.
- Damage greater than remaining fuel destroys the rocket. Equal damage leaves
  zero fuel and a surviving rocket; another damaging hit at zero is fatal.
  Stars and confirmed self-destruct remain lethal. Death drops carried cargo;
  home respawn restores fuel and retains owned planets and planet upgrades; one rocket tier is lost.
- The local galaxy browser lists/searches the one local galaxy; it is not a network
  server directory. Multiplayer hosting and other pilots are deferred.
- Menus remain live. Refresh/return within **30 seconds** to recover your world.
  Longer absences expire it. A local session summary is retained. Earlier story
  records remain in Flight Records; their storage is never overwritten.
- Saves use this tab's sessionStorage. Closing a tab permanently may clear them;
  browser restoring the same tab can recover only within the reconnect allowance.
- Fuel and cargo appear together in the bottom-right flight HUD beside the map. Damage releases bright white sparks from the rocket and a short particle burst along the fuel gauge. The speed counter, circular
  velocity dial, and rotation-degree readout are not displayed. Relay approach, hack,
  and upgrade controls appear above the relay in the flight view.
- The anonymous tracking notice and delivery status are in the menu. The existing
  private dashboard at `/analytics.html` includes conquest events.

Run locally from this repository:

```sh
python3 -m http.server 8001 --directory public
```

Open <http://localhost:8001/>. No game server, account, dependency installation,
or billed service is needed for this local version. Local play does not send
analytics to production. The existing Firebase site remains the deployment target.

The full multiplayer design remains in [MULTIPLAYER_PLAN.md](MULTIPLAYER_PLAN.md).
The implemented local experience is charted in [FLOW.md](FLOW.md). Test commands,
coverage and manual playtesting are in [TESTING.md](TESTING.md).

## Earlier singleplayer implementation reference

The sections below preserve historical deployment and story-game details. Route
progression, final delivery wins, old controls and persistent story saves describe
the retired journey, not the new conquest homepage. The new local flow above and
FLOW.md take precedence. Existing legacy modules remain available for regression
checks and earlier records; the homepage loads conquestApp.mjs instead.

## Published Spark setup

- Game: <https://demir-personal-website.web.app/>
- Available analytics: <https://demir-personal-website.web.app/analytics.html>
- Google Analytics property: <https://analytics.google.com/analytics/web/#/p561590091/realtime/overview>
- The Firebase project stays on the no-cost Spark plan. No Cloud Functions or
  other billing-required features are deployed. The production analytics page
  reads saved event rows directly from Firestore; its Google sign-in is owner-only.
- Google Analytics records normal page analytics plus `game_started`,
  `game_continued`, `game_left`, `game_suspended`, `game_landed`, `game_delivered`,
  `game_won`, `game_lost`, and `game_abandoned`. Parameters include route index,
  delivery count, fuel, and gameplay time; no run ID or email is sent. Localhost
  is excluded from Google Analytics. Tracking blockers can prevent collection.
- The Firestore visit counter and browser-local flight recorder remain available.
  Previous local flights are not uploaded or backfilled.
- `firebase.json` retains the backend/emulator configuration for later use.
  Publish the free static setup with:

```sh
firebase deploy --only hosting,firestore:rules,auth --config firebase.spark.json --project demir-personal-website
```

## Anonymous event log (current production implementation)

1. Open the live game in a private window or on a phone. The menu discloses tracking.
2. Start, use keyboard or onscreen controls, approach a docking bay, open the menu,
   continue, and finish or leave a flight. Wait for **EVENT LOG / SAVED** in the footer.
3. On your own device, open `/analytics.html` and sign in with the same Google account
   used to manage this Firebase project. Choose a visit to read all its numbered rows.
4. Each row shows event name, fixed target label, wall-clock time, seconds since arrival,
   and relevant gameplay metrics. Load more rows for long visits; Refresh fetches updates.
5. Confirm arrival, first action, clicks, screen choices, held control presses/releases,
   held thrust/rotation/RCS controls, docking checklist/attempts, landing/refueling, delivery, result,
   departure and return match `FLOW.md`. Clicks on non-interactive elements are logged
   by tag. Briefing/history expansion choices are recorded. Gameplay events include
   fuel, route index, delivery count, and gameplay seconds.
6. Refresh mid-flight: game progress survives independently, and the same tab visit
   continues with a `pageView` marked restored. Previous completed game records stay local.
7. Sign out: private rows clear immediately. A different Google account has no log access.

Implementation: `visitLog.mjs` captures events; `visitLogCore.mjs` holds the bounded
schema/outbox; `visitLogDashboard.mjs` reads owner-authorized Firestore queries.
`visitLogs/{sessionId}` holds a visit summary and `events/{sequence}` holds immutable
rows. Random anonymous Auth credentials authorize a writer; no visitor account UI is
required. A server-issued `analyticsOwner` custom claim authorizes only the existing
owner account. Visitor writer auth and owner dashboard auth use separate Firebase apps.
No Cloud Functions, paid plan, App Check key, or new dependency is needed.

- The tab's sessionStorage holds pending rows and stable sequence IDs across refreshes.
  A new tab/visit gets a random session ID. Refresh after 30 minutes of inactivity or
  24 hours starts a fresh visit. Closing the tab can lose rows not yet acknowledged.
- Uploads run every 5 seconds or 12 queued events, with retry/backoff up to 60 seconds.
  Requests use `keepalive`; deterministic IDs prevent duplicates after uncertain commits.
  Foreground heartbeats every 20 seconds bound the unknown gap when an exit is missed.
  Browser crashes, disabled storage, blockers, network loss, and exhausted quotas can
  still prevent collection. The footer reports saved, pending, or connection failure.
- Observed site time is last event minus arrival, and can include time away between
  return events. The game timer separately counts only active gameplay.
- Strict allowlists exclude names, emails, typed text, raw keys, run IDs, URLs/referrers,
  and IP addresses from event documents. Firebase/Hosting have their own platform logs.
  The private summary contains a random anonymous writer UID only for access control.
- Up to 5,000 rows are accepted per visit. Spark remains subject to its free quotas
  (currently 20,000 writes and 50,000 reads/day); hitting them interrupts collection
  instead of authorizing a billed upgrade. Summary updates also consume writes.
  See [Firestore quotas](https://firebase.google.com/docs/firestore/quotas).
- Saved rows have no automatic expiry. Dashboard queries load 25 visits or 100 events
  per page using standard single-field indexes. The older Functions heatmap stays inactive.
- Localhost gameplay deliberately does not upload production event logs. Test the real
  rules with the Auth/Firestore emulators, or use the live private-window verification above.

Run offline unit/DOM checks with `node --experimental-vm-modules --test tests/*.test.mjs`.
Rules integration tests additionally require `FIRESTORE_EMULATOR_HOST` and
`FIREBASE_AUTH_EMULATOR_HOST`; run `firebase emulators:exec --only auth,firestore
--project demo-website-analytics 'node --test tests/visitLogRules.test.mjs'`.
If default emulator ports are occupied, supply a temporary config with free ports.
The integration test checks real anonymous writes, owner queries, duplicate commits,
out-of-order batches, cross-visitor denial, forbidden text fields, bounds, and immutability.
Automated DOM tests do not substitute for visual browser playtesting.
Production REST verification saved a two-row backend test visit
`bc2a3cd8-f432-4739-adab-2c6e28bd012b` (arrival/departure only); it is not a
player run and contains no fabricated gameplay outcomes. Released static files
were compared to local sources, anonymous writes/readback succeeded, visitor
listing was denied, and the billing API confirmed billing remains disabled.

## Play locally

```sh
python3 -m http.server 8000 --directory public
```

Open `http://localhost:8000/`, read the pre-flight briefing, and choose **Start
Flight**. No build or dependency installation is needed for the game.

Reload after source changes. The stylesheet and game modules use matching cache
version tokens so a new page does not combine old physics or renderer code with
updated UI. Update those tokens together when releasing further game changes.

| Control | Action |
| --- | --- |
| Hold W, Space or Up | Burn the main engine; release to coast |
| A / D or Left / Right | Rotate counterclockwise / clockwise |
| K | Brake: backward thrust relative to the rocket; aim to oppose your motion |
| Double-tap W / A / S / D | Dash forward / left / backward / right relative to the rocket |
| E | Attach and deliver when all bay checks are green |
| Escape | Save and return to the menu |

Held flight actions also have on-screen controls, including simultaneous touch
inputs. Dashes use the keyboard: press the same W/A/S/D key twice within 250 ms
to add an instant 54 m/s burst in that rocket-relative direction. Each dash spends
1 percentage point of fuel. All directions share a 2-second cooldown measured in
active flight time, preserved across saves. Taps during cooldown do not queue a
future dash; holding a key does not repeat dashes. W burns the main engine and A/D retain their held rotation actions. Keyboard users can Tab to a control and hold Space or Enter to operate it.

The route is Earth → Moon → Venus → Mercury → Earth → Mars → Jupiter → Saturn →
Uranus → Neptune. Each stop starts with a payload for its relay. Deliver it, then
manually fly to the next landing pad. A safe upright landing grants fuel and the
next payload once per route stop. The tank holds half the original fuel supply;
the gauge still reads 0–100%. Every pad adds 25 percentage points, capped at full,
and each route stop can refuel only once. Existing saved fuel percentages and
previous flight records remain readable. Deliver the Neptune payload to win. Excessive
impact speed or an empty tank ends the run; Retry starts over on Earth.

The flight view is full width. Its bottom console runs left to right: propulsion
with a live combined fuel-use meter above remaining fuel; a larger rocket
velocity/heading dial with a vertical divider before speed and stacked X/Y, and a horizontal divider above rotation; flight systems
information in paired TITLE: value rows (time/objective, altitude/gravity, deliveries/payload); then flight controls. The main engine always runs at 100% when held. The desktop console is 180 px tall;
the propulsion panel shows only fuel use and remaining fuel, with low fuel indicated by color.
Numbered console headings, the screen-direction caption, and the bottom footer are omitted.
The Menu/Esc button sits at the
flight view's upper-right; the navigation map and environment label sit upper-left,
with flight status messages and docking checks rising from the bottom-right of the flight view. The console keeps four columns on large
screens, switches to three columns on intermediate screens, and wraps to two or
one column on smaller screens. The orange usage meter rises with combined main,
attitude, and small-thruster fuel draw; more simultaneous thrust fills it
further.

Use the A/D rotation buttons on the control panel; heading is shown in the velocity dial.
Holding a turn gently increases its speed from 1.55 to 2.15 rad/s over two seconds.
Releasing or reversing resets the ramp; there is no rotational drift after release.
The bottom-console velocity dial keeps a rocket icon centered and rotates it with the
ship's heading. Its bright amber arrow shows actual drift in screen coordinates,
with fainter X/Y components and dashed projection guides; +Y points downward.
Arrow length is bounded to keep both tiny drifts and fast flight readable, so the
speed beside the dial (two decimal places, m/s) is the magnitude reference. The
rotation angle and signed X/Y speeds sit alongside it in quieter text. The separate rotation/speed telemetry
cells are replaced by these instruments. Stationary flight hides the arrow.

Use the amber target indicator and navigation map. Land within ±12° upright and
at ≤ 12 m/s. Dock within 32 m of the bay marker, at ≤ 8 m/s and ±12° upright. Your
rocket's nose must point up (0°) for docking. Station impacts below 30 m/s bounce;
impacts at 30 m/s or faster end the run. Surface impacts above 12 m/s through
25 m/s bump gently without landing or refueling; faster surface impacts crash. Rebound
speed is capped at 6 m/s, with at most 3 m/s away from the contact. Failed runs show a brief pixel explosion before the recorded result.
The enlarged destination indicator pulses once per second, or stays steady with
the browser's reduced-motion preference. Distance to the active relay or pad is
printed beside that indicator, both on-screen and at the edge; there is no
separate relay-distance telemetry cell.

Rotation already consumes attitude fuel. Paired cool-colored attitude jets now
show the turn direction. The K brake fires backward relative to the rocket's nose,
and cool exhaust particles show its thrust without separate RCS sprite
flames. Main engine thrust also appears as particles, with no static flame sprite.
Exhaust particles inherit the rocket's world velocity and drift with mild arcade
drag, so fast flight and turns leave motion-aware trails. Particles fade, clear
between runs/menus, and are capped at 360. Reduced-motion mode keeps the jet cues
and omits particle trails, including the brief cyan dash bursts. These effects do not change flight or fuel physics.

A compact docking checklist appears within 200 m of a bay. It shows live distance, speed,
and nose-up rotation requirements with checkmarks. Keep flying while it is open;
when all three checks pass, press E or Attach & Deliver. The checklist rises from the bottom-right of the
flight view and closes after delivery or when you leave the approach; it does
stay within the flight view with scrolling available on short screens; no camera offset is applied.

Your bay is on the rocket's right side. After delivery, use W main thrust to detach
and clear the receiver before turning toward the next pad. I/J/L controls and lateral
thruster buttons and the small forward thruster are removed. K retains its original strength and fuel use. Gas giants have floating pads and reduced atmospheric visibility;
Jupiter also has a small lateral wind. Distances and planet sizes are arcade scale.

## Saves and flight records

The game autosaves every second of gameplay and immediately after landings,
deliveries, or leaving the run. Refreshing opens the menu with **Continue Flight**
and **New Flight**. Replacing unfinished progress requires confirmation and keeps
the old run as an abandoned record. Switching tabs or losing window focus suspends
the simulation; Continue resumes with engines idle. The timer counts simulated
gameplay only, excluding menus and time away.

Flight Records shows up to 100 previous runs plus unfinished progress, including
time, fuel, deliveries, and a bounded leave/return/delivery timeline. Saves use
`orbitalFreight.v1` in this browser's local storage; they do not sync between
devices. Clearing browser data removes them. Blocked or full storage produces a
visible warning and falls back to memory. Unexpected termination can lose up to
the last second of progress; shutdown events are best effort.

Use a current browser over HTTPS or localhost. Safe persistent saving uses browser
Web Locks; browsers without that feature fall back to memory with a warning.

Continue transfers control of the saved flight to the current tab. Older tabs
return to the menu rather than overwriting newer progress or completed results.

See [FLOW.md](FLOW.md) for player flow and [assumptions.md](assumptions.md) for
tuning and implementation decisions to review. Physics values and destination
data are centralized in `public/scripts/rocketPhysics.mjs`.

## Verify the game

```sh
node --experimental-vm-modules --test tests/*.test.mjs
npm --prefix functions test
```

Use Node.js 22 or newer. Game tests use built-in Node modules and do not need
installed dependencies. The analytics tests use the existing Functions setup.
See [TESTING.md](TESTING.md) for coverage, emulator checks, and the playtest checklist.

## Legacy Functions-based analytics (not the production Spark log)

The following sections document the retained earlier implementation and its local
emulator tests. Their Functions/API deployment instructions do not apply to the
current direct-Firestore event log above. The old dashboard markup is retained only
as a test fixture at `tests/fixtures/legacyAnalytics.html`.

## Analytics: step 1 local preview

The custom homepage tracker is disabled by default. Add `?analyticsDebug=1` to
the homepage URL to enable a local preview, for example
`http://localhost:8000/?analyticsDebug=1`.

To serve locally without installing dependencies, run `python3 -m http.server 8000 --directory public`.

- Open browser developer tools. Enable Debug/Verbose console messages to see events.
- Run `window.websiteAnalytics.getSnapshot()` to inspect timing totals and up to 300 recent events.
- Click Start Flight and the menu controls. Each pointer click should have one `click`
  event and one `interaction` naming the nearest tracked control.
- Focus a menu button and press Enter. It should create an `interaction`
  without an artificial heatmap position.
- Use a short browser window to scroll. Check section exposure and scroll milestones.
- Switch tabs, wait, and return. `visibleMs` and `engagedMs` should exclude hidden time.
- Remain visible without input for more than 60 seconds. `visibleMs` should keep
  increasing while `engagedMs` stops until the next input or scroll.
- Reload the same tab with debug enabled. The session ID and timing totals should
  persist, but the in-memory event list starts again. After 30 minutes without
  activity, the next input or reload starts a new session.
- Remove the query parameter and reload to disable the custom tracker.

Click events include document coordinates, viewport/page dimensions, section/control
identifiers, and relative positions for the heatmap. `homepage-v3` identifies
the rocket game layout; `homepage-v1` identifies the previous homepage. Increment
the version when layout changes make old click positions incompatible.
Sections count as exposed when at least half of the section is visible. Section
exposure and recent input are estimates of attention, not measurements of boredom.

Local debug sends no custom analytics to a backend. The session summary uses
`sessionStorage`; detailed events stay in memory. Storage failures fall back to
in-memory tracking. Google Analytics and the existing Firestore visit counter run
independently through `siteAnalytics.js`; the game runs even if their CDN is blocked.
When enabled locally, the custom tracker records interactions and bounded game
lifecycle events. Production uses the independent free Google Analytics game
events described above. Full game records remain in the local flight recorder.

## Analytics: step 2 private ingestion

Production collection is disabled in `public/scripts/analyticsConfig.js`.
`?analyticsDebug=1` always stays local, including when collection is enabled.
The homepage can opt into local emulator collection with `?analyticsCollect=1`.
Other pages are not instrumented yet.

### Local verification

Use Node.js 22, Java 21+, and the Firebase CLI. Install backend dependencies with
`npm --prefix functions ci` if they are not installed already.

Run these from the repository root:

```sh
npm --prefix functions test
firebase emulators:exec --only auth,functions,firestore,hosting --project demo-website-analytics 'npm --prefix functions test'
```

The second command tests the real HTTP routes, authentication, and Firestore transactions,
including duplicate requests, invalid payloads, and denied public reads/writes. The first
command skips integration tests when the required services are not emulated. Browser-module
tests use Node's experimental VM module support; the warning is expected.

For manual verification, leave the emulators running:

```sh
firebase emulators:start --only auth,functions,firestore,hosting --project demo-website-analytics
```

1. Open `http://127.0.0.1:5050/?analyticsCollect=1`.
2. Start a flight, press flight controls, open the menu, and switch tabs.
3. Inspect `window.websiteAnalytics.getSnapshot()` in developer tools. `mode`
   should be `collection`; `collection.sentBatches` should increase after uploads.
4. Open the Firestore emulator at `http://127.0.0.1:4000/firestore`.
5. Inspect `analyticsSessions` for cumulative timing and the last meaningful action.
   Inspect `analyticsBatches` for the ordered events, coordinates, and layout version.
6. Reload the homepage. The session ID should persist and timing should increase
   without adding the prior totals twice.
7. Open `http://127.0.0.1:5050/?analyticsDebug=1`. This mode must produce no
   requests to `/api/events` and no new custom analytics documents.

Emulator data is temporary and disappears when the emulator stops. The demo project
avoids production backend access. When served on port 5050, the visit counter
connects to local Firestore; Google Analytics is skipped in emulator mode.
Do not use the Python static server for collection: `/api/events` needs the Firebase
Hosting rewrite. The collection endpoint accepts only the configured local origins.

### Storage and privacy

- `analyticsSessions/{sessionId}` stores cumulative visible/engaged timing,
  per-section exposure, last activity/action, last page, event counts, and server timestamps.
- `analyticsBatches/{batchId}` stores bounded event arrays and a session snapshot.
  `sessionId` and `pageInstanceId` allow later session timeline queries and ordering.
- Uploads run every 15 seconds and on visibility/navigation transitions. Retries
  reuse immutable batch IDs. A Firestore transaction updates the summary only once.
- Only the explicitly allowed homepage event fields are accepted. No text contents,
  form inputs, URL query parameters, or IP addresses are stored by application code.
  Hosting/platform request logs have their own access and retention settings.
- Existing Firestore rules deny browser reads and writes to both analytics
  collections. Only the backend writes through the Admin SDK. At this step, inspect
  data through the Firebase console or the owner-authorized dashboard endpoint.
- Requests are limited to 48 KB and 40 events. A session accepts at most 20 batches
  per minute and 1,000 batches total. Function instances are capped at two; these
  settings and App Check reduce abuse but do not establish a hard spending cap.
- The browser queue is memory-only, capped at 20 batches with at most eight upload
  attempts per batch. The event history retains 300 events. Lost connections or a
  closed browser can lose unsent data; delivery on exit is best effort.
- Client times allow five minutes of clock skew; sessions older than 24 hours are
  rejected. Anonymous session IDs are random, with no persistent visitor identity.
- Both collections include `expiresAt` for a proposed 30-day retention period.
  **Automatic deletion is not active until TTL policies are configured for both
  collections.** Production TTL setup remains part of the deployment checkpoint.

### Production setup checkpoint

Deployment and production collection still require verification and approval:

1. Confirm Blaze billing and budget alerts, backend IAM, and the deployed Firestore rules.
2. Register this Firebase web app with App Check using reCAPTCHA Enterprise and the
   actual hosting domains. Put the public site key in `analyticsConfig.js`.
3. Set `ANALYTICS_ALLOWED_ORIGINS` in the function environment if using a custom
   domain (comma-separated exact HTTPS origins). The default permits the project's
   `.web.app` and `.firebaseapp.com` domains. `ANALYTICS_APP_ID` defaults to this web app.
4. Deploy the function and Hosting rewrite in a separately approved step. Verify
   that missing/invalid App Check tokens are rejected. Emulator bypass requires
   server-set emulator variables plus loopback Firestore; request fields cannot enable it.
5. Configure and verify TTL for `expiresAt` in both collection groups.
6. Enable `collectionEnabled` only after the deployment checks pass.

Application logging records accept/reject reasons, counts, duplicate status, and
backend error codes, without logging tokens or event bodies. TODO: remaining-page
instrumentation and production rollout.

## Analytics: step 3 owner dashboard

Open `/analytics.html` for the dashboard. It uses its own stylesheet and script;
the dashboard does not load the visitor tracker or Google Analytics.

- Sessions list observed duration, visible time, engaged estimate, and recorded
  event counts. Counts include system events, not just user actions.
- Select a session to inspect section exposure and its ordered action timeline.
- Named interactions, pageviews, section exposure, and scroll milestones appear
  by default. Enable "Include raw clicks and system events" to inspect every event.
- Timeline counts explicitly describe loaded events. "Load more" retrieves another
  bounded page; newly loaded events are merged and sorted by recorded time.
- Refresh reloads recent sessions. There is no background polling or automatic
  download of the entire database.
- The sign-out action immediately clears rendered analytics and aborts pending reads.

### Verify owner access locally

Run the full emulator integration command above at least once. It creates two
local-only test accounts. To retain these accounts for manual verification, start
all four emulators and run tests while they stay running:

```sh
firebase emulators:start --only auth,functions,firestore,hosting --project demo-website-analytics
```

In a second terminal:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm --prefix functions test
```

Test credentials apply only to the local demo project:

| Account | Email | Password | Expected access |
| --- | --- | --- | --- |
| Owner | `owner@example.test` | `localOwnerOnly123!` | Sessions and timelines |
| Other user | `other@example.test` | `localOwnerOnly123!` | Access denied |

1. Open `http://127.0.0.1:5050/analytics.html` and sign in as the test owner.
2. Confirm the previously recorded sessions appear. Tests also create sample records.
3. Select a session, inspect the timeline, and toggle system events. Use "Load more"
   if the session contains more than 25 batches.
4. Generate fresh actions in `http://127.0.0.1:5050/?analyticsCollect=1`, wait for
   upload, then use Refresh in the dashboard.
5. Sign out. The session table and timeline should disappear immediately.
6. Sign in as `other@example.test`. The dashboard should show an access-denied
   message and no session records.

The backend reserves `analyticsLocalOwner` only when Functions, Firestore, and Auth
all run in the local `demo-website-analytics` emulator project. The client uses the
same demo project for Auth. Production never accepts these local test credentials.
The emulator is a development tool, not a production authentication boundary.

### Production authorization checkpoint

Production still requires a separately approved deployment:

1. Enable Google as a Firebase Authentication sign-in provider and authorize your
   actual hosting domains. The production dashboard presents Google sign-in only.
2. Find your account's Firebase Authentication UID and set `ANALYTICS_OWNER_UID`
   in the `readAnalytics` function environment. This must be your Firebase UID,
   not your Google account ID or email address. Missing configuration denies access.
3. Do not configure `FIREBASE_AUTH_EMULATOR_HOST` in production. The backend rejects
   incomplete or unsafe emulator configurations.
4. Deploy `readAnalytics`, its Hosting rewrite, and `firestore.indexes.json`.
   Wait for the `analyticsBatches` index on `sessionId` and `receivedAt` to finish
   building. Emulator success does not verify production index availability.
5. Verify owner access, another account's denial, and sign-out against the deployed
   site before enabling production collection.

Every read verifies the Firebase ID token, checks revocation/disabled accounts,
and compares its UID with the backend owner setting. Production also requires a
verified Google identity. The server returns up to 25 sessions or batches per
request, using document cursors for pagination. Responses are marked `no-store`.
Firestore rules remain unchanged and deny direct browser reads, including reads
from the owner account; the authenticated backend is the dashboard's only data path.

## Analytics: step 4 homepage click heatmap

The owner dashboard includes a Homepage click heatmap below the sessions and timeline.
It uses the existing owner-authorized endpoint; there are no new dependencies or
changes to public Firestore access.

### Verify the heatmap locally

1. Open `http://127.0.0.1:5050/?analyticsCollect=1` and click several times near one
   spot, then press other flight controls and menu buttons. Wait 15 seconds for upload.
2. Open `http://127.0.0.1:5050/analytics.html` and sign in as the local test owner.
3. Scroll to Homepage click heatmap. Choose upload dates covering your test and
   leave the layout version as `homepage-v3`. Select Load heatmap.
4. If the status says Partial data, use Load more batches until all batches in the
   range have been scanned. Loaded counts remain explicitly partial until then.
5. Choose the recorded viewport/page size matching the browser window used in step 1.
   Each option shows its own click count. Different dimensions are kept separate.
6. Inspect the colored cells and element click counts. The repeated-click spot should
   have the highest density in that group. The script-free preview shows the
   initial menu and static cockpit; it cannot replay the game canvas or runtime
   menu/history/result states. Scroll the surrounding panel horizontally if the recorded
   viewport is wider than the dashboard.
7. Resize the test website, record more clicks, and load the heatmap again. A different
   recorded geometry should appear instead of moving the original group's points.
8. Sign out. The preview, coordinates, and count table should disappear. A non-owner
   account must not be able to load heatmap data.

The current preview is an inert copy of the public homepage and its stylesheet.
It strips scripts, active resources, event handlers, and navigation attributes,
then adds a restrictive Content Security Policy. The iframe sandbox permits
parent DOM access for adding static SVG cells but does not permit scripts, forms, or popups.
See [MDN's iframe sandbox reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox).
The overlay uses SVG because a canvas displays fallback content when scripting is
disabled in its document; see the [HTML canvas specification](https://html.spec.whatwg.org/multipage/canvas.html).
The preview must not create visits, increment counters, or upload visitor events.

### Interpretation and limits

- Date inputs use **upload dates in UTC**, inclusive at both calendar-date ends.
  They filter batches by server `receivedAt`, so a delayed upload belongs to the
  date it reached the backend. Choose at most 31 days per scan.
- Each request scans up to 25 batches. Batches without matching clicks still
  count toward pagination. Only homepage `click` events for the chosen layout
  are returned; keyboard interactions do not generate invented positions.
- Groups use exact viewport width/height and document width/height, plus layout
  version. `/` and `/index.html` are treated as the same homepage.
- The overlay bins original document coordinates into 24 × 24 CSS-pixel cells.
  It does not add scroll offsets again. Blue-to-red colors indicate fewer-to-more
  clicks relative to the highest-count cell in the selected group. Counts are raw
  clicks, not click rates normalized by section exposure.
- Only `homepage-v3` has a current page preview. Historical `homepage-v1` and other layout versions can show
  counts but do not borrow this preview. Update the tracker version and the
  supported preview whenever layout changes make old positions incompatible;
  old page snapshots are not archived by this implementation.
- If the current rendered page dimensions differ from a recording by more than
  two pixels, the overlay is withheld and counts stay available. This catches
  obvious geometry changes; it cannot detect every content rearrangement, which
  is why layout versioning remains necessary.
- Previews are limited to 5,000 pixels wide, 12,000 pixels high, and 16 million
  document pixels. Larger geometries retain their count table without an overlay.
- The dashboard keeps at most 20,000 clicks per scan in memory. Reaching that limit
  is labeled incomplete; narrow the date range to inspect all clicks.
- The date scan uses the existing single-field `receivedAt` index. No new composite
  index is required beyond the session timeline index already configured.

Automated checks cover geometry partitioning, scroll-coordinate binning, sanitizer
operations, date validation, pagination across empty batches, owner authorization,
and clearing the heatmap on sign-out. Actual browser rendering and visual alignment
remain part of manual verification. Custom production collection and Functions
deployment remain disabled on Spark; the game and analytics overview are published.

Docking approach uses a compact `[E] to dock` prompt beside the station instead of the old orientation/speed checklist. An unsuccessful E press shows a red reason beneath the prompt for four gameplay seconds. Attached relay hacking and upgrade controls remain available.

The station prompt stays anchored to the relay as the camera moves. Failed docking shows only `NOT IN RANGE`, `SLOW DOWN`, or `UNAVAILABLE`. The player-centered map is zoomed out 20% from the previous view and shows planets and stars as circles sized by radius.

Owned relay shops show side-by-side planet and rocket previews. Press **T** or click the planet button to buy its next defense tier at the displayed cargo cost. **R** buys the next rocket upgrade at the displayed cargo cost. Holding T never repeats purchases.

The shop places Rocket on the left and Planet on the right. Paid upgrades cost 2, 5, 10, 17, 26, 37, 50, 65, 82, then 101 cargo, where the track has that many paid levels. Prices appear as a yellow number with a cargo-crate icon. During capture, the dock/detach action is hidden; leave the planet's interaction range to abandon the attempt. Multiplayer home stations are selected randomly from eight sites separated by at least 5,000 world units. Vega and Ember are moved 25% closer to Sol.

Owned relay shops display a large “BUY UPGRADE” heading below the relay name.

Gas and ice giant approaches use a clear flight view, without the atmospheric tint or low-visibility banner.

Home planets produce no cargo and have no relay or relay collision; they remain refueling refuges. Legacy home cargo pods are removed on the next simulation step. The Moon sits 1,100 world units above Earth, and new runs start with flashing Moon relay guidance. Capture plays a one-second expanding shield in the player's color and adds a colored announcement to the borderless local chat feed above fuel. Press `/` to type, Enter to send, or Escape to close. Chat is local-only, bounded to 40 lines, and never saved or uploaded to analytics. The minimap player marker is larger and nearly white. System stars are 50% larger with brighter colors and a broad glow.

The chat hint reads “Press / to chat.”; opening chat replaces that line with a faint rectangular input without moving the feed. Initial Moon relay guidance uses a larger arrow and the large caption “CAPTURE PLANETS TO GAIN CARGO,” which disappears after the first capture.

Cargo within 200 world units gently accelerates toward a live player, with attraction fading to zero at the edge. Distant cargo keeps its existing drift or orbit. Neptune sits directly below Earth, opposite the Moon. Planetary orbit spacing is reduced to 2,000–2,900 units and system centers are 35% closer; planets, relays, and stars retain their tested clearances. Saved landed/docked ships follow relocated pads and relays.

The capture panel reads “CAPTURE PLANET,” “CAPTURE STAR,” or “CAPTURE BLACK HOLE.” Fresh E presses advance the pie; simultaneous players race in separate sectors, and the first to finish takes ownership. Leaving range, dying, or disconnecting resets that pilot's progress.

Latest multiplayer capture/combat update: stars and the black hole are capturable with the same E-spam race as planets, requiring twice and three times the neutral planet press count respectively. Their interaction radii are 750 m and 1,600 m; first capture gives level one, one floating turret and a small colored Dyson shield. Stars produce five-value cargo; the black hole produces ten-value pods. First capture finisher wins; the new owner repels enemy rockets for five seconds, matching the recapture lock. Enemy turrets pulse red and burst into particles when destroyed. Player shots deal eight fuel damage and have a 5 m larger hit radius. Captured fields start at 190 m, grow 30 m per level, slow hostile rockets and deflect/slow hostile bullets; faint dotted rings show the approximate 1,700 m turret lock range. The original planet capture radius remains 250 m.

Gun tips heat with firing and lock fire for 2.5 seconds while cooling. Overheating emits no steam: the aim cursor blinks red with a shrinking cooldown pie that empties when firing becomes available again. Shots add a small opposite-direction impulse in flight. Cargo orbital speed varies by ±14%.

Chat messages, hint, and typed input share the same font size and left text edge.

## Multiplayer implementation

The Node server, durable shared galaxy, browser connection, remote ship rendering,
room chat, reconnect handling, and four rocket tiers are implemented locally.
Run the service only after the class-box manual setup is complete; see
[server/README.md](server/README.md) for assigned-port and `svc` instructions.
Configure the public endpoint in `public/scripts/multiplayerConfig.mjs` after
the box is ready. Empty configuration retains local practice. The published
Firebase site is not changed automatically by editing this repository.

Rocket tiers cost 8, 16, 28, and 40 cargo initially. R buys the next rocket tier
at an owned relay; T buys the attached planet's defense. Death removes one rocket
tier and shows the loss during respawn. Saved multiplayer state and reconnect
credentials are separate from old local conquest saves. Chat is broadcast within
the room but not persisted or uploaded to analytics.

The Firebase game frontend is aligned with the deployed starter-station/planet-service version. Hover prompts show their action without a persistent OUT OF RANGE caption; interaction distance checks still apply.

Eighteen neutral rogue planets sit outside the three star systems. They use the same capture, cargo, and upgrade rules as other planets. Owned stellar pods stay separate and steer toward their owners within 520 m at stars and 850 m at the black hole. Pods stay at least 65 m outside stellar turret rails.

New pilots get the available starter station nearest the black hole at the map center, subject to the 2,000-unit separation rule. Three inner stations sit about 3,000 m from the black hole. Outer stations fill as inner sites become occupied.

The expanded map centers its 8,400 m galaxy outline on the black hole. Outer planets are packed closer inside that outline.

Sol, Vega, and Ember are spaced 120 degrees apart around the black hole.

The dotted galaxy edge marks where outward drag starts. Resistance rises farther outside the map. Pilots can still fly across the edge and return freely.

Planet fuel zones are 192 m wide and reach 170 m above the pad. The drawn zone and refueling use the same bounds.

The first flight entry shows a five-second intro at the top. That banner also shows private alerts when the last turret is destroyed or another pilot captures your territory.

After a successful capture, the confirmation tells pilots to aim at the captured world and press E to upgrade. The first capture arrow is larger both on screen and at the edge of the flight view.

A dotted cursor guide points to a world within the rocket’s interaction range even when the cursor is away from it. An owned fuel zone draws a yellow dotted line from its pad to the ship whenever the ship is inside. Captured planets use the doubled production rate for as long as they are owned, and surface impacts on owned planets bounce without fuel damage.

All three star systems and their planets are available from the start in an 8,400 m galaxy. When ten pilots are connected at once, the boundary expands to 10,000 m. The original worlds and eight starter stations keep their coordinates. Four extra starter stations give the room capacity for twelve pilots. The boundary stays expanded until the room is empty.

Multiplayer shops show the server's price quote for each purchase. A changed quote requires a fresh purchase attempt before any cargo is charged.

Owned planets release individual orbiting cargo pods that persist while the planet is owned. Existing planet bundles are moved into reserve and reissued as separate pods. Each world can store 60 production units across its pods and reserve. The galaxy supports up to 2,048 floating cargo pickups.

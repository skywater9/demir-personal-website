# Local conquest verification

## Automated checks

Run from the repository root using the already-installed Node.js runtime:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
npm --prefix functions test
```

The conquest tests use the shipped page/controller and real simulation:

- World generation, gravity, safe landings, collision sweeps, stars, fuel-empty
  coasting, decelerating owned-pad refill, and cargo production/collection.
- Neutral/hostile relay hacking, wrong/repeated digit rejection, cancellation,
  ownership transfer, cargo spending, and defense tier limits.
- Fuel damage: shot loss, speed-scaled impact loss, equal/insufficient/zero-fuel
  boundaries, one damage event per contact, white leak particles, and single
  death/drop/respawn. Damage outcome logs exclude contact coordinates.
- Projectile hit, shield and turret refuge rules, drops, pickup, death and respawn.
- Braking slows forward travel by 34 m/s per second in every heading at its
  existing fuel rate; main thrust remains 68 m/s².
- Cursor steering acceleration, reversal inertia, shortest angular path, fuel use,
  actual-nose thrust, screen-scaled aim and a dashed cursor guide. A 90° turn
  reaches within 1° of the cursor in 0.8 seconds without snapping.
- Actual homepage IDs and button/key handlers, docking/hacking/upgrades, menus,
  self-destruct confirmation, record retention, and 30-second refresh expiry.
- Renderer geometry for all systems/planet types/shield tiers, map hit tests,
  centered nozzle particles, death frames and reduced-motion dash cues. Rotation
  jets stop for sub-degree corrections and turn rates below 0.4 rad/s without suppressing
  main-engine or brake exhaust. Braking emits one plume along world velocity; turning
  uses one of the same two nozzles, without duplicates when controls overlap.
  Braking increases plume density, speed and particle size over ordinary turning.
- Camera zoom changes continuously across former speed thresholds, eases during
  camera recenters, stays consistent across frame rates, and retains service views.
- Combined fuel display: backward usage overlay anchored to remaining fuel,
  quarter-scale proportional draw, low/empty tanks, idle/docked/dead states, and fuel ARIA values.
  Damage sweeps combine with active consumption, expire, and reset on new games
  without replaying events or delaying the actual fuel readout.
- Anonymous outcome projection, firing/hacking aggregation, readable owner logs,
  append-only writes, and historical data compatibility.

The old story modules remain for compatibility checks. `tests/fixtures/storyGame.html`
is their archived UI fixture; the actual homepage is tested by conquestApp tests.
The legacy route pilot uses real fixed-thrust pulses and physics without adding
fuel, moving the rocket directly, or skipping its delivery-win assertions.

Firestore integration needs Auth/Firestore emulators and Java 21+. Run with the
existing Firebase CLI and dependencies, using a temporary config that references
`firestore.rules` and chooses available local ports. Normal unit runs skip that
integration check when emulator environment variables are absent. These tests use
only `demo-website-analytics`, never production data.

## Local playtest

```sh
python3 -m http.server 8001 --directory public
```

Open <http://localhost:8001/>. Start a new local galaxy. There are no opponents,
bots, game server, or account requirements. Localhost never uploads event logs to
production. Use a private tab for independent fresh play.

1. Verify menu/briefing/tracking notice, empty records, one searchable local galaxy,
   failed search, and ordinary keyboard focus. At phone size, controls wrap and
   menus/notifications scroll without hiding their buttons.
2. Play. Earth is owned/home and every other planet is neutral. Three scattered
   systems and their lethal stars appear on the top-right map. Choose a relay by
   clicking its planet or using the destination selector.
3. W burns at full power; S brakes. Mouse/trackpad steers the hull with slight lag;
   the dashed guide and small cursor show the requested direction. Space shoots
   without firing a thruster, including while a thruster button is focused.
   Enter holds a focused control. A/D do not turn the hull; double-tap A/D
   for left/right dashes, with 1% fuel and a shared two-second cooldown. Double-tap
   W/S must only burn/brake and must not dash or spend burst fuel.
4. Fly to a neutral relay, slow below 8 m/s, stay within 32 m and point upright
   within 12 degrees. E attaches. Enter the displayed digits. Wrong inputs and
   held key-repeat do not complete a hack. E detaches and resets progress. No
   firing is possible while attached. Capturing resets level/stock and colors the planet.
5. Select its pad and land upright at 12 m/s or less. Cargo collects automatically;
   wait with partial fuel to see rapid early refill that slows near full. Home
   refills faster. Neutral/hostile pad landings never grant cargo or fuel.
6. Return to the owned relay with cargo. Check next upgrade name/effect/cost,
   insufficient-cargo state, and purchases: bullet barrier, turret, outer field.
   Only that planet changes. Home says protected; the final tier has no purchase.
7. Take a fast bump with enough fuel: check fuel loss, white leak particles and
   gentle rebound. Repeat faster and verify greater fuel loss. Damage exceeding
   remaining fuel is fatal; equal damage leaves zero fuel. A shot at zero is fatal.
   Contact a star while carrying cargo. Check the explosion, floating cargo,
   home respawn, full fuel and retained territory. Recover a pickup. There are no
   hostile ships in this version; hostile defense/shot behavior uses automated fixtures.
8. Empty the tank. Coast/aim/fire behavior remains available as applicable; powered
   turning and thrust stop. Cancel the self-destruct confirmation, then confirm it.
   Confirm dropped cargo and home respawn.
9. Open Menu while moving: input releases but the galaxy keeps running. Refresh
   within 30 seconds: Continue restores coasting/production state. Return after
   more than 30 seconds: the world expires and its summary remains in records.
   New Galaxy requires confirmation. Earlier story records remain accessible.
10. On the live site, check event-log delivery status in the menu, walk the flow,
    then sign in to `/analytics.html` as owner and read saved events in order.
    Confirm no typed search, hacking digits, mouse position or identity appears.

## Release checks and limits

Check JavaScript syntax, HTML ID uniqueness/nesting, linked asset availability,
module MIME types, and consistent cache versions before publishing static assets.
Deploy the updated logging rules alongside Hosting, after emulator validation.
Keep legacy record storage unchanged. No database migration or billed backend is
needed for this local release.

The in-app browser connection was unavailable during this implementation. Canvas
and DOM fixtures validate code paths, not final visual composition or flight feel.
Human playtesting is still required for difficulty, timing, readability and touch aim.

Session storage may be denied or cleared by the browser; a visible warning explains
memory-only play. Closing a tab permanently may clear its local world. Analytics
uploads are best effort and remain subject to the existing free Firestore quotas.
A galaxy reaching all planets continues as a sandbox; there is no invented win screen.

## November 18 local conquest release verification

- 120 tests passed in the full game/event-log suite; its emulator-dependent rule
  test was separately executed and passed against real Auth/Firestore emulators.
- 37 analytics tests passed; two older Functions integration tests remain skipped
  because this release uses direct Spark event logging, not Functions.
- The conquest subset includes simulation, actual-page controller, storage,
  renderer, and mouse steering checks. The final main thrust is 68 m/s² and the
  speed has no cap; sustained thrust and side dashes can exceed 500 m/s.
- Static HTTP checks cover 13 game/analytics assets and JavaScript module MIME
  types. Homepage nesting/ID uniqueness and JavaScript syntax checks passed.
- No browser connection was available; no visual browser playtest is claimed.

## Shared galaxy checks

- Frontend and existing rule regression checks: `node --experimental-vm-modules --test tests/*.test.mjs`.
- Shared-room, protocol, and persistence checks: `node --test server/tests/*.test.mjs`.
- Network tests use two real localhost WebSocket clients, never the class box.
- Coverage includes one shared clock, distinct homes, exclusive docking, projectile
  targeting, pickup ties, upgrade transactions/replay rejection, private snapshots,
  chat non-persistence, restart recovery, and corrupt-save refusal.
- Browser-facing checks verify endpoint validation, bounded commands, pending
  acknowledgments, and that online UI does not simulate movement or purchases locally.
- Real two-browser visual playtesting and class-proxy deployment verification remain
  required after the student's box is ready. Automated network tests do not replace
  that visual/latency check.

Latest local multiplayer verification: 161 frontend/rule checks passed, one
Firestore-emulator check skipped because its emulator was not running, and all
13 shared-server checks passed. The server checks used localhost clients and
included a real service restart. Browser/device visual testing and the class
proxy/service deployment have not been performed.

## Multiplayer damage, map, and heat feedback

- With two nearby pilots, shoot the other rocket: both views should show its brief red hull flash. A damaging station/surface bump should also flash red; ordinary safe contacts should not deduct fuel.
- Fly across the midpoint between two stars: map markers must move smoothly and their spacing must match world distances. Click targets on either side of that boundary.
- A captured planet now generates 3 cargo per 10 seconds, with roughly one pod every 3.34 seconds. Existing cargo is retained.
- Hold fire until overheating: no gun steam should appear. The aim cursor blinks red and its cooldown pie drains to empty over 2.5 seconds. With reduced motion, it stays steady while the pie drains.
- Backend updates require pulling the commit in the existing project and restarting with `svc restart game`; frontend changes alone do not change authoritative production or remote hit feedback.

## Turrets, onboarding, map pilots and room activity

- Compare the same turret from its owner and attacker's views: its barrel should track the same enemy even between shots. Test a nearer enemy, relay refuge, planet occlusion, and a disabled turret.
- Fire five hostile shots from inside its ordinary bullet shield. Its small bar loses health per hit, refills during a 10-second disablement, and disappears at full health. Extra hits during recovery do not restart it. Friendly and externally shield-blocked shots do not damage it.
- Spawn pilots in all eight home slots: each starts toward a neutral relay and sees the large cargo/capture guide until their first capture.
- Fly outside nearby-ship range: the other pilot stays on the map, with a direction marker if beyond its bounds, while the flight view keeps its visibility limit.
- Watch chat from a second connection while a pilot joins, gets destroyed, disconnects, returns within 30 seconds, and explicitly leaves. Confirm correct generated labels and colors, one announcement per transition, and no chat content in durable saves or analytics.
- At zero fuel, holding Space must not self-destruct. Release and press once to accept the warning above the map, or click its button. With fuel, Space still fires; typing in chat cannot self-destruct.
- Visual browser checking was unavailable during this implementation; rendering and interaction are covered by automated checks, with real local WebSocket lifecycle tests.

## Turret added by every planet upgrade

- Buy tiers one through three: check one, two, then three turrets spaced in stable surface slots. Shield effects and prices remain unchanged.
- Shoot each turret from inside the shield: only that turret loses health and disables. Other turrets keep aiming and firing if they have line of sight.
- Upgrade while a turret is damaged or recovering: its state and position must remain intact. Capture or owner departure clears all turret state.
- Restore a legacy single-turret save: preserve that gun's health/aim/recovery and create the additional turrets for the saved tier. Restart and recover the new independent turret state.

## Braking in all directions

- At several headings, hold S while moving forward, backward, sideways, and diagonally. Both velocity components must fall to zero without reversing; release S to coast or fall again.
- One brake plume points along full world velocity regardless of hull angle, with stronger emission at higher speed. Rotation alone emits none.
- Check another pilot sees the same velocity-dependent brake plumes. Braking on a serviced ship must not launch or detach it, and an empty tank cannot provide braking.

## Predictive turrets and inner-bubble cargo

Run `node --test tests/planetDefenseCargo.test.mjs tests/stationPrototype.test.mjs`.

- Fly sideways across turret view: its barrel and shots should lead the current trajectory. Fast unreachable targets must not cause invalid aim or projectile speeds.
- The inner planet bubble and visible capture-range ring share their exact edge; starter-station shields retain their current radius.
- Enter an owned planet's bubble: its pods outside the normal 200 m pickup magnet should approach gently, at a target maximum of 40 m/s. Opposite-side pods should route around the planet and remain outside its surface. Leave the bubble and distant pods keep drifting/orbiting.
- With two pilots nearby, the nearest eligible collector attracts a pod, and an outside rival beyond normal pickup range does not prevent bubble attraction.

## Capture races, one-hit turrets and black-hole update

Run `node --test tests/planetCaptureRace.test.mjs tests/planetDefenseCargo.test.mjs tests/planetInteraction.test.mjs tests/planetServices.test.mjs tests/stationPrototype.test.mjs`.

- Each active hacker fills its own equal sector. Enemy progress, enemy ownership outlines and takeover flashes are red from the viewer's perspective, including on neutral planets. Duplicate local/public summaries must not create extra sectors.
- First completed capture owns the planet; other capture panels exit immediately, stale final digits cannot steal it, and recapture stays blocked for five seconds. The new owner's shop remains usable.
- One hostile bullet destroys a turret, it stays gone after the former recovery interval, and all guns must be destroyed before capture. Friendly fire and shield interception retain their rules.
- The base gun fires eight consecutive shots before overheating and remains blocked during the unchanged cooldown.
- The larger black hole is above the system center, pulls from farther away, and remains lethal. Its game rendering and map marker show a warm disk around a dark core.
- Hover arrowheads keep pointing to off-center cursor positions inside a planet, independently of planet highlighting.

## Surface contacts and circular black-hole rings

Run `node --test tests/landingContact.test.mjs tests/planetInteraction.test.mjs`.

- Slowly bump the left, right or underside of an owned planet. The rocket rebounds near contact and does not acquire a landing flag or move to the pad. Check a genuine upright pad landing stays at its actual contact point and still refuels.
- Repeat side contact in shared multiplayer and restore an older invalid side-contact save; neither should snap the rocket to the top pad.
- Black-hole rings are circles in flight and on the map. Particles travel on circular orbits; reduced motion keeps their positions static. Gravity, core size and placement are unchanged in this visual revision.

## Owner-only cargo, homing turrets and scaled capture codes

- Planet pods remain inside the inner bubble, including at high velocity and after restoring old out-of-bounds pods. Their drawn sprite/glow is clipped to the bubble too. Rivals cannot attract or collect them; changing ownership transfers collection rights immediately. Death cargo remains shareable.
- Foreign pods are low-opacity gray without a gold glow. Owned pods are gold; larger cargo bundles have larger sprites and stronger, bounded glow.
- Owner attraction is stronger near the planet surface, with a 100 m/s approach-speed target and up to 100 m/s² steering. Pods still route around the solid surface.
- Turrets fire again after 1.4 seconds. Their bullets turn at no more than 0.28 rad/s toward the original target and preserve current speed. Player bullets do not home, and dead/missing targets stop steering.
- Capture difficulty: tier 0 = eight presses, digits 1–3; tiers 1/2/3 = 10/12/14 presses, digits 1–4/1–5/1–6. Wrong and held keys retain their rejection rules. Old partial captures reset on restart.

## Twenty-level defenses, repairs and capture continuity

- Run `node --test tests/planetUpgradeRepair.test.mjs tests/stationPrototype.test.mjs` for all twenty purchases, equal turret spacing, maximum-level shield penetrability, atomic repairs/cooldown/range/ownership validation, save recovery, and cursor-independent capture with range reset.
- Run `node --test --test-name-pattern='planet owners' server/tests/network.test.mjs` for private owner alerts, cooldown rejection, saved repair outcomes and duplicate-action protection over real WebSocket connections.
- In two browser windows, capture a planet, buy upgrades and shoot a turret from the other pilot. Only the owner should receive the destruction notification. In its shop, wait five seconds and repair for twice the level; a second click must not charge again. Upgrade again while another gun is destroyed: that gun stays destroyed and all slots redistribute evenly.
- Start capture, move the cursor elsewhere and continue entering numbers. Fly out of range: the panel and progress clear. Re-enter and initiate capture again: progress starts at zero. Confirm the fuel pad displays large FUEL.
- Earlier three-stage shield, automatic turret recovery and cursor-cancel checklist entries above are historical and superseded by this section.

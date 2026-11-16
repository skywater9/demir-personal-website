# Game verification

## Automated checks

Run with Node.js 22 or newer:

```sh
node --test tests/*.test.mjs
npm --prefix functions test
```

- Physics tests cover destination order, gravity falloff, Earth/Jupiter launch,
  fuel use and depletion, unsafe impacts, docking gates, payload transitions,
  one-time refueling, all ten deliveries, alignment after a stationary landing,
  station structure impacts, and fast glancing collisions.
- A complete-route controller test uses only throttle, translation thrusters,
  and the attach action. It verifies that all ten deliveries are reachable with
  cumulative fuel and automatic pad refueling; no position, velocity, or fuel
  shortcuts are allowed. This is a feasibility check, not a measure of human difficulty.
- Storage tests cover refresh recovery, results, duplicate archival, malformed
  saves, blocked storage, semantic progression invariants, and stale-tab checkpoint
  rejection, including an interleaved takeover/archival under a shared lock.
  Expected warning logs exercise failure paths.
- App tests parse IDs and controls from the actual homepage, then exercise its
  event handlers with a small DOM fixture: launch, mixed controls, suspension,
  offline time exclusion, Continue, New Flight confirmation, retry, win, history,
  modal keyboard focus, and transfer of flight control between tabs.
- Renderer tests exercise canvas drawing paths and reject non-finite coordinates.
  They verify execution, not visual composition.
- Existing analytics tests cover strict ingestion, retry/deduplication behavior,
  game control allowlists, owner access, inert heatmap previews, geometry guards,
  and separation of old/new homepage layouts.

For backend integration, use Java 21+, the Firebase CLI, and the existing
Functions dependencies. This command uses the demo project and temporary emulator
data; it does not deploy to Firebase:

```sh
firebase emulators:exec --only auth,functions,firestore,hosting --project demo-website-analytics 'npm --prefix functions test'
```

## Browser playtest

Start the static server described in README.md, or use the Firebase emulators for
local analytics collection. The in-app browser was unavailable during initial
implementation. Automated DOM/canvas fixtures do not replace visual playtesting.

1. At desktop size, confirm that the menu, flight scene, telemetry, docking
   controls, and bottom control panel fit and remain readable. Check a narrow
   mobile viewport, portrait and landscape, and browser zoom.
2. Start a run. Hold Space to lift off, rotate with A/D, and release to coast.
   Verify that I/J/K/L change velocity in world directions and use less fuel.
3. Approach the Earth relay's amber bay marker. Brake, align upright, and press E
   when all three checks are green. Confirm one delivery and a Moon pad target.
4. Use left RCS (J) to clear the receiver, then fly to the Moon. Land upright at ≤ 8 m/s. Confirm automatic refuel,
   new payload, Moon relay target, and changed gravity. Off-pad contact must not
   refuel; the same route stop must not grant fuel twice.
5. Check the full route, including the Earth return. Inspect floating pads,
   reduced visibility on giant planets, and Jupiter's wind. Tune fuel, flight
   distances, and thrust in `rocketPhysics.mjs` after human playtesting.
6. While moving, open the menu, refresh, and Continue. Verify position, velocity,
   fuel, and time resume. Switch tabs and switch apps; neither background physics
   nor offline time should accrue. Pressed controls must be released on suspension.
7. Cancel New Flight and verify saved progress remains. Confirm New Flight and
   verify the old run appears as abandoned. Inspect the event timeline.
8. Crash at excessive speed, then Retry. Confirm recorded time/fuel and a fresh
   Earth start. Check final Neptune delivery produces a win and a persistent record.
9. Navigate menus using Tab, Shift+Tab, Enter, and Escape. Focus must stay inside
   dialogs. Test held buttons with Space/Enter and simultaneous touch controls.
10. Load `/?analyticsDebug=1`, interact with controls, and inspect
    `window.websiteAnalytics.getSnapshot()`. The layout must be `homepage-v2`.
    Held pointer controls should record one press without a duplicate click.
    Use `/analytics.html` with the emulator owner to inspect v2 heatmaps and v1
    historical counts. The inert preview must run no visitor scripts.

## Known limits

- Saves are browser-local, bounded, and subject to storage availability.
- Abrupt process termination can lose the most recent second of progress.
- The heatmap previews the static initial UI, not moving scenery or past UI states.
- Production analytics collection remains disabled pending the existing App Check
  and deployment verification. Game lifecycle records are local, not backend events.
- Human flight-feel and visual testing remain necessary when a browser is available.

## Implementation verification

Verified on November 15, 2026, with Node.js 26 and Java 21:

- 29 game tests passed, including asynchronous save transactions and a full
  control-only journey (1,957.9 simulated seconds, 96.0 fuel remaining).
- 29 analytics tests passed with Auth, Functions, Firestore, and Hosting emulators;
  no tests were skipped in that emulator run. Temporary alternate Firestore,
  Auth, and Functions ports avoided an existing service on port 8080. The tracked
  Firebase configuration was unchanged. The emulator used the host Node.js runtime;
  the configured deployment runtime remains Node.js 22.
- Static HTTP checks verified the homepage, linked assets, and JavaScript module
  MIME types. HTML tag nesting, JavaScript syntax, and Git whitespace checks passed.
- No in-app browser connection was available; no visual browser pass is claimed.

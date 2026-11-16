# Orbital Freight

A buildless, pixel art rocket game with continuous 2D flight, changing planetary
gravity, payload deliveries, and a limited fuel supply. The game is the homepage;
the existing private analytics dashboard remains at `/analytics.html`.

## Play locally

```sh
python3 -m http.server 8000 --directory public
```

Open `http://localhost:8000/`, read the pre-flight briefing, and choose **Start
Flight**. No build or dependency installation is needed for the game.

| Control | Action |
| --- | --- |
| Hold Space or Up | Burn the main engine; release to coast |
| W / S | Increase / decrease throttle by 5% |
| A / D or Left / Right | Rotate counterclockwise / clockwise |
| I / J / K / L | Small thrusters: up / left / down / right in world directions |
| E | Attach and deliver when all bay checks are green |
| Escape | Save and return to the menu |

All flight actions also have on-screen controls, including simultaneous touch
inputs. Keyboard users can Tab to a control and hold Space or Enter to operate it.

The route is Earth → Moon → Venus → Mercury → Earth → Mars → Jupiter → Saturn →
Uranus → Neptune. Each stop starts with a payload for its relay. Deliver it, then
manually fly to the next landing pad. A safe upright landing grants fuel and the
next payload once per route stop. Deliver the Neptune payload to win. Excessive
impact speed or an empty tank ends the run; Retry starts over on Earth.

Use the amber target indicator and navigation map. Land within ±12° upright and
at ≤ 8 m/s. Dock within 32 m of the bay marker, at ≤ 5 m/s and ±12° upright. Your
bay is on the rocket's right side. After delivery, use left RCS (J) to detach and
back away from the receiver before accelerating. Gas giants have floating pads and reduced atmospheric visibility;
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
node --test tests/*.test.mjs
npm --prefix functions test
```

Use Node.js 22 or newer. Game tests use built-in Node modules and do not need
installed dependencies. The analytics tests use the existing Functions setup.
See [TESTING.md](TESTING.md) for coverage, emulator checks, and the playtest checklist.

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
identifiers, and relative positions for the heatmap. `homepage-v2` identifies
the rocket game layout; `homepage-v1` identifies the previous homepage. Increment
the version when layout changes make old click positions incompatible.
Sections count as exposed when at least half of the section is visible. Section
exposure and recent input are estimates of attention, not measurements of boredom.

Local debug sends no custom analytics to a backend. The session summary uses
`sessionStorage`; detailed events stay in memory. Storage failures fall back to
in-memory tracking. Google Analytics and the existing Firestore visit counter run
independently through `siteAnalytics.js`; the game runs even if their CDN is blocked.
Analytics records control interactions rather than gameplay outcomes. Actual
game results and leave/return events are stored separately in the local flight recorder.

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
   leave the layout version as `homepage-v2`. Select Load heatmap.
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
- Only `homepage-v2` has a current page preview. Historical `homepage-v1` and other layout versions can show
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
remain part of manual verification. Production collection and deployment remain disabled.

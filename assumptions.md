# Implementation assumptions

These choices fill gaps for the first playable version. They are intended for review and tuning, not changes to the agreed scope in `FLOW.md`.

- Keep the existing buildless HTML/CSS/JavaScript setup and Firebase Hosting configuration. The game replaces the homepage; old pages remain in the repository but are not linked from the game. GitHub pushes were requested for implementation milestones. November 16: the user authorized publishing and then chose to exclude billed-plan features, so Hosting is published on Spark.
- Name the game **Orbital Freight**. Use procedural, code-drawn pixel art, with no external art or font downloads.
- Save unfinished runs, completed runs, and leave/return events in this browser's local storage. Records survive refreshes and browser restarts on the same browser/device, but are not synced between devices. Storage failures show a visible warning and fall back to memory.
- Only one tab controls a saved flight at a time. Choosing Continue claims that flight in the current tab; older tabs yield to the menu. Checkpoints refresh stored history and reject stale writes so an older tab cannot resurrect a finished run.
- Browser Web Locks serialize save mutations across tabs on HTTPS or localhost. If safe locking is unavailable, the game shows a warning and uses memory-only storage rather than risking cross-tab data loss.
- Keep up to 100 previous runs and 200 lifecycle events per run to bound local storage. New Run confirms before replacing an unfinished run and records it as abandoned, not failed.
- Leaving the tab or losing window focus suspends gameplay and saves the run. Returning requires resuming so the rocket cannot crash while the player is away. Only simulated foreground gameplay contributes to session time. Browser shutdown notifications are best effort, backed by regular saves.
- All destinations share one continuous 2D world. The return to Earth reuses Earth. Positions and radii are deliberately compressed; route order is Earth → Moon → Venus → Mercury → Earth → Mars → Jupiter → Saturn → Uranus → Neptune.
- Surface gravity uses approximate familiar values, with inverse-square falloff and a smooth cutoff at a finite influence radius for arcade travel. Main engine acceleration exceeds Jupiter gravity. Physics tuning values are centralized in the game module.
- Gravity is calibrated at the rocket's parked center height, so the Earth pad reads 9.81 m/s² despite the compressed planet radius and large pixel rocket.
- The rocket has 100 fuel units. Earth starts full. Each new destination pad grants a fixed amount of fuel, capped at 100, once per route visit. Station deliveries do not refuel. An empty tank immediately loses the run everywhere.
- Main thrust is held with Space or Up; W/S adjust throttle. A/D or Left/Right rotate. I/J/K/L fire translation thrusters in screen/world directions. E attaches at a station. Escape saves and opens the menu. Equivalent on-screen buttons support pointer/touch use.
- A safe landing requires upright alignment and low impact speed on the pad. Low-speed surface contact outside the pad does not refuel. Excessive-speed impacts with planets or stations lose the run. Docking requires correct rotation, low relative speed, and proximity; exact tolerances are shown in the UI.
- Landing permits ≤ 8 m/s and ±12° from upright. Docking permits ≤ 5 m/s, ±12°, and 32 m from the bay marker. Collision checks sweep motion through planet surfaces and station parts; slow station contacts nudge the rocket away.
- November 16 playtest update: station impacts below 20 m/s bounce, and impacts at or above 20 m/s fail. Planet impact limits and docking tolerances stay as above. All failed runs show a 0.9-second pixel explosion before results; the recorded gameplay timer stops immediately at failure. Destination guidance pulses once per second, with a steady indicator for reduced-motion users.
- Docking checklist proximity is 200 m for now. It is a non-modal flight dialog with live checks, not a pause screen; it closes after delivery or leaving range. The camera shifts up to keep the ship clear of the dialog. The moved controls use analytics layout `homepage-v3`; v1/v2 remain available as historical counts.
- Static asset entry points and game module imports share a cache-version query token. Update that token together when shipping game changes so browser caches cannot mix incompatible physics, UI, and renderer revisions.
- Playtest sizing adjustment: the docking dialog is capped at 420 px instead of 510 px, with tighter spacing and shorter instructions. The extra camera-center offset is reduced from 0.40 to 0.12 of the canvas height divided by zoom.
- Spark publication: use `firebase.spark.json` to publish static Hosting without unresolved Cloud Functions rewrites. Custom sessions and click heatmaps stay inactive. Free Google Analytics receives bounded game events without run IDs, with no historical backfill; its property is the existing linked property. Google sign-in and the same-account owner identity were prepared before the decision to omit the backend. No billing account was added and no Cloud Functions or reCAPTCHA service was enabled.
- Docking uses a right-side payload bay with the rocket upright. Attachment delivers automatically; burning an engine or translation thruster releases the rocket for the next flight. Stations remain fixed in this arcade world.
- Gas and ice giant landing pads float at the visible atmospheric surface. Visibility falls inside the atmosphere; Jupiter also applies a small varying lateral wind.
- Fuel, velocity, elapsed time, altitude, rotation, gravity, destination guidance, and station distance are visible in the cockpit. The target changes automatically after successful landing or delivery. A minimap shows the continuous route.
- Preserve analytics production collection as currently configured (disabled pending the existing App Check/deployment verification). Increment the homepage layout version so old and new heatmap geometry are never mixed. The script-free heatmap can preview static cockpit controls, but cannot replay moving canvas scenery or historical overlay states.
- No browser connection was available at the start of implementation. Run automated physics/storage/integration checks and report visual playtesting as a limitation unless a browser becomes available.

- November 16 event-log update (supersedes the inactive-session notes above): the user requested a complete readable log on free resources. Use the existing Standard Firestore database and Spark Hosting with anonymous visitor auth and an owner custom claim. Remote event rows are separate from browser-local run history. No paid plan, Functions deployment, dependency installation, automatic retention deletion, or historical backfill. The old heatmap remains inactive. Track only product allowlists, not typed text or identity. Keep up to 5,000 rows per visit; batch every 5 seconds, with 20-second visible-page heartbeats. Exit uploads remain best effort and the footer reports persistence status. Localhost does not upload to production.

- Latest playtest tuning supersedes the earlier speed limits: safe landing speed is 12 m/s, docking speed is 8 m/s, surface impacts above 12 through 25 m/s bounce without servicing, and station impacts below 30 m/s bounce. Faster impacts still fail. Survivable rebounds damp tangential velocity, limit outward speed to 3 m/s, and cap total rebound speed at 6 m/s. Upright and proximity requirements stay the same.

- Fuel balance update: halve effective tank capacity with `fuelCapacityScale: 0.5`, keeping saved/displayed fuel normalized to 0–100%. Main, attitude, and translation thrust consequently use twice the percentage of the tank for the same maneuver. Every planet grants 25 percentage points once per route stop, capped at 100%. This preserves saved run percentages and historical results without changing the save schema.

- Instrument readability update: move the existing rotation value onto the attitude circle between the rotation controls. Replace the numeric velocity cell with a screen-coordinate velocity dial: a centered rocket rotates with attitude, the amber drift arrow follows actual velocity, and X/Y components are fainter. Signed components and speed remain numeric to two decimal places below the dial. Arrow length is bounded with a minimum visible drift length; it indicates direction rather than a calibrated linear speed scale. At rest the arrow is hidden. Browser visual verification was unavailable for this update.

- Follow-up instrument simplification: remove the separate attitude circle and its numeric angle. Keep both rotation controls, the rotating rocket inside the velocity dial, its accessible rotation description, and the docking checklist angle requirement.

- Bottom-console update: all flight instruments, controls, map, objective/status text, and the docking checklist move below the full-width view. Desktop order is throttle over fuel, motion dial with numeric speed/angle to its right, controls, and other information. Smaller screens wrap in that reading order. The throttle keeps native range semantics beneath an orange-to-red segmented meter. The checklist no longer causes an extra camera offset. Relay/pad distance is drawn beside the flashing target marker, not in a separate telemetry cell.
- Thruster animation update: rotation was already charged attitude fuel; preserve that rate and show paired attitude jets. Exhaust particles inherit rocket velocity, eject from body-aligned nozzles, and use mild arcade drag to make trails visible at speed. Trails fade and are capped at 360 particles, reset on menus/new runs, and disabled for reduced motion. Translation exhaust follows the existing world-direction controls even when tilted. Browser visual testing remains unavailable.

- Follow-up cockpit and RCS update: move the navigation map/environment label to the upper-left of the flight view and transient flight status to the upper-right. I/J/K/L accelerate along the rocket's local axes, with exhaust emitted from the corresponding local nozzles. Remove the small RCS sprite flames and strengthen their particle exhaust; retain the main engine plume. This supersedes the prior world-direction translation assumption. Browser visual testing remains unavailable.

- Cockpit spacing update: remove the changing pilot guidance note from the console; the docking checklist and pre-flight briefing remain. Give desktop console columns wider proportional minimums, keep telemetry across its own row at intermediate widths, and retain the compact phone layout. Transient event feedback remains in the upper-right flight corner.

- Latest cockpit request: visually place controls first, enlarged motion instrument second, wider propulsion/throttle/fuel meters third, and telemetry/checklist last. Put Menu/Esc in the upper-right flight corner. Widen the proportional desktop columns and extend the throttle/fuel bars with them. Remove the remaining static main-engine flame sprite; main and RCS thrust are represented by particles only.

- Instrument spacing update: cap the main/attitude/RCS control group at 360 px on desktop (420 px on phone layouts). Use the right side of the motion panel for a two-column speed/rotation display and full-width X/Y readouts so expanded panel width contains telemetry rather than blank space.

- Fixed-thrust cockpit update: remove throttle settings and force full main-engine output whenever held, including resumed older saves. Repurpose the orange segmented meter as instantaneous combined fuel draw normalized to main + two translation axes + rotation at once; the existing green meter remains fuel left. Arrange sections Propulsion, Motion, Flight Systems, Controls. Keep the motion text tightly grouped and correct the main exhaust nozzle scale/alignment.

- Multiplayer implementation draft: see MULTIPLAYER_PLAN.md for proposed world/room limits, shared rules, networking, home allocation, cargo handling, and tuning. Those defaults are proposals; no multiplayer code has been implemented or deployed. The existing FLOW.md still describes the live singleplayer game.

- Local conquest implementation (November 18): implement the reviewed multiplayer
  gameplay locally, without opponents/bots or a network backend. The local galaxy
  selector lists one real local world, not invented live servers. Twenty-four
  planets are scattered around three stars; home is Earth. Capture requires hacking
  every non-home relay. Home defense upgrades are disabled because its special shield
  is already active. Session storage keeps a 30-second refresh recovery window and
  local summaries, independently of old story records. UI and new flow replace the
  previous story mode. Menus remain live; hidden-tab absence is simulated on return
  only within the reconnect window. Defense interaction logic is tested using
  explicit hostile fixtures, but no hostile ships or empires are spawned in play.
- Coordinated control steering supersedes earlier I/J/K/L and keyboard turning:
  W main thrust, S braking, mouse/trackpad steers with acceleration-limited lag,
  Space fires, E interacts; A/D are lateral double-tap dashes. Preserve the stronger
  108 m/s dash, 1% burst cost, two-second cooldown, and visible cyan directional cue.

- Confirmed final control tuning: main-engine acceleration is 68 m/s²; total velocity is capped at 500 m/s after thrust/gravity/field forces and after dashes. The 108 m/s dash impulse, 1% fuel cost, and two-second cooldown are unchanged.

- Relay docking guidance: show a flashing upright ghost within the existing 200 m assist radius, with a dotted guide from the rocket’s right-side bay. Keep the 100 m attachment radius, allow entry at up to 20 m/s and within ±35° of upright, and animate successful attachment for 140 ms. Failed attempts show a red reason for four gameplay seconds.

- Docking UI clarification: replace the approach checklist with one compact cursor-following `[E] to dock` prompt. Hide the general keyboard hint while this prompt is visible to prevent overlap. Keep hacking/upgrade actions after attachment.

- Station prompt revision: anchor the small E prompt beside its relay rather than beside the cursor; use a square keycap and short uppercase errors. Interpret “zoom out a bit” as a 20% decrease in map scale; planets and stars use circular markers proportional to their physical radii, with minimum sizes for readability.

- S braking: remove axial velocity of either sign while preserving the perpendicular component. Use a 300 m/s² maximum and exponential easing at 8/s, snapping only the final 0.05 m/s to rest. Retain existing braking fuel cost and powerless coasting. S does not detach or launch a serviced ship. Turning still uses fuel but emits no particles.

- Relay shop: T purchases the existing next planet defense tier. R is reserved and shows “Rocket upgrades coming soon”; its button is disabled until rocket upgrades exist. Planet artwork previews shields and turrets, while rocket artwork shows the standard hull. Purchases keep existing costs, ownership checks, and tracking.

- Exploration/chat update: home stays a refueling refuge with no cargo production or relay. Move Moon to Earth's X and 1,400 units above it; its relay follows normal station geometry. New runs retain Moon as the initial target and flash its guidance. Capture shields expand for one second (disabled for reduced motion). Chat is local-only in this singleplayer build, uses “Pilot” and the player color, keeps at most 40 in-memory lines, and never uploads or persists typed content. Stars are 50% larger in both collision geometry and rendering to keep their visible boundary accurate.

- Coordinated docking clarification: rotation no longer blocks attachment; range and entry speed still apply. The brief docking animation aligns the hull after attachment.

- Chat composer replaces its hint in a fixed-height row. The larger Moon relay tutorial caption is shown until the first capture and wraps on narrow screens.

- Compact galaxy/cargo attraction: use a 200-unit attraction radius and up to 35 m/s² gentle acceleration fading at the edge. Moon is now 1,100 units above Earth and Neptune 1,500 below, both at Earth’s X. Reduce system-center distances by 35% and orbital bands to 2,000/2,450/2,900, keeping the existing non-overlap and 1,000-unit star clearances.

- Capture UI: a square number key pulses gently and flashes green for a matching number or red for a wrong number. Keep the existing fresh-key and timing guards; show only the progress bar beneath it and the detach action.

- First shared-room implementation: cap at eight anonymous pilots, prefer homes
  from a spread of planets, falling back to a free neutral planet when needed, and start Earth
  pilots toward Moon. Send visible snapshots at up to 20 Hz, expire input after
  300 ms, and use a 30-second reconnect reservation. Distant firing reveals a ship
  for roughly 1.5 seconds. These limits are configurable starting choices to
  profile on the class box.
- Rocket costs 8/16/28/40 are approved starting values. Initial low-speed thrust
  bonus is 50% plus 8% per later tier, fading with speed; each tier adds 8% steering
  and braking agility. Tier 3 uses 20% less powered-control fuel; tier 4 adds 30%
  bullet speed. These are playtest tuning, not new permanent game rules.
- All multiplayer work and dependencies are local to this repository. No class-box
  access, manual folder creation, production deployment, or system/global tool
  changes have been performed. Runtime JSON is private/ignored; no paid backend
  service is needed.

- Multiplayer feedback update: reduce cargo production by 50%, from 0.6 to 0.3 cargo/s, with pod releases slowed from 1.67 to 3.34 seconds. Existing stock and floating cargo are retained. Damaging impacts and shots tint the rocket red for 300 ms, replicated to nearby pilots. The map uses a single uncompressed world scale to remove jumps at nearest-system boundaries. Overheat retains the existing 2.5-second lockout and gun-tip heat, replacing steam with a red blinking cursor and shrinking remaining-time pie; reduced motion keeps the cursor steady.

# Implementation assumptions

These choices fill gaps for the first playable version. They are intended for review and tuning, not changes to the agreed scope in `FLOW.md`.

- Keep the existing buildless HTML/CSS/JavaScript setup and Firebase Hosting configuration. The game replaces the homepage; old pages remain in the repository but are not linked from the game. GitHub pushes are requested; Firebase deployment is not part of this implementation.
- Name the game **Orbital Freight**. Use procedural, code-drawn pixel art, with no external art or font downloads.
- Save unfinished runs, completed runs, and leave/return events in this browser's local storage. Records survive refreshes and browser restarts on the same browser/device, but are not synced between devices. Storage failures show a visible warning and fall back to memory.
- Keep up to 100 previous runs and 200 lifecycle events per run to bound local storage. New Run confirms before replacing an unfinished run and records it as abandoned, not failed.
- Leaving the tab or losing window focus suspends gameplay and saves the run. Returning requires resuming so the rocket cannot crash while the player is away. Only simulated foreground gameplay contributes to session time. Browser shutdown notifications are best effort, backed by regular saves.
- All destinations share one continuous 2D world. The return to Earth reuses Earth. Positions and radii are deliberately compressed; route order is Earth → Moon → Venus → Mercury → Earth → Mars → Jupiter → Saturn → Uranus → Neptune.
- Surface gravity uses approximate familiar values, with inverse-square falloff and a smooth cutoff at a finite influence radius for arcade travel. Main engine acceleration exceeds Jupiter gravity. Physics tuning values are centralized in the game module.
- The rocket has 100 fuel units. Earth starts full. Each new destination pad grants a fixed amount of fuel, capped at 100, once per route visit. Station deliveries do not refuel. An empty tank immediately loses the run everywhere.
- Main thrust is held with Space or Up; W/S adjust throttle. A/D or Left/Right rotate. I/J/K/L fire translation thrusters in screen/world directions. E attaches at a station. Escape saves and opens the menu. Equivalent on-screen buttons support pointer/touch use.
- A safe landing requires upright alignment and low impact speed on the pad. Low-speed surface contact outside the pad does not refuel. Excessive-speed impacts with planets or stations lose the run. Docking requires correct rotation, low relative speed, and proximity; exact tolerances are shown in the UI.
- Docking uses a right-side payload bay with the rocket upright. Attachment delivers automatically; burning an engine or translation thruster releases the rocket for the next flight. Stations remain fixed in this arcade world.
- Gas and ice giant landing pads float at the visible atmospheric surface. Visibility falls inside the atmosphere; Jupiter also applies a small varying lateral wind.
- Fuel, velocity, elapsed time, altitude, rotation, gravity, destination guidance, and station distance are visible in the cockpit. The target changes automatically after successful landing or delivery. A minimap shows the continuous route.
- Preserve analytics production collection as currently configured (disabled pending the existing App Check/deployment verification). Increment the homepage layout version so old and new heatmap geometry are never mixed. The script-free heatmap can preview static cockpit controls, but cannot replay moving canvas scenery or historical overlay states.
- No browser connection was available at the start of implementation. Run automated physics/storage/integration checks and report visual playtesting as a limitation unless a browser becomes available.

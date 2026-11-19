# Orbital Freight — runtime modes

A configured public server endpoint enables one shared galaxy. An empty endpoint
keeps the local practice experience below. The class-box service must be deployed
and its URL configured before multiplayer is live on Firebase.

```mermaid
flowchart TD
    website[Visit website] --> configured{Multiplayer endpoint configured?}
    configured -->|No| local[Local practice flow below]
    configured -->|Yes| onlineMenu[Play or Continue shared galaxy]
    onlineMenu --> connect[Open secure WebSocket connection]
    connect --> accepted{Connected and room has a slot?}
    accepted -->|No| retry[Show connection or full-room reason; retry]
    retry --> onlineMenu
    accepted -->|New pilot| spawn[Assign free protected home, anonymous label and color]
    accepted -->|Valid reconnect| recover[Restore server-confirmed state]
    spawn --> guide[Target nearby neutral relay; large capture and cargo arrow for every home]
    guide --> shared[Fly in the shared galaxy; server owns outcomes]
    recover --> shared
    shared --> hack[Dock non-home relay and enter changing code]
    hack -->|Wrong code| feedback[Flash red; progress unchanged]
    feedback --> hack
    hack -->|Correct code| progress{Capture complete?}
    progress -->|No| hack
    progress -->|Yes| capture[Transfer ownership, reset defenses, expand shield, announce capture]
    capture --> shop[T planet purchase or R rocket purchase at owned relay]
    shop -->|Server validates cargo and tier| purchase[Charge once, save state, confirm upgrade]
    purchase --> shop
    shop -->|E detach| shared
    hack -->|E detach or disconnect| cancel[Reset partial hack]
    cancel --> shared
    shared --> pickup[Collect nearby attracting cargo once; server resolves ties]
    pickup --> shared
    shared --> refuel[Owned pad gradually refuels; home produces no cargo and has no relay]
    refuel --> shared
    shared --> chat[Slash opens room chat; Enter sends; Escape closes]
    chat --> shared
    shared -->|Zero fuel| fuelWarning[Warning above map: coast or press Space to self-destruct]
    fuelWarning -->|Reach owned pad| refuel
    fuelWarning -->|Fresh Space press or click| death[Death drops cargo and removes one rocket tier]
    shared -->|Lethal damage| death
    shared -->|Shoot hostile turret inside its shield| turretDamage[Show small health bar; five hits disable turret]
    turretDamage --> turretRecovery[Turret stops firing; bar refills for ten seconds]
    turretRecovery --> shared
    shared --> mapPilots[Map shows all pilots; distant pilots use edge direction markers]
    mapPilots --> shared
    death --> notice[Show tier loss during death and respawn at home]
    notice --> activity[Announce death in room chat]
    activity --> shared
    shared --> menu[Menu overlay; server simulation continues]
    menu -->|Continue| shared
    menu -->|Leave| release[Release territory immediately]
    shared -->|Refresh or connection loss| grace[Clear inputs and hack; reserve pilot for 30 seconds]
    grace -->|Reconnect in time| recover
    grace -->|Expired| release
    shared -->|Server restart| disk[Load durable galaxy; previously online pilots get 30 seconds to return]
    disk -->|Return in time| recover
    disk -->|No return| release
    release --> onlineMenu
```

Rocket tiers are sequential: fading acceleration/weapon improvement, twin gun,
fuel efficiency, then faster alternating barrels and bullet speed. Death floors
the tier at zero. Chat contents and reconnect credentials never enter analytics.
The server broadcasts public planet colors and map positions for all pilots, with only relevant full remote ship states. Room chat announces joins, disconnects, returns, departures, captures and deaths; messages remain transient.

---

# Orbital Freight — local conquest player flow

The homepage is a local, open-world conquest game. There are no other players or
bots in this version. Three scattered star systems share one galaxy with 24
planets; Earth is the pilot's protected home. The previous finite journey has
been replaced. This chart describes the implemented local experience.

```mermaid
flowchart TD
    visit[Visit website: conquest menu and anonymous tracking notice] --> saved{Valid local galaxy saved within 30 seconds?}
    saved -->|Yes| menu[Show Continue, New Galaxy, Local Galaxy and Flight Records]
    saved -->|No or expired| fresh[Show Play, Local Galaxy and Flight Records]
    fresh -->|Play| start[Create galaxy: protected home, full fuel, zero cargo; flash arrow toward Moon relay]
    menu -->|Continue| resume[Clear held controls; resume local galaxy]
    menu -->|New Galaxy| confirm{Confirm replacing current galaxy?}
    confirm -->|Cancel| menu
    confirm -->|Confirm| archive[Retain summary and create fresh galaxy]
    archive --> start
    fresh -->|Local Galaxy| directory[Search local galaxy listing]
    menu -->|Local Galaxy| directory
    directory -->|No matching search| empty[Show no matching local galaxy]
    empty --> directory
    directory -->|Join| join{Existing local galaxy?}
    join -->|Yes| resume
    join -->|No| start
    directory -->|Back| menu
    fresh -->|Flight Records| records[Read conquest summaries and earlier story records]
    menu -->|Flight Records| records
    records -->|Back| menu
    menu -->|Briefing| briefing[Read controls and conquest rules]
    fresh -->|Briefing| briefing
    briefing --> menu
    start --> flight[Fly, aim, fire, explore and manage fuel]
    resume --> flight
    flight -->|Map click or destination selector| target[Set relay or pad destination]
    target --> flight
    flight -->|Approach relay| checks[Show proximity ghost, bay guide and compact station-side E prompt]
    checks -->|Unavailable E press| dockError[Show blocking reason in red below relay dialog]
    dockError --> checks
    checks -->|Leave range| flight
    checks -->|Within 100 m, ≤20 m/s and E| attach{Owned relay?}
    attach -->|No| hack[Dock and enter displayed digit; firing disabled]
    hack -->|Wrong key or held repeat| hack
    hack -->|Correct fresh key| progress{Hack complete?}
    progress -->|No| hack
    progress -->|Yes| capture[Capture planet; reset level and stored cargo]
    capture --> captureEffect[Expand shield in player color; announce capture in local chat]
    captureEffect --> upgrade[Show planet preview and T upgrade cost beside rocket preview and unavailable R option]
    attach -->|Yes| upgrade
    hack -->|E detach| cancel[Reset all hack progress]
    cancel --> flight
    upgrade -->|Enough cargo and T or click| purchase[Deduct cargo; upgrade only attached relay's planet]
    purchase --> upgrade
    upgrade -->|R| rocketPurchase[Buy next rocket tier with carried cargo]
    rocketPurchase --> upgrade
    upgrade -->|Insufficient cargo, home or final tier| unavailable[Explain unavailable purchase]
    unavailable --> upgrade
    upgrade -->|E detach| flight
    flight -->|Land upright on owned pad| service[Automatically collect cargo and refill tank]
    service -->|Stay| refill[Refill slows near full; home refills faster]
    refill --> service
    service -->|Take off| flight
    flight -->|Neutral or hostile pad landing| noservice[No refuel or cargo; landing never captures]
    noservice --> flight
    flight -->|Zero fuel| emptyfuel[Coast under gravity; show self-destruct option]
    emptyfuel -->|Reach owned pad| service
    emptyfuel -->|Fresh Space press or click: accept cargo loss| death[Explosion; drop carried cargo; lose one rocket tier; retain territory]
    flight -->|Hostile projectile or fast impact| damage[Fuel damage; red hull flash and white leak particles]
    damage -->|Damage exceeds fuel before hit| death
    damage -->|Fuel covers damage, including equality| flight
    flight -->|Star contact| death
    death --> respawn[Respawn at protected home: full fuel, zero carried cargo]
    respawn --> flight
    flight -->|Slash| chat[Focus local chat; typing does not control rocket]
    chat -->|Enter| sendChat[Append text locally; never upload chat contents]
    sendChat --> flight
    chat -->|Escape| flight
    flight -->|Approach nearby attracting cargo and touch it| pickup[Collect cargo pickup]
    pickup --> flight
    flight -->|Escape or Menu| livemenu[Menu overlay; galaxy continues and held controls stop]
    livemenu --> menu
    menu -->|Continue| flight
    flight -->|Refresh, close or hidden tab| leave[Save state; clear controls; cancel active hack]
    leave --> reconnect{Return within 30 seconds?}
    reconnect -->|Yes| recover[Simulate short absence: coasting, production and respawn]
    recover --> menu
    reconnect -->|No| expire[Expire galaxy; retain session summary]
    expire --> fresh
```

## Continuous rules

- W burns at full thrust; S brakes only along the nose axis, preserving sideways drift without reversing motion. Mouse/trackpad steering follows the cursor
  with an acceleration-limited turn. Space fires; E attaches/detaches. Number
  keys 1–0 enter relay challenges. Double-tap W/A/S/D for rocket-relative dashes.
- The top-right map shows all planets, their ownership, home, stars, and target.
  There is no route progress bar or final win condition.
- All non-home planets start neutral. Hacking starts with digits 1–3; stronger
  defenses expand the digit pool and increase required presses. Detaching resets.
- Cargo is one resource. Owned planets produce it; owned-pad landings automatically
  collect it. Any owned relay can upgrade only its own planet.
- The upgrade sequence is bullet barrier → turret → outer field. Newly captured
  worlds have a weak field. Small fields gently repel hostile rockets; hard bullet
  barriers still allow rockets inside. Friendly shots ignore friendly barriers.
- Home cannot be captured and has a hard shield against hostile ships/shots.
- Turret shots are blocked around the relay refuge; player shots are not.
  The simulation supports these rules, but the local galaxy contains no opponents.
- Fuel reaching zero never ends a session. Coasting, gravity and shooting continue.
  Owned-pad refueling is free, faster when empty, and faster at home.
- Shots and fast impacts consume fuel; impact loss grows with speed. White
  particles show each hit. Equal damage leaves zero fuel; exceeding fuel kills.
- A fatal hit, star contact or confirmed self-destruct drops cargo and
  respawns at home. Planet ownership/upgrades survive death. Floating cargo expires.
- Live menus do not pause production or flight. Hidden tabs/refresh recover within
  30 seconds; later returns expire the local galaxy. Browser storage denial is shown.
- Starting a new galaxy requires confirmation and archives a summary. Earlier story
  flight records remain accessible and are not converted to conquest territory.

## Anonymous event logging

The menu discloses tracking and reports whether events are saved/pending. The
owner reads chronological rows at `/analytics.html`, with random visit IDs and
wall-clock/elapsed timestamps. Local development never uploads to production.

| Experience | Recorded events |
| --- | --- |
| Arrival, return, departure | pageView, pageReturn, pageLeave |
| First intentional action and choices | firstAction, click, screenView |
| Briefing and record views | briefingToggle, screenView |
| Enter, resume, replace, expire local galaxy | conquest lifecycle actions |
| Held flight and firing controls | controlPress/controlRelease; firing interval start/end |
| Map target choice | mapTarget, without coordinates or typed search |
| Docking approach, attach and detach | dockingChecklist, docked/detached |
| Hacking | start, progress milestones, cancellation and capture; no entered digits |
| Cargo | collection, drop and pickup amounts |
| Fuel service | refueling start/end |
| Upgrades | accepted/rejected outcome and tier |
| Fuel damage | bounded damage amount and remaining fuel |
| Destruction and respawn | death, respawn and self-destruct choices |
| Continued visible visit | bounded periodic heartbeat |

Events omit names, typed text, raw keys, aim coordinates, reconnect secrets and
persistent player identity. Delivery remains best effort if the browser closes
or the network blocks analytics. Historical rows remain readable.

Home planets have no relay or cargo production. New runs guide the player to the Moon relay above Earth. Chat is local-only until multiplayer exists.

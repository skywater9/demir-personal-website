# Rocket game player flow

The game becomes the main website. Preserve the existing analytics and heatmap functionality. This document describes the player experience only; it does not change the website implementation.

## Complete player experience

```mermaid
flowchart TD
    visit["Visit the main website: rocket game"] --> menu["Start menu"]
    menu --> saved{"Saved unfinished run available?"}
    saved -->|No| start["Start"]
    saved -->|Yes| choice{"Continue or New Run?"}
    choice -->|Continue| restore["Restore saved run and record return to run"]
    choice -->|New Run| confirm{"Confirm replacing saved progress?"}
    confirm -->|Cancel| menu
    confirm -->|Confirm| replace["Replace saved progress; retain previous run records"]
    replace --> initialize
    start --> initialize["Begin on Earth: full fuel tank, initial payload, Earth gravity, timer at zero"]
    initialize --> launch
    restore --> active

    subgraph gameplay["Continuous gameplay: pixel art and simple 2D physics"]
        active["Resume the saved gameplay state"]
        launch["Launch from current landing pad with payload"]
        launch --> fly
        active --> fly["Fly toward the current target using throttle and direction controls"]
        fly --> fuel{"Fuel empty?"}
        fuel -->|Yes: immediate loss| failure
        fuel -->|No| crash{"Crashed at excessive velocity?"}
        crash -->|Yes| failure
        crash -->|No| target{"Current target?"}

        target -->|Station| approach["Escape planet gravity and approach station in low gravity"]
        approach --> align["Use smaller thrusters to align the payload bay; consume less fuel"]
        align --> dockReady{"Within docking distance and correct rotation?"}
        dockReady -->|No| fly
        dockReady -->|Yes| attach{"Player presses attach button?"}
        attach -->|No| fly
        attach -->|Yes| delivery["Attach to station and deliver payload"]
        delivery --> finalStation{"Final destination's station?"}
        finalStation -->|Yes| win
        finalStation -->|No| nextPlanet["Set next planet landing pad as target"]
        nextPlanet --> transit["Player flies to next destination; distances are not to scale"]
        transit --> fly

        target -->|Planet landing pad| descent["Approach landing pad under destination-specific gravity"]
        descent --> gas{"Gas or ice giant?"}
        gas -->|Yes| floating["Approach floating pad; visibility decreases inside atmosphere"]
        floating --> jupiter{"Jupiter?"}
        jupiter -->|Yes| wind["Slight atmospheric wind adds difficulty"]
        wind --> landing
        jupiter -->|No| landing
        gas -->|No| landing{"Landed upright on pad at acceptable velocity?"}
        landing -->|No: continue maneuvering and checking fuel/crashes| fly
        landing -->|Yes| service["Automatically refuel, receive next payload, and target this destination's station"]
        service --> launch
    end

    failure["Run lost: empty fuel tank or excessive-speed crash"] --> recordLoss["Persist failed run results: gameplay time and remaining fuel"]
    recordLoss --> loseScreen["Lose screen: show time and fuel"]
    loseScreen --> lossChoice{"Retry or return to menu?"}
    lossChoice -->|Retry: restart entire journey on Earth| initialize
    lossChoice -->|Return to menu| menu

    win["Journey complete: final station payload delivered"] --> recordWin["Persist successful run results: gameplay time and remaining fuel"]
    recordWin --> winScreen["Win screen: show time and fuel"]
    winScreen --> menu

    gameplay -.-> tracking["Throughout gameplay: count gameplay time only, save progress, and update HUD"]
    tracking -.-> hud["HUD: fuel, elapsed gameplay time, altitude when in range, station distance, gravity, velocity, and rotation"]
    tracking -.-> controls["Rocket-style control panel with control buttons; main thrust and smaller alignment thrusters consume fuel"]
    tracking -.-> navigation["Small map or direction indicator points to current station or landing pad"]

    gameplay -.-> interruption{"Refresh, exit, or return to menu during gameplay?"}
    interruption -->|Return to menu| leave["Save progress, record leaving the run, and stop gameplay timer"]
    leave --> menu
    interruption -->|Refresh or exit website| unload["Retain saved progress and record departure where browser lifecycle permits; exclude time away"]
    unload --> revisit["Refresh completes or player visits again"]
    revisit --> menu

    menu -.-> history["Previous run records remain available across refreshes and later visits"]
    recordLoss -.-> history
    recordWin -.-> history
    leave -.-> history
    unload -.-> history
    restore -.-> history
```

## Destination order

Each destination supplies payload for its own station. After delivering that payload, the player manually flies to the next destination. The initial Earth launch begins with payload and a full tank; subsequent successful pad landings automatically provide refueling and the next payload.

```mermaid
flowchart LR
    earthStart["Earth: start"] --> moon["Moon"]
    moon --> venus["Venus"]
    venus --> mercury["Mercury"]
    mercury --> earthReturn["Earth: return"]
    earthReturn --> mars["Mars"]
    mars --> jupiter["Jupiter"]
    jupiter --> saturn["Saturn"]
    saturn --> uranus["Uranus"]
    uranus --> neptune["Neptune"]
    neptune --> lastDelivery["Deliver Neptune payload to its station"]
    lastDelivery --> complete["Journey complete"]
```

Gravity changes for each destination and decreases away from the planet. Exact gravity values, fuel/refueling quantities, landing velocity limits, and docking tolerances remain unspecified; the flow does not assign them. The final fuel rule is immediate failure at an empty tank, including during coasting.

Saved unfinished runs support Continue or New Run, with confirmation before replacement. Session time counts gameplay only. Leaving and returning are recorded separately from wins and losses. Progress must survive refreshes and later visits; reliable exit recording is subject to browser lifecycle limitations. Storage technology and exact save timing are not specified here.

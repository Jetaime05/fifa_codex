# Phase 5 — Visual and audio acceptance

Reviewed 2026-09-04. Implementation accepted for the procedural prototype scope. See `ART_DIRECTION.md` for the style, asset provenance and future replacement strategy.

## Delivered

- Articulated players with idle/run, pass/kick/shot, tackle, dive and celebration poses. These animate child rigs only; gameplay roots remain physics-owned.
- Generic team kits and distinct keepers, a patterned ball, readable evening lighting, striped grass, aligned penalty markings, four-sided tiers, 1,176 instanced crowd blocks and generic boards.
- Scored-net ripple, bounded shot ring/trail, cosmetic rain, goal camera/score overlay, reduced-motion control and Clean view.
- Nine synthesized audio cues plus crowd ambience. Sound starts only after Enable sound; volume, mute, pause and background silence are supported.

## Automated evidence

- `npm.cmd test`: **207 tests pass across 35 files**, including existing Phase 3/4 acceptance.
- `npm.cmd run build`: TypeScript and Vite production build pass. The pre-existing large-main-chunk warning remains (about 612 kB minified / 166 kB gzip); no new dependency was added.
- 15 player tests cover bounded poses, hidden-player/reset cleanup, all action types, unchanged gameplay transforms, dead-ball locomotion gating and four shadow casters per rig.
- 13 audio tests cover explicit unlock, unavailable/rejected/suspended contexts, muted/inactive behavior, voice limits, repeated frame-state calls, cleanup and interruption recovery without replaying stale sounds.
- 7 stadium tests cover in-field/scaled markings aligned with actual penalty restart placement, net anchors and decay, bounded effects, weather, reduced motion and reset.
- 4 integrated presentation tests use the real 22-player roster. They verify unchanged roots/positions/velocity/stamina/RNG, no implicit audio creation, finite fixed-size geometry buffers and **identical ball trajectories over 1,800 physics frames with presentation enabled versus absent**.

One initial integration-test expectation incorrectly required a full trail while triggering a new shot every 30 frames (each shot intentionally clears the trail). The final scenario explicitly lets the trail fill and verifies its 24-point cap; no production behavior was changed to satisfy that assertion.

## Browser smoke evidence

- Inspected broadcast and close Follow camera with the upgraded players, arena, field markings and rain. Clean view can hide and restore controls; the score remains visible.
- Ran actual 30-playing-second AI-vs-AI matches through halftime/fulltime. A later run finished 1–0, with one shot, cards/fouls and the normal results table. Presentation did not prevent restart/new-match flow.
- Explicit Enable sound produced a running AudioContext and one ambience source, with no diagnostic error. The Sound check UI separately confirmed **Playing pass / shot / tackle / whistle / goal**. These are real Web Audio scheduling checks, not a claim of human listening or calibrated mixing.
- Pause produced `active:false`, `voices:0`; audition was rejected while paused. Reduced motion cleared animation actions, rain particles, trail and net effects while preserving the selected rain setting; resume/uncheck restored effects.
- Default/reloaded state was silent with `contextState:not-created`. Sound preferences remain match-independent and are not saved across reloads.
- Final browser console check returned no error or warning logs.
- Desktop CSS viewport 1280×800 and mobile 390×845 inspected. Expanded Picture & sound uses scrolling. Final mobile layout had settings ending at 488, debug 498–558, Clean view 572–602, player 610–691 and touch controls 705–845, without horizontal overflow or overlap.
- Short desktop frame samples (120 frames) observed median about17–19.3 ms and p95 about29–34 ms during ordinary live play. Sampled draw counts varied by framing, roughly509–673, with under47k triangles. These are local-browser smoke observations, **not a sustained/device-matrix benchmark**; tests/builds were also run on the host.

## PM review corrections

1. Reduced player shadow casters from 568 potential body-part casters to 88 across the roster; crowd stays instanced, one shadow light uses 1024² and renderer DPR is capped at 1.5.
2. Dead balls immediately idle locomotion despite held simulation velocities; one-shot celebrations/dives can still finish. No animation writes the root pose.
3. Goalkeeper dive direction is transformed into the keeper's local frame, including the away-facing keeper.
4. Pitch penalty spots/areas/arcs now agree with the scaled referee/restart coordinates rather than the earlier unscaled paint.
5. Pause/resume/reset synchronize audio immediately. Interrupted audio drops old suspended voices before resuming; enable failures show their diagnostic error.
6. Form focus protects native keyboard semantics, including the new Clean view button. The mobile layout reserves a separate row for that button.

## Audio checklist

| Cue | Runtime trigger | Verification |
| --- | --- | --- |
| Pass | Successful pass plan | Unit graph + browser audition |
| Shot | Successful shot plan | Unit graph + browser audition |
| Tackle | In-range explicit challenge | Unit graph + browser audition |
| Whistle | Restart / kickoff / halftime | Unit graph + browser audition |
| Goal | Accepted goal | Unit graph + browser audition |
| Kick | Clearance / periodic dribble touch | Unit graph + runtime wiring review |
| Save | Keeper save/parry | Unit graph + runtime wiring review |
| UI | Settings / Clean view click | Unit graph + browser unlock/click |
| Fulltime | Fulltime transition | Unit graph + rendered demo transition |
| Crowd | One persistent filtered-noise loop | Unit lifecycle + browser running mixer |

## Remaining presentation follow-ups

- No recorded 60-second cinematic gameplay clip or saved screenshot file is included; screenshots were inspected in the task. Capture a clean-view clip for sharing separately.
- Synthesized cues and crowd noise are placeholders; listening/mix tuning on target speakers/headphones remains useful. No commentary, licensed samples or imported motion capture.
- Models are deliberately stylized low-poly procedural figures, not photoreal player likenesses. Broader low-end/mobile GPU testing and draw-call consolidation remain future optimization work.

No commit or push is implied by these local QA results.

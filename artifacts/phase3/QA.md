# Phase 3 — AI Football Brain acceptance

Reviewed 2026-09-04. Implementation and automated behavior gates accepted.

## Runtime delivered

- `FootballAISystem` owns persistent observe/reaction/execute/cooldown state. Utility scores drive actual targeted passes, shots, clearances and tackles. Possession/control changes invalidate pending decisions.
- Spatial targets drive movement, with at most two AI pressers per team and a guaranteed loose-ball retriever. Off-ball marking excludes the carrier; moving support offers two progressive options and a trailing outlet.
- Native Easy/Normal/Hard selection changes reaction, perception, errors and choices without altering the shared movement speed configuration.
- Goalkeeper angle tracking, incoming-shot evaluation, a single save roll per shot, and delayed lane-aware distribution are connected to the match.
- Optional AI debug shows reasons, targets, scores and team metrics. `Watch AI vs AI` and `Restart` provide a repeatable, user-visible inspection mode. Normal player control remains the default.
- Per-team pass attempts/completions, shots, goals and clearances are measured from real runtime events. Match totals survive goals and reset for a new match.

## Automated evidence

Run `npm.cmd test` and `npm.cmd run build` from the project root.

`AIPhase3Acceptance.test.ts` uses the real movement, dribbling, first-touch, passing, shooting, possession, collision, ball and goalkeeper modules. It does not teleport pass receptions or manufacture successful shot outcomes.

| Seeded Normal scenario | Pass attempts | Completed | Shots | Goals | Saves |
| --- | ---: | ---: | ---: | ---: | ---: |
| 240 simulation seconds, 60 Hz | 104 | 22 | 7 | 6 | 0 |
| 240 clock-second steps at runtime 1.55x physics delta (372 simulation seconds) | 165 | 45 | 10 | 4 | 6 |

Both scenarios use seed `0xdecafbad`, 22 players and a loose ball at midfield. Both keep pressing at a maximum of two per team, produce finite state, and stay within the stats-based speed cap (observed maximum 15.7416). Mirrored breakaway tests use the same three predeclared seeds for each direction and require goals across each batch; every individual attempt is not required to beat a probabilistic keeper. A repeated-seed check verifies identical simulation state.

The harness matches kick-only 0.22-second recollection protection, keeper interception, and stamina recovery after goals. It resets immediately after goals rather than running the UI's 0.9-second celebration. The results are deterministic headless behavior evidence, not an exact replay or performance benchmark of a rendered four-minute match.

## Difficulty comparison

Times below are simulation milliseconds, before the game's common 1.55x speed multiplier.

| Profile | Reaction delay | Decision cooldown | Perception accuracy | Deliberate mistake chance |
| --- | --- | --- | ---: | ---: |
| Easy | 420–720 ms | 480–760 ms | 0.64 | 22% |
| Normal | 230–430 ms | 300–520 ms | 0.82 | 9% |
| Hard | 90–210 ms | 180–340 ms | 0.96 | 2.5% |

All profiles share the same stats-based movement limits. Unit/runtime tests verify faster Hard reactions without a movement-speed bonus.

## Browser smoke checks

- Desktop canvas renders all 22 players; no browser error/warning logs observed during the checks.
- Native difficulty selection, spectator mode, debug visibility and Restart work. Restart clears match counters.
- Easy observed reaction delays approximately 491–585 ms; Hard approximately 95–101 ms in sampled decisions, within their configured ranges.
- Both teams completed passes in the rendered spectator smoke run; reasons and targets were present in runtime debug state.
- Mobile layout checked at CSS width 390 (approximately 845 high) and a narrower approximately 325-wide viewport. No horizontal overflow; the settings, debug panel and bottom player/touch controls occupy separate regions after the responsive correction.
- Returning from settings restores keyboard input. Space pauses and resumes; C switches broadcast/follow camera.

Browser checks are interaction/render smoke evidence. A full rendered four-minute match and recorded demo clips were not captured in this review. Demo-video capture remains a presentation follow-up, not a claim made by the headless tests.

## PM fixes caught by acceptance/review

1. The old endline bounce at `halfLength - ballRadius` prevented ordinary 60 Hz shots reaching the scoring plane at `halfLength + 0.8`. The goal opening now remains open; regression tests cover both ends and retain wide/high rebounds.
2. Freshly kicked balls could be immediately recollected by their kicker. A short kick-only exclusion fixes this without excluding other receivers. Loose-ball collection now chooses the nearest eligible player rather than preferring roster order.
3. A zonal marker could become an uncounted extra presser on the carrier. Carrier marking is excluded from off-ball assignments.
4. Keeper distribution now checks the passing lane, not just receiver distance from opponents. Incoming shots use one save attempt; a rebound travelling away is treated as a loose ball, not a fresh save attempt against a stale target.
5. Restart clears decision memory, shot/lock state and match telemetry; stamina resets fully for a new match. Goal celebrations freeze play, and match counters survive goal restarts.

## Remaining scope

- Existing production bundle-size warning remains (roughly 579 kB minified main chunk).
- Pass completion and attack balance are prototype tuning, not calibrated match-realistic statistics.
- Full football rules, offside, fouls and advanced animation remain later-phase work.
- No commit or push was performed as part of this Phase 3 implementation request.

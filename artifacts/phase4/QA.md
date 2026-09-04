# Phase 4 — Complete Football Rules

Reviewed 2026-09-04. Phase 4 prototype implementation and automated gates accepted.

## Delivered

- Match flow: three-second kickoff, 0.9-second goal celebration, conceding-team kickoff, four-second halftime placeholder, second-half kickoff, pause/resume preserving countdowns, fulltime and new-match reset.
- The match clock advances only during live play. Default length is 240 playing seconds; a visible 30-second demo option applies on the next restart.
- Whole-ball swept touchline/endline detection replaces runtime rebounds. Goals, throws, corners and goal kicks use first-crossing and last-touch attribution, including keeper parries and heavy first touches.
- Eligible takers/receivers, dead-ball placement, opponent spacing, penalty goalkeeper placement and automatic release after a two-second restart countdown. Formation home positions are preserved.
- Explicit player/AI tackles can produce free kicks, penalties, yellow/second-yellow/red cards. Dismissed players are removed from movement, possession, targeting, collisions and minimap until a new match.
- Optional offside, advantage, added time and substitution-window toggles. A pass snapshot drives prototype offside; direct throws/corners/goal kicks are exempt. Advantage can be recalled on turnover. Added time is capped at 30 seconds total.
- Set-piece camera emphasis and fulltime score/stat table: shots, passes, possession, tackles, saves, fouls, cards, corners, throws and goal kicks.
- JSON diagnostic state includes flow, restart/taker, referee decisions, discipline, eligible player counts and match statistics.

## Automated evidence

Run `npm.cmd test` and `npm.cmd run build` at the project root.

- **168 tests pass across 31 files.** TypeScript and production build pass.
- `Phase4Acceptance.test.ts` runs a scripted 240-playing-second match with real flow, ball physics, goal adjudication, restart placement and stats. Result: 1–0, exactly one halftime/fulltime, throw-in/corner/goal-kick observed, all 22 player positions finite.
- Additional integration scenarios cover free kick, penalty, second yellow/dismissal, clean new-match reset, offside, advantage recall, added-time cap and substitution gates.
- Module tests cover mirrored ends, whole-ball thresholds, diagonal first exits, high-ball crossings, unknown last touch, scaled penalty areas, kickoff own-half constraints and eligible restart takers.
- AI regression tests prove a referee callback can stop the current update immediately, with no movement or cooldown mutation after restart placement or eligibility change.
- Existing Phase 3 autonomous AI acceptance remains green. Its old rebound-mode metrics are regression evidence, not Phase 4 performance measurements.

The Phase 4 full-length harness uses scripted kicks/contact scenarios; it is not a claim of a rendered four-minute autonomous match.

## Browser evidence

- Completed an actual rendered **30-playing-second AI-vs-AI demo**, through halftime and fulltime. Score 0–0; home passes 3/11, away 7/18; shots 1–0; fouls 2–1; yellow/red 1/1 versus 1/0; one away goal kick. The sent-off home player reduced eligible players to 10 versus 11.
- Fulltime result table visibly matched diagnostic counters; the clock stopped at exactly 30 seconds.
- Restart restored 11 players per side, zero counters, empty discipline and kickoff at elapsed zero. Pause preserved the kickoff countdown; resume restored kickoff.
- All four advanced checkboxes updated their runtime options; added time also enabled the flow option. These UI checks complement the deterministic advanced-rule scenarios.
- Mobile CSS viewport 390×845 and desktop 1280×800 inspected, including expanded rules/debug and mobile result table. No horizontal overflow. Settings/debug/player panels occupied separate vertical regions; shorter viewports use scrollable settings.
- No browser error or warning logs were observed during the final smoke run. No rendered four-minute match or demo video was captured.

## Review corrections

1. AI previously continued moving using stale plans after a foul callback had already arranged a dead ball. An optional continuation guard now exits immediately.
2. Free-kick shot selection now uses attack-relative field position, avoiding a defensive-third 100-metre shot. Offside restarts pass instead.
3. Keeper parries and failed first touches update last touch; opponent contact cancels pending pass completion.
4. New-match reset clears all selection rings, stats, discipline, dismissal visibility, pending shots/passes, release locks and AI memory.
5. Kickoff opponents stay in their own half; penalty placement uses the same scaled spot as the referee.
6. Settings scroll in short viewports; the debug panel is placed below settings and above player/touch controls.

## Reproduce in the browser

1. Run `npm.cmd run dev`, open `http://127.0.0.1:5173/`.
2. Select **Watch AI vs AI**, **Next match → 30s demo**, then **Restart**.
3. Pause during kickoff; elapsed should remain zero. Resume and observe automatic kickoff.
4. At 15 playing seconds observe halftime, then an away kickoff; at 30 observe fulltime and populated match stats.
5. Open **Advanced rules** to toggle each optional rule. Enable **AI debug** for measured counters; rules remain independent of debug visibility.
6. Restart after fulltime: score/counters/cards clear, all players return, and the selected match length applies.

## Prototype boundaries

- Halftime does not swap ends; restarts use timed automatic kicks, with no full throw-in/set-piece animation or manual aiming UI.
- Offside uses a simplified pass-snapshot/free-kick restart, not complete indirect-goal/interference/deflection law. No VAR.
- Fouls are assessed on explicit tackle actions, not every incidental possession contact.
- Cards have real eligibility effects but no referee animation. Substitution windows expose eligibility only; bench selection/replacements are not implemented.
- Added time is an optional arcade estimate for dead-ball time even though the live clock pauses; it is not regulation timekeeping.
- Existing bundle-size warning remains: approximately 599.30 kB minified main JavaScript (160.10 kB gzip).
- Recorded demo videos are not included. Browser observations and automated scenarios must not be presented as recorded clips.

# Future work

Checkpoint recorded: **2026-09-08**. The owner requested a development freeze and checkpoint delivery. The pre-checkpoint baseline was `7814941 Add durable Codex project handoff`. This list records realism work intentionally left outside the current Phase 6.5 WIP checkpoint. It is a planning aid, not a phase acceptance record.

- Resolve the frozen `DribblingSystem.test.ts` distant/sharp-turn ownership-release failure with a physically justified rule, then rerun the full regression.
- Finish the integrated action-queue acceptance harness: pause/resume, ownership turnover, restart and squad Play reset, single release, physical contact reach/height, and presentation/audio phase alignment.
- Audit the partially implemented keeper segment-contact path and goal adjudication. The current restart rule delays a goal to `HALF_L + 0.8` instead of the whole-ball line at `HALF_L + radius`; settle that geometry before validating both reachable saves and out-of-reach goals.
- Correct the camera-relative screen-right basis (`up × forward` is currently reversed for the sideline view) and update its focused test before claiming camera-relative controls are aligned.
- Add one deterministic orchestration covering physical dribble touches, retained first touch, moving receiver interception, and successful versus failed duels.
- Calibrate receiver prediction, movement acceleration, pass travel and pressure by distance and scenario instead of relying on aggregate completion rates.
- Complete the aerial loop: target-point reading, cross/lob arrival, headers, volleys, defensive clearances, contests and goalkeeper interception. The current through/lob/cross/chip handlers remain experimental until browser and acceptance evidence exists.
- Implement real fatigue and substitutions only after auditing saved squads, restart flow, dismissal handling and end-switch behavior.
- Audit restart poses, halftime direction switching, keeper recovery and action cancellation across every match-flow transition.
- Complete desktop and 390×844 manual QA, touch usability, reduced-motion behavior, console checks and sustained performance review.
- Keep reward progression, missions, extra modes and all other Phase 7 work unstarted until the realism gate is accepted.

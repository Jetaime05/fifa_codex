# Phase 6.5 — Football realism WIP checkpoint

Reviewed **2026-09-08** after the owner requested a development freeze and checkpoint delivery. This document records the current Phase 6.5 WIP checkpoint and its evidence, not an accepted phase. The pre-checkpoint baseline was `7814941 Add durable Codex project handoff`; this record covers the current checkpoint. The source review that motivated the work remains in [`REVIEW.md`](./REVIEW.md).

## Current implementation scope

The current checkpoint contains a first integration pass for the highest-priority realism items:

- Ball scale is centralized around the gameplay ball configuration and is threaded through visual creation, restart placement, first touch, dribbling and physics callers.
- `BallActionSystem` provides simulation-owned prepare/contact/recovery/cancel phases. `main.ts` queues pass, shot, cross and clearance actions, validates the owner again at contact, invalidates stale actions on restart/squad reset, and synchronizes presentation from the simulation clock.
- Dribbling can use impulse touches so the loose ball advances through BallSystem between touches. First-touch attachment can retain incoming velocity instead of always zeroing it.
- `DuelSystem` provides eligibility, shielding, deterministic one-event resolution, cooldown/recovery and reset state. Human and passive challenges use the same eligibility boundary and preserve the owner after a failed challenge.
- AI receiver intent follows the live receiver and a bounded ball-trajectory/reachability estimate. The stationary-ball target is the ball position, and the estimate uses shared movement and ball drag settings.
- Player facing used for stationary pass/dribble contact follows root yaw. Preferred-foot and modest fictional body metadata flow through team and squad-card data. A sideline camera and camera-relative controls are present, but the frozen review found the camera-right basis sign needs correction and its focused test currently mirrors the wrong direction.
- Through/lob/cross/chip paths are partially wired through keyboard and touch handlers plus pass/shot planning hooks. The complete aerial contest/header/volley/clearance/keeper-interception loop is outside this checkpoint.

## Frozen verification

- The pre-checkpoint baseline (`7814941 Add durable Codex project handoff`) had 232 tests across 39 files with a passing TypeScript/Vite build.
- The frozen WIP run reported **261 passed / 262 total across 43 files, with one failure** in `src/core/systems/DribblingSystem.test.ts`: the distant/sharp-turn fixture expected ownership release but the current result retained ownership. This remains open future work; the Phase 6.5 gate is not passing.
- `npm.cmd run build` passed TypeScript and Vite. The main chunk was about **721.69 kB minified / 198.46 kB gzip**; the Vite 500 kB advisory remains.
- A focused reviewer checkpoint covered 39 targeted realism tests successfully, but that evidence does not replace the failing full regression or a rendered runtime gate.
- Root's pre-final mobile smoke inspection used 390×844, but no final desktop/mobile end-to-end acceptance is recorded for this WIP. Console, manual-control, touch, sustained-performance and full-match claims remain open.
- The planned B-owned `TimedBallActionAcceptance` file was not created before the coding freeze. Its coverage is therefore a required follow-up, not current evidence.

## Open acceptance work

- Add or finish integrated runtime evidence for pause mid-windup, action cancellation after ownership turnover, restart/squad Play clearing, one physical release, contact reach/height and contact-to-pose/audio alignment.
- Prove goalkeeper swept contact against the goal-plane crossing in both save-before-plane and outside-reach cases. A ball already beyond the plane must never be teleported to the keeper.
- Audit the partially implemented goal-mouth entry/keeper-contact path: the current `RestartSystem` delays goal adjudication to the goal depth instead of the whole-ball goal line, and that rule change has not been accepted.
- Exercise a moving lateral receiver, stationary loose-ball collection, retained first touch, physical dribble touches, and successful versus failed human/passive duels in one deterministic orchestration.
- Resolve the frozen `DribblingSystem.test.ts` ownership-release failure with a physically justified rule and add the cross-system regression that explains the chosen outcome.
- Confirm action queue, dribble cadence and duel cooldowns reset across match reset and squad rebuild, and include pitch bounds in the final collision review.
- Correct and retest camera-relative screen-right geometry for the sideline camera before claiming controls are aligned.
- Review contextual aerial controls in the browser. Do not describe headers, volleys, contests or keeper aerial interception as delivered until a complete loop is demonstrated.
- Run full desktop and 390×844 manual flows, including pause/resume, reset, squad Play, touch controls, camera-relative movement and console warning/error capture.

## Deferred suggestions

Full substitutions and fatigue, restart pose fidelity, half-switch audit, deeper receiver/pace calibration and presentation/audio polish remain future work. Reward progression and Phase 7 are explicitly outside this checkpoint.

This QA record does not imply Phase 6.5 acceptance. Root owns final Git delivery and verification of the checkpoint.

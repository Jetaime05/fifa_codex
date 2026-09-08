# Phase 6.5 — Football realism acceptance

Accepted **2026-09-08** after the full regression, production build, independent re-review and final desktop/mobile smoke. The original recommendations remain available in [`REVIEW.md`](./REVIEW.md). This record describes delivered behavior and observed evidence; it does not claim saved screenshots or clips.

## Delivered scope

- Shared ball scale (`radius = 0.22`) is used by visual creation, restart placement, first touch, dribbling and physics callers.
- Directional dribble reach, physical impulse touches, retained first-touch velocity and event-based duel/shielding orchestration preserve physical continuity through ownership turnover and failed challenges.
- `BallActionSystem` owns prepare/contact/recovery/cancel phases, pause-safe simulation timing, reset/generation invalidation, one physical contact release and contact reach/height acceptance. Presentation and audio follow the simulation contact clock.
- Live receiver pass intent and bounded trajectory/reachability prediction are integrated with stationary facing preservation. Preferred-foot/body metadata flows through the fictional team and squad-card data.
- The sideline broadcast camera uses corrected camera-relative screen-right geometry. Broadcast/Follow switching is wired and smoke-tested.
- Goal adjudication uses the whole-ball goal plane (`HALF_L + radius`) rather than goal depth. Swept keeper contact shares that plane and rejects rescuing a ball already beyond it.
- Through/lob/cross/chip controls and the integrated aerial loop are delivered: headers, volleys, defensive clearances, contests and goalkeeper claims do not teleport a ball after the goal plane.
- Touch controls were cleaned up and contextual Lob input triggers the pass wind-up. Reduced-motion behavior and contact-synchronized presentation/audio were verified.

## Verification

- `npm.cmd test`: **294 passed / 294 total across 48 files**.
- Independent re-review found no acceptance blocker.
- `npm.cmd run build`: TypeScript and Vite passed. Main bundle: **728.77 kB minified / 200.39 kB gzip**. The existing Vite advisory for chunks over 500 kB remains.
- Final browser QA performed on desktop and 390×844: desktop rendering; pause clock held; Squad Hub Play reset score/time and returned to kickoff; Broadcast/Follow camera switching; all eight touch buttons and joystick stayed within the 390×844 viewport; Lob triggered pass wind-up; reduced-motion toggle/class behavior; and approximately two minutes of sustained smoke.
- Browser console review found no warnings or errors.
- No screenshots or clips were saved to the repository.

## Deferred work

Phase 6.5 is accepted, but the following remain intentionally deferred:

- Scenario-based calibration of receiver prediction, movement acceleration, pass travel and pressure.
- Real fatigue and substitutions, including saved-squad, restart, dismissal and end-switch audits.
- Broader restart pose fidelity, halftime direction switching, keeper recovery and action-cancellation audits.
- Broad low-end GPU/mobile device coverage, sustained performance profiling and deeper touch usability review.
- Advanced referee edge cases, deeper tactical coaching and presentation/audio polish.
- Licensed art/audio replacement; current presentation remains fictional, generic and procedural.

Phase 7 progression, missions, rewards and extra modes may now begin but are **not started**.

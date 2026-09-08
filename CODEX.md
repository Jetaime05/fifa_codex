# Pitch11 — Codex Project Handoff

> **Read this entire file before doing any work in this repository.** This is the durable project memory for new Codex tasks/accounts. Conversation history is helpful but must not be required.

## 1. Quick orientation

- Product codename: **Pitch11**
- Current prototype title: **Elite Kickoff 3D POC**
- Repository: `https://github.com/Jetaime05/fifa_codex.git`
- Local project root used by the owner: `C:\Users\Papangkorn\Downloads\Owner\FF\fifa_codex`
- Primary branch: `main`
- Stack: TypeScript, Three.js, Vite, Vitest; no backend
- Product direction: desktop-first web prototype with responsive/touch support, eventually a mobile-first football platform
- Master requirements: [`PROJECT_PLAN.md`](./PROJECT_PLAN.md)

This file contains a snapshot, not an excuse to skip verification. At the start of every task run:

```powershell
git status --short --branch
git log -1 --oneline
npm test
npm run build
```

For a small request, run only proportionate targeted tests first, but run the full suite and production build before accepting a phase.

## 2. Authoritative current status

Snapshot updated: **2026-09-08**

- Pre-checkpoint baseline: `7814941 Add durable Codex project handoff`, with `main` and `origin/main` aligned on 2026-09-07.
- Latest accepted gameplay commit: `57291b8 Complete Phase 6 squad cards and tactics`; the newer commit adds handoff documentation only.
- The current Phase 6.5 realism WIP checkpoint is the scope documented below. The owner requested a development freeze and checkpoint delivery; root owns review, final commit/push and Git verification, while Luna MAX owns implementation, integration and documentation edits.
- Phase 0 through Phase 6 are implemented, tested, PM-reviewed, committed, and pushed.
- **Phase 6.5 — Football Realism is in progress and is not accepted.** Its current scope and evidence are recorded in [`artifacts/realism/QA.md`](./artifacts/realism/QA.md).
- **Phase 7 has not started.** The realism checkpoint must be reviewed and accepted before progression work resumes.
- The last clean baseline regression was **232 tests across 39 files**. The frozen WIP verification then reported **261 passed / 262 total across 43 files, with one failure** in the existing distant/sharp-turn dribbling ownership expectation; this remains open and is not accepted as a passing phase gate.
- The frozen WIP build passed TypeScript and Vite with a main bundle of about **721.69 kB minified / 198.46 kB gzip**. The Vite 500 kB advisory warning remains.

Treat `7814941` as the pre-checkpoint baseline; inspect the newer checkpoint delivery commit before relying on repository history.

## 3. Delivered phases

| Phase | State | Main outcome | Evidence |
| --- | --- | --- | --- |
| 0 | Accepted | Playable 3D browser match proof of concept | Git history / plan |
| 1 | Accepted | Core engine architecture and deterministic systems | Git history / tests |
| 2 | Accepted | Movement, dribbling, first touch, passing, shooting, keeper and camera feel | `PROJECT_PLAN.md` tuning notes |
| 3 | Accepted | Utility/spatial football AI, team shape, difficulty and debug telemetry | [`artifacts/phase3/QA.md`](./artifacts/phase3/QA.md) |
| 4 | Accepted | Match flow, referee/rules, restarts, stats and full-time results | [`artifacts/phase4/QA.md`](./artifacts/phase4/QA.md) |
| 5 | Accepted | Procedural presentation, stadium, animation, weather, goal effects and synthesized audio | [`artifacts/phase5/QA.md`](./artifacts/phase5/QA.md) |
| 6 | Accepted | Squad/cards/tactics management, match integration and local persistence | [`artifacts/phase6/QA.md`](./artifacts/phase6/QA.md) |
| 6.5 | **WIP — not accepted** | Football realism integration checkpoint | [`artifacts/realism/QA.md`](./artifacts/realism/QA.md) |
| 7 | **Not started — follows the Phase 6.5 review gate** | Progression and game modes | `PROJECT_PLAN.md`, Phase 7 |

## 4. What exists now

### Match and football systems

- Fixed-timestep match simulation and seeded randomness.
- 11v11 player creation, movement, sprint/stamina, collision and possession.
- Dribbling, first touch, assisted passing, interception risk, power/finesse shooting.
- Goalkeeper positioning, reactions, save/parry/claim and distribution behavior.
- Broadcast/follow cameras and player switching.
- AI utility decisions, spatial team shape, passing lanes, pressing/marking, Easy/Normal/Hard difficulty, AI-vs-AI spectator mode and debug telemetry.
- Kickoff through full time, halftime, goals, throw-ins, corners, goal kicks, free kicks and penalties.
- Fouls, cards and optional offside, advantage, added time and substitution-window placeholder.
- Match statistics and full-time result screen.

### Presentation

- Generic procedural low-poly players and kits; no licensed art.
- Pitch/stadium, four-sided stands, instanced crowd, boards and evening lighting.
- Player action poses, goal/net effects, rain, reduced-motion option and Clean view.
- Synthesized match/UI sounds and crowd ambience, gated behind explicit sound enable.

### Phase 6 management layer

- `Squad Hub` with Squad, Cards and Tactics tabs.
- 18 cards: the home XI plus seven fictional academy/reserve cards.
- Starting XI, seven-player bench, reserves and click-to-assign/swap.
- Formations: `4-3-3`, `4-4-2`, `4-2-3-1`.
- Primary/secondary positions, warnings, role-weighted team OVR and chemistry.
- Card list/detail, six attributes, rarity and a non-destructive `+3` upgrade preview.
- Team tactics: defensive line, pressing intensity, build-up speed, short/balanced/direct passing and attack width.
- Player instructions: balanced, stay back, get forward and free roam.
- Captain, penalty taker, free-kick taker and corner taker.
- Saved squad rebuilds the actual home XI and formation in the match.
- Tactics change live spatial/AI behavior without increasing base movement speed; pressing remains capped at two AI players.
- Versioned localStorage save/migration with malformed/read/write/quota diagnostics.

### 2026-09-08 Phase 6.5 realism WIP checkpoint

- The current checkpoint contains shared ball scale tuning (`radius = 0.22`), timed ball-action phases, simulation-clock presentation hooks, impulse dribbling/first-touch continuity work, event-based duel/shielding code, receiver pass intent, a sideline broadcast camera, camera-relative controls and fictional preferred-foot/body metadata. The frozen review still has an open camera-right sign issue and an unaccepted goal-line/keeper adjudication change.
- These changes are integration work in progress. The frozen test run has one open dribbling failure, and the cross-system runtime gate, final desktop/mobile browser review and root acceptance are pending.
- Through/lob/cross/chip paths are partially wired in the current checkpoint (keyboard and touch handlers plus pass/shot planning hooks); the complete aerial loop (header, volley, contest, clearance and goalkeeper interception) is not claimed as delivered.

## 5. Important files and ownership boundaries

- `src/main.ts` — application composition and runtime integration. Keep domain logic out when practical.
- `src/core/systems/` — deterministic match, AI, rules and tactics systems.
- `src/core/systems/TacticsSystem.ts` — sanitizes tactics and derives runtime modifiers/instructions.
- `src/management/types.ts` — Phase 6 management schema.
- `src/management/SquadSystem.ts` — squad store, persistence, formations, OVR, chemistry, validation and match-data conversion.
- `src/management/SquadUI.ts` / `SquadUI.css` — accessible responsive management overlay.
- `src/data/fictionalSquadCards.ts` — current card catalog extension.
- `src/data/teams.ts` — original match team data.
- `src/rendering/` — scene/stadium/player presentation. Player rig geometry is shared; do not dispose it when replacing only the home XI.
- `src/audio/MatchAudio.ts` — synthesized audio lifecycle.
- `artifacts/phaseN/QA.md` — honest acceptance evidence and limitations for each completed phase.

Tests live next to systems. Cross-system phase gates use files such as `Phase4Acceptance.test.ts`, `Phase5Acceptance.test.ts`, and `src/management/Phase6Acceptance.test.ts`.

## 6. Non-negotiable invariants and known decisions

- The match remains deterministic where seeded tests expect determinism.
- Presentation must never mutate gameplay root position, velocity, stamina or consume gameplay RNG.
- Difficulty and tactics may alter decisions/shape, not raw player speed cheats.
- At most two AI pressers per defending team.
- Match data must contain exactly 11 unique players per team with finite values.
- Squad UI opening pauses the current match. Close/Escape resumes the prior flow; Play rebuilds and resets the match using the confirmed squad.
- Card-id player instructions must be mapped to runtime IDs like `home-2` before AI evaluation.
- Configured home set-piece card IDs must map to runtime player IDs; an unavailable taker falls back safely.
- localStorage access can throw or contain malformed data; never make app startup depend on successful storage.
- All current added player/card art is fictional or generic. Do not add licensed logos, kits, likeness art or scraped assets.
- Phase 4 substitutions are only an eligibility/window placeholder, not a full bench substitution system.
- Do not claim screenshots, videos, listening tests or device coverage that were not actually captured/performed.

## 7. Next work: Phase 6.5 review, then Phase 7 — Progression and Modes

### 2026-09-08 realism implementation checkpoint (WIP; not accepted)

- The original recommendations remain preserved in [`artifacts/realism/REVIEW.md`](./artifacts/realism/REVIEW.md).
- The current implementation checkpoint is documented in [`artifacts/realism/QA.md`](./artifacts/realism/QA.md). It records the actual checkpoint scope and separates targeted evidence from unverified runtime claims.
- Root is review-only for this checkpoint: root ran the frozen regression/build, owns the remaining review findings, browser desktop and 390×844 review, and Git delivery. Luna MAX owns the implementation, integration and documentation edits for this checkpoint.
- Phase 7 remains unstarted and must not be pulled into this realism work. See [`FUTURE_WORK.md`](./FUTURE_WORK.md) for deferred realism items.

Read the complete Phase 7 section in `PROJECT_PLAN.md` before designing. Required scope:

### 7A Reward loop

- Match rewards: coins, XP and performance bonus.
- Win/draw/loss must yield meaningfully different rewards.
- A completed match produces a clear, idempotent reward result; restarting/reloading must not duplicate it.

### 7B Player upgrade loop

- Per-card XP/level or equivalent progression.
- Upgrade cost, explicit confirmation and visible attribute/OVR improvement.
- Rewards must be spendable to improve a card used by SquadSystem/match data.

### 7C Missions

- Daily missions, weekly missions and match objectives.
- Track progress from real match events/results.
- Explicit claim flow; rewards must not be claimable twice.
- Offline/local time handling should be deterministic and testable—do not build a fake backend.

### 7D Game modes

- At least one mode beyond Quick Match must be playable end-to-end.
- Tournament or Season is required for the gate; penalty shootout and AI challenge are optional.
- Define mode state and completion/reward rules before expanding UI.

### 7E Local save

- Persist squad, coins, upgrades, settings and mission progress.
- Refresh must preserve progression.
- Use a versioned, migration-safe local schema. Decide whether to compose with or migrate the existing Phase 6 squad key; do not silently orphan existing saves.

Phase 7 gate: **play match → earn rewards → upgrade a card → see a stronger squad**, persisted locally, plus at least one extra playable mode and no backend.

Suggested implementation order:

1. Define a versioned progression/mode domain and migration plan.
2. Implement reward calculation and exactly-once match settlement.
3. Implement upgrades that feed the existing card attributes/OVR/match builder.
4. Implement mission tracking and claim idempotency.
5. Implement one small complete extra mode, preferably a short local Season or Tournament bracket.
6. Add the progression/mode UI and wire it to real match completion.
7. Add integrated acceptance tests, browser smoke, `artifacts/phase7/QA.md`, then update this file and `PROJECT_PLAN.md`.

## 8. Multi-agent working agreement

The owner prefers parallel Luna agents for full phase implementation. When the user asks to implement/continue a phase, delegation is explicitly desired unless they say otherwise.

- Preferred coding sub-agent: `gpt-5.6-luna` with `max` reasoning, when available.
- There are normally four concurrency slots including the PM/root agent, so use at most three simultaneous sub-agents.
- Give each agent a concrete, independent file ownership boundary to prevent shared-worktree conflicts.
- Agents edit the same working tree. Do **not** cherry-pick their work.
- For the active Phase 6.5 task, the user's role rule supersedes the older PM-owned integration wording: Luna MAX owns implementation, `src/main.ts` integration, cross-module fixes and Phase 6.5 documentation. Root is review-only and owns review findings, final full suite/build, browser QA, phase acceptance and Git delivery; root writes no gameplay or integration code for this checkpoint.
- Do not infer that the dormant Phase 7 split below overrides this active rule. Confirm ownership again when Phase 7 starts.
- Do not let multiple agents edit `src/main.ts`, `PROJECT_PLAN.md` or the same CSS/test file concurrently.
- When an agent finishes early, reuse the slot for independent acceptance/review rather than starting overlapping implementation.

Suggested initial Phase 7 split (adjust after inspecting current APIs):

- **Luna A — progression domain:** rewards, currency, card XP/upgrades, versioned store and unit tests. Own new `src/progression/` domain files only.
- **Luna B — missions:** definitions, event/progress/claim logic and unit tests. Own new mission-domain files only.
- **Luna C — modes/UI foundation:** one extra local mode plus progression/mode UI components and focused tests; agree exact folders before editing.
- **Root PM when Phase 7 is explicitly resumed:** schema contract, existing SquadSystem compatibility, `main.ts` match settlement/integration, final UX fixes, acceptance tests and QA docs. This dormant plan does not override the active Phase 6.5 ownership above.

Before dispatching agents, root must publish shared interfaces and file ownership. If APIs are not stable, ask agents to build pure modules first and defer integration.

## 9. Definition of done for every phase

A phase is not done merely because code compiles.

- All requested sub-phases and the phase gate are implemented.
- New behavior has focused unit tests and at least one cross-system acceptance test.
- Existing full regression passes.
- `npm run build` passes; warnings are reported honestly.
- Real browser flow is inspected at desktop and 390×844 mobile when UI/runtime behavior changes.
- Browser console errors/warnings are checked.
- Persistence is tested through an actual reload when save behavior changes.
- `artifacts/phaseN/QA.md`, `PROJECT_PLAN.md` status and this `CODEX.md` snapshot are updated.
- Independent review reports no blocking findings, or blocking findings are fixed and retested.
- Commit/push happen only when the user asks. Before committing, inspect staged scope and run `git diff --cached --check`.

## 10. Git and safety rules

- Preserve user changes and unrelated dirty files; do not reset or overwrite them.
- Never use destructive Git commands such as `git reset --hard` or `git checkout --` unless the user explicitly requests them.
- Work on `main` unless the user requests another branch/worktree.
- Remote is expected to be `origin https://github.com/Jetaime05/fifa_codex.git`; verify rather than assume.
- Use clear phase commits, e.g. `Complete Phase 7 progression and game modes`.
- Push only after explicit user authorization and verify `HEAD`, `origin/main`, and working-tree status afterwards.

## 11. Known follow-ups outside Phase 7

- Code-split the large production bundle when optimization becomes priority.
- Capture repository-stored demo screenshots/clips; prior browser visuals were inspected live but not saved as media artifacts.
- Broader low-end/mobile GPU and touch usability testing.
- Replace placeholder synthesized audio/procedural art only with properly licensed assets.
- Full substitutions, advanced referee edge cases and deeper tactical coaching remain future scope.
- Online economy, auction market, cloud saves and multiplayer belong to Phase 8+; do not pull them into Phase 7.

## 12. Handoff maintenance checklist

At the end of meaningful work, update at least:

- Snapshot date, latest commit and branch alignment.
- Current phase/sub-phase state.
- Exact full test count and build result.
- New architecture/files and important invariants.
- Known bugs, warnings and unverified evidence.
- Next concrete task and recommended agent split.

The goal is that a fresh Codex task can read **this one file**, verify the repository, and continue correctly without asking the owner to reconstruct the project history.

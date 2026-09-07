# Phase 6 — Squad, cards and tactics acceptance

Reviewed 2026-09-07. Phase 6A–6E is accepted for the local, fictional-card prototype scope.

## Delivered

- Versioned squad data with 18 cards, three formations, starting XI, seven-player bench, reserves, position validation, team OVR, chemistry, captain and set-piece assignments.
- A keyboard-accessible Squad Hub with Squad, Cards and Tactics tabs; click-to-assign/swap, formation selection, warnings, card detail/attributes/rarity/upgrade preview, and responsive layouts.
- Team controls for defensive line, pressing intensity, build-up speed, passing style and attack width, plus per-player balanced/stay-back/get-forward/free-roam instructions.
- Automatic version-2 local persistence with migration and malformed/read/write/quota recovery diagnostics.
- Match integration that rebuilds the home XI from the saved squad, uses the chosen formation, sends tactics to the live AI, and honors the selected penalty, free-kick and corner takers.

The seven added reserve players and all presentation are fictional/generic. No licensed card art, online inventory, economy or transfer market was added.

## Automated evidence

- `npm.cmd test`: **232 tests pass across 39 files**.
- Phase 6 acceptance: 3 integrated scenarios cover save/reload, formation changes, exactly 11 unique finite match players for all formations, set-piece/captain persistence, and observable low/high tactical shape and pressing differences.
- Management: 9 squad-store tests and 7 UI tests cover migration, malformed/quota-safe storage, secondary positions, real-store UI integration, assignment, tactics, roles and player instructions.
- Runtime tactics tests preserve the two-presser ceiling and the existing Phase 3 acceptance suite still produces passes, shots and goals without a speed bonus.
- `npm.cmd run build`: TypeScript and Vite production build pass. The existing main-bundle warning remains (about 669 kB minified / 183 kB gzip).

## Browser smoke evidence

- Opened Squad Hub during live play and confirmed the match pauses; closing/playing returns to a valid match flow.
- Changed formation to 4-4-2. The live squad used Nico Vale's secondary MID eligibility, showed a match-ready XI, and Play rebuilt a valid 22-player match (11 per team).
- Set Carvajal to Stay back and started the match. Runtime debug reported `formation: 4-4-2`, `instructions: { "home-2": "stayBack" }`, valid squad state, and the selected set-piece card ids.
- Reloaded the page and confirmed 4-4-2, Stay back, 22 players and valid squad state persisted.
- Inspected desktop and a 390×844 mobile viewport. The mobile overlay remains scrollable and its pitch uses a taller layout to keep four-player lines readable.
- Final browser console check showed no warnings or errors during the Play flow.

## PM review corrections

1. Connected the saved XI to actual home-player construction instead of leaving management as an isolated menu.
2. Routed saved tactics into both spatial planning and the later AI pressing-slot selection, preserving the maximum of two pressers and base movement speed.
3. Mapped card-id instructions to runtime player ids before AI evaluation.
4. Added preferred set-piece takers to restart placement with a safe nearest-player fallback.
5. Fixed UI/domain field mismatches for pressing, build-up and set-piece setters.
6. Fixed secondary-position validation so a DEF/MID card assigned to midfield is not incorrectly blocked by the UI.
7. Added the missing per-player instruction controls and removed an unsupported Creative passing option.
8. Kept shared procedural player geometry alive while releasing only replaced XI materials and textures.

## Remaining follow-ups

- Demo screenshots and a recorded before/after tactic clip were inspected live but are not stored as media artifacts in the repository.
- The production bundle remains above Vite's 500 kB warning threshold; code splitting is a future optimization.
- Tactical effects are deterministic prototype modifiers, not a full coaching simulator. Broader device/GPU and touch usability testing remains useful.

No commit or push is implied by these local QA results.

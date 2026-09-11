# Phase 7 — Progression and Modes QA

Accepted: **2026-09-11**

## Delivered scope

- Deterministic match rewards with materially different win/draw/loss values,
  performance bonus, Coins and XP.
- Exactly-once match settlement keyed by stable match ID, plus idempotent
  external credits for mission and Season rewards.
- Per-card XP/level state, escalating upgrade cost, explicit confirmation,
  insufficient-funds handling and additive attribute boosts applied to the
  real SquadSystem card catalog and match-team builder.
- Daily, weekly and match-scoped missions driven by completed-match stats,
  deterministic caller-supplied calendar periods and explicit exactly-once
  claim flow.
- A deterministic six-fixture offline Season with current fixture, results,
  standings, placement/champion state and completion reward.
- Responsive Progression Hub for Coins/XP/team OVR, reward detail, upgrades,
  mission claims, Quick Match and Season start/continue/new-season actions.
- Versioned local persistence for progression, missions, Season and settings.
  The existing Phase 6 squad key remains intact and continues to persist the
  squad separately.

## Automated evidence

Final accepted run:

- `npm test`: **339 passed / 339 total across 56 files**.
- `npm run build`: passed TypeScript and Vite.
- Integrated Phase 7 acceptance covers:
  - play → reward → mission claim → confirmed card upgrade → stronger match data;
  - duplicate match settlement, mission claim and reward credit rejection;
  - progression and mission reload from storage;
  - complete Season schedule, exactly-once completion reward and reload;
  - unique fixture IDs across successive Seasons and durable replay of claimed
    external rewards into the progression ledger after a partial storage failure;
  - settings reload without replacing the existing squad save.

Production build at acceptance:

- CSS: **38.25 kB minified / 8.05 kB gzip**.
- JavaScript: **792.81 kB minified / 220.31 kB gzip**.
- The existing Vite advisory for chunks over 500 kB remains. Code splitting is
  deferred product work, not a Phase 7 blocker.

## Browser evidence

Inspected live at the local Vite build:

- Desktop match rendering and Progression Hub layout.
- Progression Hub at **390×844**, including responsive single-column mode cards,
  upgrade list and mission content.
- Quick Match 30-second demo completed 2–1. The result view showed **+307 Coins
  / +200 XP**, including its performance bonus.
- Three real missions became claimable from that result. Claiming the daily
  match mission increased the profile from 357/200 to **407 Coins / 250 XP**
  and changed the mission to already claimed.
- Confirming the Courtois upgrade spent 120 Coins, changed the visible card
  preview from **76→77**, and raised the next upgrade cost to 200 Coins.
- Season start and continue actions rebuilt a match from the saved current
  fixture. A fresh browser tab retained the active **0/6** Season state.
- Browser console: no warnings or errors observed after the flows above.

No screenshots or clips were saved to the repository. The complete six-match
Season was verified through deterministic automated acceptance rather than a
six-match live browser run.

## Known limitations

- The current Season displays each fictional fixture opponent and tracks its
  standings, but reuses the existing opponent player roster/kit simulation.
- All progression is offline/local; there is no account, backend, cloud save,
  online economy or anti-cheat.
- A low-end physical-device pass, sustained performance profile and stored demo
  media remain future work.

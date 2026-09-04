# Phase 5 — Presentation direction

## Demo-quality target

Stylized realism: readable football silhouettes, physically plausible proportions and joint motion, crisp pitch markings, warm floodlights against a cool evening arena, white/navy and sky-blue team separation. This is a lightweight desktop-browser demo, not photoreal player likenesses.

The broadcast view prioritizes the ball, spacing and team identity. Follow camera exposes the articulated model and action poses. Clean view removes optional overlays while retaining the score and a visible route back to controls.

## Player / kit strategy

- Procedural low-poly articulated hierarchy: torso, head/hair, shoulders/elbows, hips/knees, boots; contrasting keeper kits and gloves.
- Shared geometry and a small set of shadow casters per player. A separate child pose hierarchy ensures animations cannot alter collision positions or match simulation.
- Generic colors, collars and trim; existing roster names remain gameplay data. No licensed kit textures, badges, sponsors or scanned likenesses were added.
- Idle/run cycles and timed pass/kick/shot/tackle/dive/celebration poses are original procedural placeholders.
- Future imported models should preserve root ownership, normalized height, jersey palette slots and action names. A GLTF rig may replace the procedural one without changing physics.

## Stadium / effects strategy

- Original code-generated grass texture, mowing bands, inward field markings, scaled penalty spots, goal frames and anchored net grid.
- Four-sided tiers, instanced crowd blocks, generic advertising boards, roof strips and lamp fixtures. No downloaded stadium assets.
- One shadow-casting key light, cool fill and hemisphere lighting; ACES tone mapping. Shadow map 1024² and pixel ratio capped at 1.5.
- Bounded shot ring/ball trail, damped scored-net deformation, crowd reaction and cosmetic rain. Weather must never change ball physics in this phase.
- Goal overlay and camera emphasis identify the scorer and score. Reduced-motion mode removes camera bursts, animated poses and transient particle effects while keeping the game playable.

## Audio strategy

- Original Web Audio synthesis: kick, pass, shot, tackle, whistle, goal, UI, save and fulltime cues plus filtered crowd-noise ambience.
- No remote samples, music, voices or copyrighted recordings. No external runtime downloads.
- Explicit Enable sound gesture; default silent. Volume/mute, paused/background silence, capped voices, short envelopes and a compressor prevent runaway audio.
- The Sound check selector is an audition aid; it does not manufacture goals or match events. Human listening on target speakers/headphones remains useful for mix tuning.

## Animation / asset sourcing policy

All Phase 5 presentation assets are generated from repository code. Future external assets require a recorded source, author, license, attribution and redistribution compatibility before being included. Purchased, ripped or unverified football-game assets are not part of this implementation.

## Acceptance boundaries

The goal is visibly animated, audible, readable and bounded-cost presentation while retaining all Phase 4 rules. Full motion capture, licensed branding, photorealism and voice commentary remain out of scope. A recorded 60-second cinematic clip is presentation evidence, not a substitute for gameplay regression tests or a broad device-performance benchmark.

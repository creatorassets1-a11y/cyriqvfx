# ADR 0004 — One composition, two consumers

**Status:** accepted

## Context

PRD §3.1 requires that the export match the preview to within one frame, and
§3.6 repeats it. Preview and export are different Media3 components:
`CompositionPlayer` and `Transformer`.

The usual way this is built — a bespoke preview renderer alongside a separate
export path — creates two implementations of the edit. They agree at first and
drift with every feature added, and the drift shows up as bug reports of the form
"the exported video isn't what I saw", which are expensive to diagnose because
neither path is obviously wrong.

## Decision

Both consume a single `androidx.media3.transformer.Composition`, built by
`CompositionBuilder.build(project)`, derived from the engine's fully-resolved
`RenderFrame` description.

Two supporting rules:

- **`composeFrame` leaves nothing unresolved.** Speeds are applied, source times
  are computed, mute and solo are collapsed into one volume per layer. A consumer
  has no decision left to make, so two consumers cannot decide differently.
- **Clipping uses microseconds, not milliseconds.** Media3's
  `ClippingConfiguration` offers both. At millisecond precision each cut gives
  away up to a twentieth of a frame, which accumulates visibly over a long
  timeline and would defeat the tick base's whole purpose.

## Consequences

Preview inherits Transformer's constraints — effects must be expressible as
Media3 `Effect`s to appear in both. When Phase 2 adds FFmpeg-based filters that
Media3 cannot preview, those need an explicit strategy (a proxy render for
preview), and this ADR is where that trade-off gets recorded rather than
discovered.

`CompositionPlayer` is `@UnstableApi`. That is accepted, and it is why
`PreviewPlayer` wraps it behind a small interface: if it has to be replaced, the
editor does not change.

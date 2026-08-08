# ADR 0005 — Rendering keyframed properties

**Status:** accepted

## Context

Phase 2 adds keyframes. ADR 0004 established that the preview and the exporter
must consume one `Composition`, and keyframes are the first feature with the
power to break that: Media3's `ScaleAndRotateTransformation` takes fixed numbers,
so an animated transform cannot be expressed with it.

The obvious workaround is to animate the preview in the app's own compositor and
bake the animation separately at export. That immediately gives two
implementations of the same animation, and the resulting "the export isn't what I
saw" reports are miserable to diagnose because neither path looks wrong on its
own.

## Decision

Animate through **`MatrixTransformation`**, which is a function from presentation
time to an `android.graphics.Matrix`, evaluated by the effect pipeline that both
`CompositionPlayer` and `Transformer` run. `KeyframedTransformation` implements
it by calling the engine's own interpolator.

The same effect is used for static transforms too. A static transform is an
animation with no keyframes, so routing both through one path means the preview
cannot start behaving differently from the export at the moment a first keyframe
is added — the code path does not change.

Two details that are easy to get wrong and were handled explicitly:

- **Coordinates are normalised, not pixels.** Media3 works in x ∈ [-1, 1],
  y ∈ [-1, 1] with the origin at the centre. Position keyframes are authored in
  pixels, so they are divided by half the frame size. Y is negated, because NDC
  points up and the values the user drags point down.
- **NDC is square and frames usually are not**, so a naive rotation shears the
  picture — a 45° turn on 16:9 comes out visibly skewed. The rotation is wrapped
  in a scale into square space and back out.

## What this does not cover

A matrix expresses geometry. It cannot express **alpha**, so animated opacity is
modelled, stored and correctly resolved by `composeFrame`, but the renderer
currently applies only the static value. The same is true of animated **volume**:
`Composition` has no time-varying gain.

Both need a shader program or an audio processor rather than a matrix. They are
recorded as `Modelled` in the feature coverage table rather than quietly claimed
as done — the engine half is finished and tested, and the renderer half is not.

## Consequences

Effects added in Phase 2 must be expressible as Media3 `Effect`s to appear in
both preview and export. When FFmpeg-based filters arrive (ADR 0002) they will
not be, and that is the point at which a proxy-render strategy for preview has to
be chosen. This ADR is where that trade-off should be revisited rather than
rediscovered.

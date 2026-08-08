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

## Beyond geometry: alpha and gain

A matrix expresses geometry and nothing else, so opacity and volume each needed
their own mechanism. Both now exist, and the asymmetry in how confident we can be
about them is worth stating.

**Volume — `KeyframedGainProcessor`, a `BaseAudioProcessor`.** `queueInput`
carries no timestamp, so position is counted in frames against the configured
sample rate, with `onFlush` taking Media3's position offset so a mid-clip seek
resumes at the right point in the envelope. This is pure `ByteBuffer` arithmetic,
so it is **fully verified**: the ramp is compared against the engine's
interpolator sample by sample, and saturation at gains above 1 is asserted in
both directions.

One consequence had to be handled in `CompositionBuilder`: transmuxed audio is
copied through without decoding, so it never reaches the processor. Volume
automation therefore vetoes transmuxing. Without that the fade would be audible
in the preview and silently absent from the export — the exact divergence this
ADR exists to prevent, arriving through a performance optimisation.

**Opacity — `KeyframedAlphaEffect`, a `GlEffect`.** Its shader program sets
`uAlphaScale` in `drawFrame`, where the presentation time is available. Two
things kept the risk down: `GlProgram` accepts shader **source strings**, so
there is no asset packaging to get wrong, and the fragment shader is Media3's own
`fragment_shader_alpha_scale_es2.glsl` adopted verbatim (Apache 2.0, attributed
in `docs/LICENSES.md`). The only original decision is *when* the uniform is set.

**The honest limit:** GLSL cannot be executed without a GPU, and the development
host has no emulator. The uniform computation is unit-tested; the shader is not.
The coverage table says so rather than implying the feature is equally proven.

## Consequences

Effects added in Phase 2 must be expressible as Media3 `Effect`s to appear in
both preview and export. When FFmpeg-based filters arrive (ADR 0002) they will
not be, and that is the point at which a proxy-render strategy for preview has to
be chosen. This ADR is where that trade-off should be revisited rather than
rediscovered.

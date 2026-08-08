# ADR 0007 — Background removal architecture

**Status:** accepted · **Research:** [`docs/research/01-video-matting-2026.md`](../research/01-video-matting-2026.md)

## Context

The brief asks for the best background removal shipped in a mobile editor,
covering both green-screen keying and automatic AI matting, with manual
refinement, real-time and high-quality modes, and strong temporal stability.

The research changed the shape of the answer. The two strongest systems —
MatAnyone 2 (state of the art) and RVM (the default choice for real-time) — are
**licensed out of reach**: S-Lab 1.0 is non-commercial only, and RVM is GPL-3.0,
which would relicense this MIT app. What ships must have permissive terms on both
code and weights.

## Decision

One matte pipeline, four interchangeable **matte sources**, and a shared
refinement chain. The source varies; everything after it does not.

```
                    ┌─ Chroma key      (shaders, no model)
 frame ─────────────┼─ MODNet          Apache 2.0 — fast tier
                    ├─ BiRefNet        MIT        — quality tier
                    └─ Manual mask     paint / shapes
                              │
                              ▼
              ┌───────────────────────────────┐
              │  refinement (shared)          │
              │  guided filter ← full-res luma│
              │  temporal stabiliser          │
              │  choker · feather · clip      │
              │  spill suppress · light wrap  │
              └───────────────────────────────┘
                              │
                              ▼
                  composite over background
```

### Why the chain is shared

Every source produces a single-channel alpha at some resolution. Refinement,
temporal handling and compositing are then identical. Three consequences make
this worth more than the abstraction costs:

- A user can key with chroma, then hand-paint corrections, then apply light wrap —
  the refinement does not care which source produced the alpha.
- Temporal stabilisation is written once and benefits the keyer too, which
  flickers on noisy footage just as models do.
- Swapping MODNet for a better Apache-licensed model later touches one class.

### Chroma key first, and not as a consolation

On footage actually shot against a screen, a good keyer beats every model in the
research — it is solving a far better-posed problem, and it wins decisively on
hair. It is also pure per-pixel shader work with no model, no inference thread,
and no memory spike, so it runs at full resolution in real time on every device
class including Low.

Built as an explicit chain rather than one "similarity" slider:

1. Key in **YCbCr chroma distance from the screen axis**, not RGB Euclidean
   distance — this is what survives an unevenly lit screen.
2. **Tolerance and softness as separate radii** (fully transparent inside, falloff
   to the outer edge). Merging them into one control is the main reason cheap
   keyers look cheap.
3. **Matte cleanup**: choker, black/white point, despeckle.
4. **Spill suppression** by limiting the screen channel against the other two
   (`G → min(G, mix(R,B))` for green), scaled by transparency and applied only in
   the spill band. Naive green desaturation turns skin grey; this does not.
5. **Light wrap**: bleed background colour into the edge band. Its absence is why
   composites look pasted on even with a perfect matte.
6. **Edge-band secondary correction**.

### The two model tiers

| | Fast | Quality |
|---|---|---|
| Model | MODNet (Apache 2.0) | BiRefNet (MIT) |
| Inference res | 384–512 px short edge | 1024 px+ |
| Use | Live preview, scrubbing | Render, and preview on High-tier devices |
| Temporal | EMA + motion gate | + optical-flow warped prior |

**Inference does not run at output resolution.** A small network plus a guided
upsample against the full-resolution luma is both faster and frequently *sharper*
on hair than running the network large, because once an edge-aware upsample is
applied the network's own boundary stops being the limiting factor. This is the
single decision that makes the fast tier viable on a mid-range phone, and the
guided filter is therefore the highest-value component in the chain — not the
model.

### Temporal stability

The shippable models are per-frame and will flicker if used naively. This is the
main engineering work, not a polish step:

- **Motion-gated EMA.** Blend with the previous alpha, weight driven by local
  motion. Heavy smoothing where static — where flicker is most visible — and none
  where moving, where it would smear.
- **Flow-warped prior** (quality tier). Warp the previous alpha into the current
  frame before blending. This is what stabilises a *moving* subject, where EMA
  alone fails.
- Both are gated by `PerformancePolicy` (ADR: `core:device`), so a Low-tier device
  gets EMA only and is told why.

Target: `dtSSD < 2.0`, below the published figure for methods that read as
visually stable.

### Manual refinement

The matte is editable after any source: paint keep/remove with a soft brush,
add/subtract shape masks, adjust the refinement sliders. Strokes are stored as
**vector operations against clip-relative time**, not a rasterised bitmap per
frame — the same reasoning that puts keyframes in clip-relative time, so a stroke
survives moving or rippling the clip, and a project stays kilobytes rather than
gigabytes.

### Backgrounds

Transparent (alpha preserved through export where the codec allows), solid
colour, image, video, or blurred original. Blur is a separable Gaussian on the
GPU using the already-decoded frame — no second decode.

## Runtime

**ONNX Runtime Mobile**, called from C++ so no JNI hop sits in the frame path.
Both models publish ONNX exports, so upstream updates need no conversion step.
NNAPI is deprecated for new work in 2026; vendor delegates are used where
present, CPU otherwise. NCNN stays the fallback if binary size proves
unacceptable — the `MatteSource` interface keeps that swap to one file.

INT8 for the fast tier, FP16 for quality, both **gated on accuracy, not just
speed**: a quantised model that loses 2 dB of `Grad` has eaten the hair quality
this feature exists to provide.

## What is explicitly not claimed

No latency number in this document has been measured. This environment has no
GPU, no NPU and no emulator, so every figure is a target derived from published
desktop results and model size. The benchmark harness is part of the first
implementation slice precisely so these become measurements the moment real
hardware is available — and until then the feature coverage table will say
"target", not "achieved".

Likewise, "better than CapCut on hair" is not a claim this ADR makes. The testable
form is: **`Grad` at or below RVM-Large's published 12.97**, i.e. match the GPL
model we may not ship, using models we may.

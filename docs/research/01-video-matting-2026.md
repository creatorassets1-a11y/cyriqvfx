# Video matting for ApexEdits — research, August 2026

Research done before writing the background-removal system, as the brief
required. The conclusion is not the one the field's headline results suggest, and
the reason is licensing rather than accuracy.

---

## The finding that decides the design

**The two best-performing video matting systems cannot ship in this app.**

| System | Quality | Licence | Shippable in ApexEdits? |
|---|---|---|---|
| **MatAnyone / MatAnyone 2** | State of the art | **S-Lab License 1.0 — non-commercial only** | **No** |
| **Robust Video Matting (RVM)** | Strong, real-time | **GPL-3.0** | **No** |
| MODNet | Good, real-time | **Apache 2.0, code *and* weights** | Yes |
| BiRefNet | Excellent (image-level) | **MIT** | Yes |

ApexEdits is MIT-licensed, free, and ad-free. Two separate problems follow:

- **RVM is GPL-3.0.** Linking it would force the entire application to GPL-3.0.
  This is the same trap as the `ffmpeg-kit-gpl` build already rejected in
  ADR 0002 — and RVM is the obvious pick, the one most implementations reach for,
  because it is the best-known "real-time video matting" project. Discovering
  this after building the pipeline around it would be expensive.
- **MatAnyone is worse than GPL for our purposes**: S-Lab 1.0 permits
  non-commercial use only and directs commercial users to contact the authors.
  "Free app" is not the same as "non-commercial", and a Play Store release is not
  a defensible reading of that licence. It cannot be shipped, only used as an
  offline reference to measure against.

There is a real nuance worth stating rather than glossing: it is legally
unsettled whether trained weights are a derivative work of the training code, so
some projects treat GPL code and its published weights as separable. That
argument is not one to bet a shipped product on. The engineering position here is
to ship only components whose **code and weights both carry explicit permissive
terms**.

MODNet is unusual in stating this cleanly — its README puts code, models and
demos under Apache 2.0 together. That is worth more than a couple of points of
MAD.

---

## What the numbers actually say

From MatAnyone 2's own comparison table (YouTubeMatte, 1920×1080 — lower is
better throughout):

| | MAD | MSE | Grad | dtSSD |
|---|---|---|---|---|
| MatAnyone 2 | **1.61** | **0.50** | **7.13** | **1.53** |
| MatAnyone | 1.99 | 0.71 | 8.91 | 1.65 |
| MaGGIe | 2.37 | 0.98 | 7.69 | 1.77 |
| RVM-Large | 3.58 | 1.23 | 12.97 | 2.04 |
| FTP-VM | 6.49 | 4.58 | 29.78 | 2.41 |

Two things to read from this beyond the ranking.

**`dtSSD` is the column that matters most for a video editor.** It measures
temporal dissimilarity — frame-to-frame instability — and it is what the user
perceives as *edge flicker*, the single most recognisable failure of automatic
background removal. A model can win on MAD and still look worse in motion. The
spread here (1.53 → 2.41) is narrower than the MAD spread (1.61 → 6.49), which
tells you temporal stability is largely an *architectural* property — recurrence
or memory propagation — rather than something that improves automatically with
per-frame accuracy.

**`Grad` is the hair column.** Gradient error concentrates in the soft,
high-frequency boundary regions: hair, fur, motion blur, semi-transparency. It is
the metric to watch for the "better than CapCut on hair" goal, and the one where
per-frame image models with a strong boundary decoder (BiRefNet) do well even
without any temporal component.

**MatAnyone 2 is server-class, not a mobile candidate.** Its quality evaluator is
DINOv3 features with a DPT decoder, trained on 8× A800-80G at 480×480. The paper
quotes **no inference speed at all** — which is itself informative. It is a
reference to measure against, not a thing to port.

---

## Architecture the evidence supports: two tiers, not one

No single model is both real-time on a mid-range phone and best-in-class on hair.
Pretending otherwise is how these systems end up mediocre at both. So the design
is two explicit tiers with an honest quality/latency trade, exposed to the user
as *Fast preview* and *High quality*, and — critically — **the same tier is used
for preview and export within a chosen quality mode**, so the PRD's preview/export
parity rule (ADR 0004) survives.

### Tier 1 — Real-time preview: MODNet (Apache 2.0)

Trimap-free, RGB-only, designed for real time, ~7 MB at the demo size. It
decomposes matting into semantic estimation, detail prediction, and fusion, which
maps well onto a mobile budget: the semantic branch can run at reduced resolution
while the detail branch works at a higher one.

MODNet is *per-frame* and has no temporal component, so it will flicker if used
naively. That is a solvable problem and is addressed below — it is the main
engineering work of this tier, not an afterthought.

### Tier 2 — High-quality render: BiRefNet (MIT)

Bilateral reference with high-resolution boundary refinement; strong exactly
where `Grad` is measured. MatAnyone 2 itself uses BiRefNet to produce its
first-frame masks, which is a useful endorsement of its boundary quality from the
current state of the art.

Too heavy for live preview on a phone; entirely reasonable for a render pass or a
background "analyse this clip" job, which is how CapCut's higher-quality mode
behaves in practice.

### Temporal stability: earn it in our own code

Since the shippable models are per-frame, temporal coherence has to be built
rather than inherited. Three mechanisms, cheapest first:

1. **Alpha-domain temporal EMA with motion gating.** Blend the current alpha with
   the previous frame's, with the blend weight driven by local motion magnitude —
   strong smoothing where the frame is static (which is where flicker is most
   visible), little to none where it is moving (where smoothing would smear).
2. **Optical-flow warped prior.** Warp the previous alpha into the current frame
   using a cheap dense flow, then use it as a prior for the blend. This is what
   removes flicker on a *moving* subject, where a naive EMA fails. Cost is
   material; it belongs to the high-quality tier and to devices classed Medium
   and above.
3. **Guided filtering against the source luma.** A joint/guided filter pulls the
   alpha edge onto the real image edge. It is cheap, it runs well as a GPU
   compute shader, and it is what recovers hair detail lost to running inference
   at reduced resolution. This is likely the single highest-value component in the
   whole chain, because it lets the network run small and puts the detail back
   from the full-resolution frame.

Point 3 deserves emphasis: **the model does not need to run at output
resolution.** Inference at 512×288 with a guided upsample against a 1080p luma
guide is both far faster and often *sharper* on hair than inference at 1080p,
because the network's own boundary is not the limiting factor once a proper
edge-aware upsample is applied. This is the trick that makes the real-time tier
viable on a mid-range device.

---

## Traditional chroma key is not the poor relation

The brief asks for chroma key better than Premiere's Ultra Key. Worth being clear
that on genuinely green-screened footage, a good chroma keyer **beats every AI
matter on this list**, and by a wide margin on fine detail — it is solving a much
easier, better-posed problem. The AI path is for footage that was never shot for
keying.

A professional keyer is not one slider. The chain, in order:

1. **Colour-space projection.** Key in YCbCr or a chroma-difference space, not
   RGB distance. Screen colour defines an axis; distance from that axis in the
   chroma plane gives a far cleaner separation than Euclidean RGB, and it is
   what makes a key survive uneven screen lighting.
2. **Tolerance and softness as two separate controls** — the inner radius that is
   fully transparent and the outer radius where the falloff ends. One combined
   "similarity" slider is the main reason cheap keyers look cheap.
3. **Matte cleanup**: choker (erode/dilate on the alpha), black/white point
   clipping to force near-transparent and near-opaque regions to the rails, and
   despeckle.
4. **Spill suppression.** The part most implementations do badly. Naive
   desaturation of green turns skin grey. The correct approach limits the screen
   channel to a function of the other two — for green, clamp G toward
   `max(R, B)` or a weighted blend — and only inside the spill region, with
   strength scaled by how transparent the pixel is.
5. **Light wrap.** Blend background colour into the subject's edge in proportion
   to edge proximity. This is what actually sells a composite; its absence is why
   keyed footage looks pasted on even when the matte is perfect.
6. **Edge colour correction** — a secondary grade applied only to the boundary
   band, to reconcile subject and new background.

All of this is per-pixel, branch-light, and maps directly onto GPU fragment or
compute shaders. It is the cheapest high-quality win available and should be
built first — before any model runs.

---

## Runtime: what to execute the models with

NNAPI is effectively deprecated for new work in 2026; current guidance is LiteRT
or ONNX Runtime Mobile with vendor delegates, with NNAPI retained only for
already-shipped code on Android 10–14.

For ApexEdits the choice is **ONNX Runtime Mobile**, for reasons specific to this
project rather than general preference:

- Both candidate models publish ONNX exports, so no conversion step sits between
  us and an upstream update.
- One C++ API for CPU, GPU (via delegates) and NPU, callable directly from the
  native engine — no JNI hop per frame, which matters when the engine is C++ and
  the frame is already in native memory.
- The same model binary is portable if an iOS port is ever revisited.

NCNN remains the fallback if ONNX Runtime's binary size proves unacceptable; it
is smaller and Tencent-optimised for ARM, at the cost of a conversion step per
model update. The abstraction below keeps that swap to one file.

**Quantisation:** INT8 for the real-time tier (with a calibration set built from
representative footage), FP16 for the quality tier. Both need per-tier accuracy
gates, not just speed gates — a quantised model that drops 2 dB on `Grad` has
eaten exactly the hair quality this feature exists to deliver.

---

## Targets, stated as numbers

"Better than CapCut" is not testable. These are.

| | Low tier | Medium | High |
|---|---|---|---|
| Preview matte, 1080p | 480p inference, ≥ 24 fps | 720p, ≥ 30 fps | 1080p, ≥ 30 fps |
| Export matte, 1080p | ≤ 2× realtime | ≤ 1× realtime | ≤ 0.5× realtime |
| Peak additional RAM | ≤ 150 MB | ≤ 300 MB | ≤ 600 MB |

Quality gates, measured on held-out VideoMatte240K and a hand-built hard set
(hair, motion blur, low light, multiple subjects, transparent objects):

- Fast tier: within **15% MAD** of the BiRefNet quality tier.
- Quality tier: **`Grad` at or below RVM-Large's 12.97** on the same protocol —
  i.e. match the GPL model we are not allowed to ship, using models we are.
- Both tiers: **`dtSSD` below 2.0**, the threshold below which the published
  numbers put visually stable methods.

---

## What was not resolved, and what it would take

- **No on-device measurement exists yet.** This machine has no GPU, no NPU, no
  emulator (no `vmx`/`svm`, no `/dev/kvm`). Every latency figure above is a
  target derived from published desktop numbers and model size, **not** a
  measurement. The first task after the engine skeleton is a benchmark harness
  that produces these numbers on real hardware.
- **PP-Matting / PP-HumanSeg (PaddleSeg, Apache 2.0)** were not evaluated and may
  be competitive for the fast tier; worth a look before committing to MODNet.
- **SAM2-based matting** appeared in 2026 results and suits the "user paints what
  to keep" requirement well, since SAM2 is natively promptable with points and
  boxes. Licence and mobile cost both need checking before it is counted on.
- **INT8 accuracy impact is unmeasured.** It is assumed acceptable; it must be
  gated by the numbers above, not assumed.

---

## Sources

- [MatAnyone 2: Scaling Video Matting via a Learned Quality Evaluator](https://arxiv.org/html/2512.11782v1)
- [MatAnyone: Stable Video Matting with Consistent Memory Propagation](https://arxiv.org/pdf/2501.14677)
- [MatAnyone licence (S-Lab License 1.0)](https://raw.githubusercontent.com/pq-yang/MatAnyone/main/LICENSE)
- [Robust Video Matting — repository and licence](https://github.com/PeterL1n/RobustVideoMatting)
- [Robust High-Resolution Video Matting with Temporal Guidance (RVM paper)](https://arxiv.org/pdf/2108.11515)
- [MODNet — trimap-free portrait matting](https://github.com/ZHKKKe/MODNet)
- [MODNet licence (Apache 2.0)](https://github.com/ZHKKKe/MODNet/blob/master/LICENSE)
- [BiRefNet licence (MIT)](https://raw.githubusercontent.com/ZhengPeng7/BiRefNet/main/LICENSE)
- [Android neural networks in 2026: LiteRT, ONNX Runtime, NNAPI status](https://www.forasoft.com/blog/article/neural-networks-on-android-369)
- [RVM-Inference — C++ toolkit across ONNXRuntime, MNN, NCNN, TNN](https://github.com/xlite-dev/RVM-Inference)
- [VideoMatt: A Simple Baseline for Accessible Real-Time Video Matting (CVPRW 2023)](https://openaccess.thecvf.com/content/CVPR2023W/MobileAI/papers/Li_VideoMatt_A_Simple_Baseline_for_Accessible_Real-Time_Video_Matting_CVPRW_2023_paper.pdf)

# Build phases

Following PRD §4.4. Phase 1 is done; Phase 2 is under way, with keyframes,
markers, audio (volume/pan/fades), speed, timeline thumbnails/waveforms, and
basic colour correction built. The rest is sequenced but not built.

## Phase 1 — Foundation ✅

Project model, Media3 preview, multi-track timeline, import, split/trim/delete,
simple export, the zero-overflow Compose shell, auto-save. Plus, beyond the
PRD's Phase 1 list, two things it places later that are cheaper to build in from
the start than to retrofit: **device classification** (every later feature needs
to ask "may I do this here?") and the **self-explanatory control library** (a
labelling rule applied retroactively to 200 controls never fully lands).

## Phase 2 — Professional editing

Keyframes are the backbone: transform, colour, audio and effect intensity all
animate through one system, so it comes first and everything else plugs into it.

1. **Keyframes** ✅ — model, interpolation, easing, editing operations, timeline
   diamonds, and the three-state diamond in the Transform panel. Rendered through
   a single `MatrixTransformation` (geometry), a `GlEffect` (opacity), an
   `RgbMatrix` (colour), and a `BaseAudioProcessor` (volume) so preview and
   export cannot diverge. Remaining: the graph editor and dragging diamonds on
   the timeline.
2. **Markers** ✅ — add/rename/delete/colour-tag, ruler flags, dialog.
3. **Transform UI** — on-screen handles on the preview; sliders exist today.
4. **Colour** ✅ (basic) — exposure, contrast, saturation, temperature, tint,
   each keyframeable through `KeyframedColorMatrix`. Curves, wheels, and LUTs
   remain.
5. **Effects & transitions** — library, performance tags, keyframeable parameters.
6. **Masks and chroma key** — chroma-key *core* built natively (ADR 0006/0007,
   `core:nativeengine`), ahead of the rest of this phase, because it needed no
   model and no device to get right. GPU shader port, background-removal AI
   tiers (MODNet/BiRefNet via ONNX Runtime Mobile), and manual refinement UI
   remain.
7. **Audio** ✅ (core controls) — per-clip volume (keyframeable), pan, fade
   in/out, waveforms on the timeline. EQ, compression, and voiceover remain.
8. **Speed** ✅ — constant speed with a slider and presets. Ramping/time
   remapping remains.
9. **Thumbnails** ✅ — video thumbnail strips on the timeline.
10. **Proxies** — the generator behind the policy that already decides proxy size.
11. **Text** — typography, animation presets.
12. **Stabilisation** — `vidstab`.

## Phase 3 — Captions & polish

1. **Whisper** — NDK toolchain, vendored whisper.cpp, bundled tiny + base models,
   audio extraction, caption track, styling (ADR 0003).
2. **Scopes, adjustment layers, templates.**
3. **Stock APIs** — Pexels, Pixabay, Coverr, with attribution and local caching.
4. **Project packages** — zip the folder that is already self-contained.
5. **Batch export.**

## Phase 4 — Hardening

Performance tuning across device classes, error recovery, accessibility audit,
localisation, onboarding, Settings storage management, asset polish, the full
testing matrix.

---

The PRD's own instruction governs the ordering: *"Prioritize offline reliability
and UI correctness over adding more effects."*

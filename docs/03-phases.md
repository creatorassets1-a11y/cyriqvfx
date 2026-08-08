# Build phases

Following PRD §4.4. Phase 1 is done; the rest is sequenced but not built.

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
   a single `MatrixTransformation` so preview and export cannot diverge.
   Remaining: the graph editor, dragging diamonds on the timeline, and animated
   opacity/volume at the renderer (both need a shader program rather than a
   matrix).
2. **Transform UI** — on-screen handles on the preview; sliders exist today.
3. **Colour** — basic sliders, then curves, wheels, LUTs.
4. **Effects & transitions** — library, performance tags, keyframeable parameters.
5. **Masks and chroma key** — first real FFmpeg work (ADR 0002).
6. **Audio** — waveforms, fades, EQ, compression, voiceover.
7. **Proxies** — the generator behind the policy that already decides proxy size.
8. **Text** — typography, animation presets.
9. **Stabilisation** — `vidstab`.

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

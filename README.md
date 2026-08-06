# ApexEdit

A professional-grade, offline-first mobile video editor.

This repository holds the foundation described in
[`docs/PRD.md`](docs/PRD.md): the decisions that were open in the PRD, and a
working implementation of the part everything else depends on — a
frame-accurate, platform-agnostic editing engine, plus a runnable reference
editor that drives it.

## What is here

```
packages/edit-engine   The editing core. Pure TypeScript: no DOM, no native
                       deps, no I/O. 183 tests.
apps/prototype         Reference editor. Mobile-first React UI, WebGL2
                       compositor, export. Runs in a browser.
docs/                  Scope, architecture, flows, UI spec, and the ADRs
                       resolving the PRD's open questions.
```

## What state it is in

**Built and tested.** The edit engine — the timeline model, editing operations,
retiming, render-graph compilation, history, project I/O and the AI job queue.
This is the piece that is hardest to get right and most expensive to change
later, and it is complete enough to build both native apps against.

**Built and verified in a browser.** The reference editor: multi-track timeline
with real gestures, WebGL grading pipeline, inspector panels, consent-gated AI
queue, and export. It is a UX prototype and the conformance target for the
native renderers — not a shipping product.

**Decided, not built.** Everything in `docs/`: MVP scope, the cross-platform
strategy, the AI provider and cost model, user flows, the UI specification.

**Not started.** The iOS and Android shells, the Rust port of the engine, the
backend, and every server-side AI capability. See
[`docs/01-mvp-scope.md`](docs/01-mvp-scope.md) for what ships when and why.

A full native NLE on two platforms is a multi-team, multi-quarter build. What
this repository does is remove the hardest source of risk from that build: the
editorial semantics are settled, executable and under test.

## Getting started

```bash
npm install
npm test          # 183 engine tests
npm run dev       # reference editor at http://localhost:5173
```

The editor works with no assets — add a colour card and a title to exercise the
timeline, or import your own footage. Nothing is uploaded; there is no backend.

## Android APK

The reference editor is packaged as an Android app (Capacitor shell around the
WebView, assets bundled into the APK so it runs with no network at all).

**To download a built APK:** open the repository's **Actions** tab → the most
recent **Build Android APK** run → the `apexedit-apk` artifact. Unzip it and
sideload the `.apk`, allowing installation from unknown sources.

**To build it yourself**, with the Android SDK installed:

```bash
npm ci
npm run build --workspace @apex/prototype
cd apps/prototype
npx cap sync android
cd android && ./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

Notes on this build:

- **Debug-signed**, so it sideloads but is not Play-Store-ready. Release signing
  needs a keystore that should not live in a repository.
- **minSdk 24** (Android 7). The PRD targets Android 12+ for the shipping native
  app; this shell only needs a WebView new enough for WebGL2, MediaRecorder and
  `canvas.captureStream`.
- It is the **reference editor**, not the shipping product. The native media
  layer described in ADR 0001 — AVFoundation/Metal and MediaCodec/Vulkan — is
  what replaces the WebView path for real 4K performance. This APK is for
  trying the UX and confirming the engine behaves on-device.

## The design decisions worth knowing

**Time is an integer.** Every position and duration is a count of ticks at
705,600,000/second, a base that divides every supported frame rate — including
the NTSC /1001 rates — and both audio sample rates exactly. Frame accuracy is
structural rather than best-effort.

**The document is immutable with structural sharing.** Undo is a reference, not
a copy, which is what makes unlimited undo affordable on a phone.

**A compiled frame contains no unresolved state.** `composeFrame(doc, t)`
returns a flat description with every keyframe evaluated and every speed curve
integrated. Three different renderers consuming it cannot disagree about the
edit — which is how "identical on iOS, Android and web" becomes a property of
the architecture instead of a QA goal.

**Consent is a state transition.** An AI job cannot leave `awaiting-consent`
except through `grantConsent`, which records verbatim what the user was shown.
There is no code path where tapping a button uploads media. The PRD's "never
surprise-upload user media" is enforced by the engine, not by each screen's
good behaviour.

**Editing operations clamp; they do not throw.** A trim past the end of the
media stops at the media; a move onto a locked track is a no-op. A dropped
gesture must never break a session.

## Documentation

| | |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | The source requirements |
| [`docs/01-mvp-scope.md`](docs/01-mvp-scope.md) | What ships at launch, what was cut, and why |
| [`docs/02-architecture.md`](docs/02-architecture.md) | Layers, invariants, module map, render contract |
| [`docs/03-user-flows.md`](docs/03-user-flows.md) | Flows with their decision points and failure paths |
| [`docs/04-ui-spec.md`](docs/04-ui-spec.md) | Accent colour, tokens, layout, gestures, accessibility |
| [`docs/adr/0001-tech-stack.md`](docs/adr/0001-tech-stack.md) | Shared engine, native shells — and why not Flutter/RN |
| [`docs/adr/0002-ai-provider-strategy.md`](docs/adr/0002-ai-provider-strategy.md) | On-device/server line, providers, credits, model budgets |

## Next steps

1. Port the engine to Rust behind UniFFI, using the existing test suite as the
   conformance spec (ADR 0001).
2. Build the iOS media layer: AVFoundation decode, Metal renderer consuming
   `RenderFrame`, AVAssetWriter export.
3. Build the Android equivalent on MediaCodec and Vulkan.
4. Native UI shells against the engine's operation surface.

## Licence

MIT. See [`LICENSE`](LICENSE).

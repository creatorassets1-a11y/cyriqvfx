# ADR 0001 — Cross-platform strategy: shared engine, native shells

**Status:** Accepted · **Date:** 2026-08-06
**Resolves:** PRD §11, "Cross-platform tech stack decision (native vs Flutter/React Native + heavy native modules)"

## Context

The PRD demands two things that pull in opposite directions:

- **Native performance is critical.** 60 fps timeline scrubbing, 4K60 export,
  frame-accurate editing, real-time preview with grading. Media work lives in
  AVFoundation/Metal on iOS and MediaCodec/Vulkan on Android, and neither has a
  faithful cross-platform abstraction.
- **The team must ship a feature-complete editor on two platforms** and keep
  them at parity, against competitors with much larger teams.

The standard framing is "native versus cross-platform," and it is the wrong
framing. It treats the app as one thing that must be built one way.

## The observation that decides it

A video editor is two very different programs wearing one coat:

1. **Editorial logic** — what a cut *is*, where a clip sits, what a frame should
   look like at time T. Pure computation. No I/O, no pixels, no platform APIs.
   It is also where all the subtle correctness lives: frame accuracy, ripple
   semantics, retiming, undo. Bugs here are the ones users never forgive,
   because they lose work.
2. **Media execution and presentation** — decoding, rendering, encoding, touch
   handling. Entirely platform-specific and performance-critical.

These have opposite requirements. The first benefits enormously from being
written once (a ripple-delete bug fixed twice is a ripple-delete bug fixed
wrong once). The second must be native or it will not hit the performance bar.

Framework debates assume you must pick one answer for both.

## Decision

**Split along that seam.** Three layers:

```
┌──────────────────────────────────────────────────────────────┐
│  Native UI shell         SwiftUI (iOS)  ·  Compose (Android)  │
│  Gestures, layout, accessibility, platform integration        │
├──────────────────────────────────────────────────────────────┤
│  Native media layer      AVFoundation/Metal · MediaCodec/GL   │
│  Decode, render RenderFrame, encode, on-device ML             │
├──────────────────────────────────────────────────────────────┤
│  Shared edit engine      one implementation, both platforms   │
│  Document model, edit ops, retiming, render-graph compilation │
└──────────────────────────────────────────────────────────────┘
```

The engine answers "what should happen"; the native layers do it.

The contract between them is one data structure, `RenderFrame`: a flat,
fully-resolved description of a frame with no keyframes, no speed curves and no
document lookups left in it. Each platform renderer consumes exactly that. This
is what makes an identical frame on iOS, Android and in the web reference
build a structural property rather than a QA aspiration.

### Engine implementation language

The engine in this repository is **TypeScript**, which is the right choice for
the reference implementation and the prototype but is *not* the recommendation
for production. The production engine should be **Rust**, compiled to a static
library and bridged with UniFFI (Swift and Kotlin bindings generated from the
same source).

Rust rather than TypeScript in production because:

- No runtime to embed and no GC pause in the middle of a scrub.
- The engine is exactly the kind of code Rust's type system is good at: pure
  transformations over an immutable document, where illegal states can be made
  unrepresentable.
- It bridges cleanly to both platforms without a JS runtime.

Rather than C++ because the memory-safety argument is decisive for code that
holds the user's unsaved work, and because Cargo is a better story than
maintaining two build systems.

The TypeScript engine here is not throwaway: it is the executable specification.
Its 183 tests are the conformance suite the Rust port must pass, and the web
prototype stays useful for UX iteration long after the port.

### Rejected: Flutter or React Native for the whole app

Both can do this. Neither should here.

The media layer would be native modules regardless, so the framework only buys
shared *UI* code — and UI is the layer where platform divergence is a feature,
not a cost. iOS and Android users have different expectations for gestures,
navigation and haptics, and the PRD's accessibility requirements (VoiceOver,
TalkBack, Dynamic Type) are best served by the native accessibility trees.

The specific risk that decides it: in a cross-platform UI framework, every frame
of the timeline crosses a bridge or goes through a framework compositor. That is
survivable for most apps. For a surface where the PRD's headline requirement is
60 fps scrubbing under a finger, it is the one place we cannot afford a variable
we do not control.

### Rejected: fully separate native implementations

The obvious alternative, and the one most competitors use. Rejected because
editorial logic is where correctness bugs are most expensive, and two
implementations means every ripple-edit edge case is reasoned about twice by
different people. The PRD's own feature list — slip, slide, roll, speed curves,
magnetic tracks — is a long tail of exactly the semantics that drift apart.

## Consequences

**Good**

- Editorial correctness is written and tested once. The test suite in this repo
  covers drop-frame counting, media-limit clamping, ramp-preserving splits and
  migration — none of which would be worth writing twice.
- Project files are portable across platforms by construction.
- Each platform's UI can be genuinely idiomatic.
- The web reference build gives a third renderer that catches
  platform-assumption leaks in the engine early.

**Costs, honestly**

- A bridge to design and maintain. UniFFI reduces but does not remove this.
- Rust hiring is harder than Swift/Kotlin hiring.
- Two UI codebases: the largest ongoing cost of this decision. Mitigated by the
  fact that the UI is the layer that changes most for reasons that are
  platform-specific anyway.
- The engine must stay disciplined about purity. The moment it reaches for a
  file or a clock, it stops being portable. Enforced by having no I/O
  dependencies available to it at all.

## Validation

The seam is real, not theoretical: `packages/edit-engine` has zero DOM, native
or I/O dependencies and is consumed by `apps/prototype`, which supplies its own
decoder (`<video>` elements), renderer (WebGL2) and encoder (MediaRecorder)
without the engine knowing any of it exists. If a native shell can do the same
against the same `RenderFrame`, the architecture holds.

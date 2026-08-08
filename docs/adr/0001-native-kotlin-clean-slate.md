# ADR 0001 — Native Kotlin, from a clean slate

**Status:** accepted

## Context

This repository previously held a different product: "ApexEdit", built to an
earlier PRD. It was a TypeScript edit engine (~5,700 lines, 183 tests) with a
React/WebGL2 reference editor shipped as a Capacitor WebView APK, targeting iOS
and Android, with a hybrid cloud AI feature set including a generative job queue
(text-to-video, avatars, voice cloning, generative music) and an undecided
monetisation model.

The ApexEdits PRD contradicts that on four axes:

| | previous | ApexEdits PRD |
|---|---|---|
| Stack | TypeScript + React + WebView | **100% Kotlin + Compose + Media3 + FFmpeg + whisper.cpp** |
| Platforms | iOS + Android | **Android only**, API 24+ |
| AI | hybrid generative | **no generative AI**; offline Whisper captions only |
| Money | tiers undecided, accounts, cloud | **free forever**, no accounts, no tracking |

## Decision

Remove the previous codebase entirely and build a native Kotlin app.

The stack is not a preference the PRD expresses — it is a requirement, stated in
the header and repeated in the acceptance checklist. A WebView cannot meet the
performance targets either: 4K decode, multi-layer compositing and hardware
export need MediaCodec and the platform's own graphics path, not
`canvas.captureStream`.

The generative AI module was not merely unused but actively contrary to the new
PRD's non-goals, and keeping it would have left the repository ambiguous about
what the product is.

## Consequences

The tested editorial semantics were lost and re-derived in Kotlin, with a fresh
test suite covering the operations in Phase 1's scope.

One idea was carried across deliberately: **the 705,600,000 tick timebase**. It
divides every supported frame rate including the NTSC `/1001` rates, and both
audio sample rates, exactly. That is a genuinely good decision independent of
language, and re-deriving it would have cost more than porting it.

The `INTERNET` permission is absent from the manifest. The PRD's offline and
privacy claims are therefore verifiable from the manifest rather than asserted in
a document.

# ADR 0003 — Bundling whisper.cpp

**Status:** accepted · **Applies from:** Phase 3

## Context

The PRD requires fully offline auto-captions from bundled quantised whisper.cpp
models, with audio never leaving the device.

There is **no official whisper.cpp Android AAR**. The Maven artifact
`io.github.ggerganov:whispercpp` (1.4.0, last published 2023) is a JVM/JNA
binding, not an Android library, and is three years stale.

## Decision

Vendor whisper.cpp as source and build it with the NDK via CMake, following the
upstream `examples/whisper.android` project.

- **ABIs:** arm64-v8a primary, armeabi-v7a for the older end of the supported
  range. Compile with NEON and, where available, FP16.
- **Models:** tiny and base, quantised Q5_K_M, in `assets/`. Small becomes an
  optional download rather than install-time weight.
- **Pipeline:** extract the timeline's audio to 16 kHz mono WAV → VAD to skip
  silence → whisper.cpp → timed segments → caption clips.
- **Memory:** load the model on demand and release the context immediately after
  a run. A base model holds several hundred megabytes; keeping it resident would
  make the editor unusable on the 3 GB devices the PRD requires support for.
- **Device policy:** `PerformancePolicy.recommendedCaptionModel` already names
  the model per tier — tiny on Low. That field exists from Phase 1 precisely so
  Phase 3 has nowhere to re-decide it.

## Alternatives rejected

**Android's `SpeechRecognizer`** is simpler and needs no native build, but its
offline availability varies by OEM and language, it is tuned for short commands
rather than long-form transcription, and it gives no word-level timing. Captions
that silently stop working on some devices are worse than captions that are
demanding but predictable.

**Server-side transcription** is ruled out by the PRD in two separate places.

## Consequences

The build gains an NDK toolchain and a CMake step. APK size grows by roughly the
model weights — accepted explicitly by PRD §4.1.

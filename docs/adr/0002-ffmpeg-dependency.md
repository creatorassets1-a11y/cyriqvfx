# ADR 0002 — Which FFmpeg, and which licence

**Status:** accepted · **Applies from:** Phase 2

## Context

The PRD requires FFmpeg for chroma key, complex masks, stabilisation and advanced
colour — work Media3 does not cover.

The obvious dependency, `com.arthenica:ffmpeg-kit`, **is gone**. The project was
retired in early 2025 and the artifacts were pulled from Maven Central; every
`com.arthenica:ffmpeg-kit-*` coordinate now returns 404. This was verified
against the live repository, not assumed.

## Options

1. **A maintained republish.** `com.antonkarpenko:ffmpeg-kit-full` (latest 2.2.1)
   is live on Maven Central and API-compatible.
2. **Build FFmpeg from source** with the NDK.
3. **Avoid FFmpeg**, doing everything with Media3 effects and custom GL shaders.

## Decision

Take **`com.antonkarpenko:ffmpeg-kit-full`**, the LGPL build — explicitly *not*
the `-gpl` variant.

The GPL variant bundles x264 and x265, and linking them makes the whole
application GPL. ApexEdits is MIT-licensed and free; adopting GPL would be a
licence change made by accident through a dependency choice, which is exactly the
kind of decision that should not be implicit.

The GPL build costs nothing to give up, because **H.264 and H.265 encoding comes
from MediaCodec**, not from FFmpeg. FFmpeg is wanted here for its *filters*, and
those are in the LGPL build. LGPL is satisfied by dynamic linking against the
`.so` files, which is how the AAR ships them.

Building from source stays the fallback if the fork is abandoned in turn. The
filter work should therefore go through a thin internal wrapper rather than
calling `FFmpegKit` from feature code, so a future swap touches one file.

## Consequences

Phase 2 gains a large native dependency (arm64-v8a primary, armeabi-v7a for the
older end of the supported range). The PRD explicitly accepts a large APK.

The licence text for FFmpeg and its LGPL components must appear in
Settings → Licences.

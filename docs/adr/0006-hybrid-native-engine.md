# ADR 0006 — Hybrid architecture: Kotlin shell, C++ engine

**Status:** accepted · **Supersedes the render half of** ADR 0004

## Context

Phases 1 and 2 put the whole engine in Kotlin and rendered through Media3
effects. That was right for establishing editorial semantics — split, trim,
ripple, keyframes — and those 189 tests remain the specification.

It does not survive contact with what comes next. Chroma key, matting, colour
grading and multi-layer compositing are per-pixel work at 1080p60, and three
things about the current path make that untenable:

- **Media3's effect pipeline is a closed set.** `MatrixTransformation` and a
  fragment shader cover a transform and an alpha multiply. A keyer with spill
  suppression and light wrap, or a matting pass with guided upsampling, is not
  expressible as a chain of stock effects.
- **Per-frame work must not touch the JVM.** A 1080p RGBA frame is 8 MB. At 60 fps
  that is 480 MB/s crossing the JNI boundary if frames are copied, and GC pressure
  that no amount of tuning survives.
- **Determinism across preview and export** (ADR 0004) is easier to keep, not
  harder, once one C++ implementation serves both — provided the boundary is
  drawn correctly.

## Decision

Split at the **document/frame** line, not the feature line.

```
Kotlin / Compose            C++ / NDK
─────────────────────       ──────────────────────────────
UI, gestures, panels        Decode → composite → encode
Timeline & project state    Chroma key, matting, colour
Editing operations          Effect graph & GPU shaders
Keyframe *model*            Keyframe *evaluation* at render
Undo, autosave, Room        Zero-copy buffer management
Device policy               Model inference (ONNX Runtime)
```

**Kotlin owns the document. C++ owns the pixels.** Nothing else crosses.

### The boundary

The JNI surface is deliberately tiny — a handful of calls, none of them per-pixel
and none of them per-frame in the hot path:

```
nativeCreateEngine(surface, width, height, colorSpace) -> handle
nativeSetComposition(handle, serializedRenderPlan)   // on edit, not per frame
nativeSeek(handle, timeTicks)
nativePlay/nativePause(handle)
nativeRenderFrame(handle, timeTicks)                 // export path only
nativeDestroy(handle)
```

The load-bearing choice is `nativeSetComposition`. Kotlin serialises the
already-resolved `RenderFrame` description — the one `composeFrame` produces, with
every keyframe evaluated and every speed applied — into a flat buffer the engine
parses once. **Editing state crosses on edit; frames never cross at all.** The
engine then evaluates animation itself, per frame, from that plan.

That duplicates the interpolator in C++, which is a real cost and worth naming.
It is accepted because the alternative — calling into Kotlin per frame to ask
"what is the opacity now?" — puts a JNI round trip and a possible GC pause inside
the frame budget. The duplication is made safe by making the Kotlin suite the
conformance spec: the C++ interpolator is tested against the same fixtures and
must agree to within float epsilon. A divergence is a test failure, not a visual
bug found later.

### Zero-copy

Frames stay in native or GPU memory end to end:

- **Decode** → `MediaCodec` into an `AImageReader`/`ANativeWindow`, giving an
  `AHardwareBuffer` with no CPU copy.
- **Import to GL/Vulkan** → `EGLImageKHR` from the `AHardwareBuffer`, sampled as an
  external texture.
- **Composite** → render to an FBO; every effect is a shader pass over textures.
- **Preview** → the Compose `SurfaceView`'s `ANativeWindow`, direct.
- **Export** → the encoder's input `Surface`, direct. Frames reach the muxer
  without ever being read back to CPU memory.

Only two things legitimately touch the CPU: model inference input (which is a
downscaled tensor, not a frame) and FFmpeg filters that have no GPU equivalent.
Both are explicit, bounded exceptions rather than the default path.

### Threading

One render thread owning the GL/Vulkan context; a decode thread per active
sequence; an inference thread with its own queue. The render thread never blocks
on inference — a matte that is not ready yet reuses the previous frame's alpha,
warped if flow is available. **A late matte degrades the picture for one frame; a
blocked render thread drops it entirely**, and dropped frames are what users
perceive as a broken editor.

## Alternatives rejected

**Keep everything in Media3 effects.** Simplest, and genuinely correct up to this
point. Rejected because the keyer and matter cannot be expressed in it, and
splitting "some effects here, some there" would give two composite orders and
therefore two different pictures.

**Rewrite the editing engine in C++ too.** Tempting for uniformity. Rejected
because the editorial semantics are settled, tested, and *not* performance
critical — a split happens once per gesture, not 60 times a second. Moving them
would discard 189 tests to solve a problem that does not exist.

**Kotlin/Native or Rust.** Both plausible. C++ wins on this specific problem
because every dependency the brief names — FFmpeg, whisper.cpp, ONNX Runtime,
NCNN — is a C or C++ library, and the NDK's first-class language is C++. Choosing
Rust would mean an FFI shim to each of them.

## Consequences

- Build gains CMake, the NDK, and a per-ABI native build. Verified: NDK r30's
  `aarch64-linux-android24-clang++` compiles NEON intrinsics to arm64 objects in
  this environment.
- **APK size grows substantially** — ONNX Runtime, FFmpeg and models are tens of
  megabytes per ABI. PRD §4.1 accepts this explicitly.
- Crashes become native crashes. Tombstone symbolisation and a `CMakeLists`
  configured to keep debug symbols out of the shipped `.so` but archived for
  stack decoding are not optional.
- **The engine must be host-buildable.** Its portable core compiles for x86-64
  Linux so unit tests and benchmarks run in CI and in this environment, with NEON
  paths behind feature detection and a scalar reference implementation that the
  tests check against. Without this, no C++ line is testable here at all.

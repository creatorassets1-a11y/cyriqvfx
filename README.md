# ApexEdits

A professional, offline-first video editor for Android. 100% Kotlin, Jetpack
Compose, Media3. Free, no ads, no accounts, no tracking.

This repository holds the **Phase 1 foundation** described in
[`docs/PRD.md`](docs/PRD.md) — the parts everything else is built on, working and
under test.

## What state it is in

**Built and building.** A real Android app that assembles, installs and runs:

- A frame-accurate edit engine — timeline model, split, trim, ripple, move,
  duplicate, deep undo — as pure Kotlin, with 189 unit tests across the core
  modules, including the persistence layer under Robolectric.
- Keyframe animation for position, scale, rotation, **opacity and volume**:
  easing presets, custom bezier curves, a three-state keyframe diamond per
  property, and diamonds on the timeline. Preview and export share one Media3
  effect pipeline, so an animation cannot render differently in the two.
- Multi-track timeline with pinch zoom, selection, and track lock/mute.
- Media3 preview over a `Composition` built from the timeline.
- Media import from device storage, with metadata, rotation handling, and
  missing-media detection.
- Export with explained presets, running in the background with a notification,
  progress and cancel, saving to the gallery.
- Device classification and the low-resource warning flow.
- Auto-save with crash recovery.
- The zero-overflow layout system and the self-explanatory control library.

**Not built.** Most of the PRD: colour grading, effects, transitions, masks,
chroma key, stabilisation, audio processing beyond volume, text, Whisper
captions, FFmpeg integration, stock media — and, within keyframes, the animation
graph editor and dragging diamonds on the timeline. All of it is tracked individually in
[`docs/02-feature-coverage.md`](docs/02-feature-coverage.md) with a status and a
target phase — nothing has been quietly dropped.

A full mobile NLE is a multi-quarter build. What exists here is the layer that is
hardest to change later: the editorial semantics, the persistence format, the
render contract, and the two UI guarantees the PRD is most specific about.

## Building

```bash
./gradlew test              # 189 unit tests
./gradlew test -Papex.sampleVideo=/path/to/clip.mp4   # also check the fixture against real media
./gradlew :app:lintDebug
./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk (~24 MB)
```

Needs JDK 17+ and an Android SDK with platform 36. Point `local.properties` at
it (`sdk.dir=/path/to/android-sdk`) or set `ANDROID_HOME`.

The UI overflow matrix and touch-target checks are instrumentation tests and need
a device or emulator:

```bash
./gradlew :app:connectedDebugAndroidTest
```

They are wired into CI in [`.github/workflows/android.yml`](.github/workflows/android.yml).

## The decisions worth knowing

**Time is an integer.** Every position and duration is a count of ticks at
705,600,000 per second — a base that divides every supported frame rate exactly,
including the NTSC `/1001` rates, and both audio sample rates. Frame accuracy is
a property of the representation rather than something each operation defends.

**The document is immutable with structural sharing.** Undo is a reference to a
previous value, not a copy of the timeline, which is what makes a 200-deep undo
stack affordable on a 3 GB phone.

**Preview and export consume the same composition.** `composeFrame` returns a
frame with nothing left to interpret, and one `Composition` feeds both
`CompositionPlayer` and `Transformer`. "Export matches the preview" is therefore
structural rather than something QA has to keep catching. Keyframes keep it that
way: an animated transform is a `MatrixTransformation` — a function from
presentation time to a matrix — evaluated by the same effect pipeline in both,
rather than an animation implemented once for the preview and baked again for
export.

**Editing operations clamp; they never throw.** A trim past the end of the media
stops at the media. A move onto a locked track is a no-op. These functions are
driven by touch gestures, and a dropped gesture must not be able to end a
session.

**Zero overflow is asserted, not promised.** `Modifier.overflowSentinel` fails a
test when a region measures larger than the space it was given, and the matrix
composes the editor from 320×480 to 1280×800, at font scales 0.85 to 2.0, in LTR
and RTL.

**There is no icon-only button to reach for.** `ApexToolButton` requires a label,
a plain-language tooltip and a full accessibility description as non-null
parameters, and a unit test reads the string catalogue to catch empty, lazy, or
vague copy.

**Tests run against a real recording's numbers.** The engine and data tests use
the measurements of an actual 33-second clip — 576×640 at exactly 30 fps, with
video and audio tracks 24 ms different in length — rather than round synthetic
figures. That caught two bugs synthetic fixtures had not: a lossy microsecond
conversion costing 28 ms of animation drift, and a composition that threw
whenever a track's first clip did not start at zero.

**No `INTERNET` permission.** The offline and privacy claims are verifiable from
the built APK rather than from a policy document — the app has no network egress
path at all. The permissions it does hold are notifications and foreground
service for background export, plus `ACCESS_NETWORK_STATE`, `WAKE_LOCK` and
`RECEIVE_BOOT_COMPLETED`, which WorkManager merges in; none of them permits
network access.

## Documentation

| | |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | The source requirements, in full |
| [`docs/01-architecture.md`](docs/01-architecture.md) | Module map, the four core decisions, how the UI guarantees are enforced |
| [`docs/02-feature-coverage.md`](docs/02-feature-coverage.md) | **Every PRD feature tracked individually** — status and phase |
| [`docs/03-phases.md`](docs/03-phases.md) | What lands when, and why in that order |
| [`docs/adr/0001-native-kotlin-clean-slate.md`](docs/adr/0001-native-kotlin-clean-slate.md) | Why the previous TypeScript/WebView codebase was removed |
| [`docs/adr/0002-ffmpeg-dependency.md`](docs/adr/0002-ffmpeg-dependency.md) | ffmpeg-kit is retired; which fork, and why LGPL not GPL |
| [`docs/adr/0003-whisper-bundling.md`](docs/adr/0003-whisper-bundling.md) | No official AAR; vendoring whisper.cpp |
| [`docs/adr/0004-preview-export-parity.md`](docs/adr/0004-preview-export-parity.md) | One composition, two consumers |
| [`docs/adr/0005-keyframe-rendering.md`](docs/adr/0005-keyframe-rendering.md) | Animating through `MatrixTransformation`, and what it cannot cover |
| [`docs/LICENSES.md`](docs/LICENSES.md) | Attribution for bundled and planned components |

## Licence

MIT. See [`LICENSE`](LICENSE).

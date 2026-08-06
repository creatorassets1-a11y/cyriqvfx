# ApexEdit — native Android app

Kotlin, Jetpack Compose, and Jetpack Media3. No WebView.

## Why this architecture

The load-bearing decision is **Media3 `Composition`**. The same `Composition`
object is handed to `CompositionPlayer` for preview and to `Transformer` for
export, so what you see playing back is what gets encoded — not an
approximation that drifts as effects are added.

```
EditDocument  ──CompositionBuilder──▶  Composition ──┬─▶ CompositionPlayer (preview)
 (core/)                                             └─▶ Transformer       (export)
```

Decoding, audio output and A/V sync are the platform's job. That is why video
and sound work here and did not in the WebView build.

## Layout

```
core/     Time (integer ticks), document model, editing operations, history.
          Pure Kotlin. No Android dependency beyond Uri. Unit-tested on the JVM.
media/    CompositionBuilder, PreviewController, Exporter, MediaImporter.
effects/  GradeEffect — one GL shader pass for everything Media3's built-in
          effects cannot express.
ui/       Compose editor: theme, screen, preview, timeline, tool panels.
vm/       EditorViewModel — the only mutable state in the app.
```

## Build

```bash
cd android
./gradlew testDebugUnitTest   # core conformance suite, seconds, no device
./gradlew assembleDebug       # → app/build/outputs/apk/debug/app-debug.apk
```

Requires JDK 17 and the Android SDK (compileSdk 35). `minSdk 24` covers ~99% of
active devices.

## Time

Editorial arithmetic runs on integer ticks at 705,600,000/second — a base that
divides every supported frame rate exactly, including the NTSC /1001 rates, and
both audio sample rates. Media3 speaks microseconds, so conversion happens at
that boundary and nowhere else. Doing timeline maths in microseconds is how
cuts end up a frame off at 29.97.

## Offline

There is **no `INTERNET` permission** in the manifest. The app cannot make a
network call, so it cannot upload your footage even by mistake.

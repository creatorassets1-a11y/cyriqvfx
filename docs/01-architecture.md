# Architecture

## Module map

```
:core:model          Pure Kotlin. Ticks, Project, Track, Clip, Transform, MediaRef.
:core:engine         Pure Kotlin. Editing operations, history, frame composition.
:core:designsystem   Theme, the labelled control library, the overflow machinery.
:core:device         Device classification and the performance policy.
:core:data           Room index, project folders, autosave, media import.
:core:media          Media3 bridge: Composition building, preview, thumbnails.
:feature:projects    Home screen, New Project dialog.
:feature:editor      Preview, timeline, contextual toolbar, editor view model.
:feature:export      Export presets, screen, and the WorkManager render job.
:app                 Application, MainActivity, navigation.
```

`:core:model` and `:core:engine` are **plain JVM modules**, not Android
libraries. That is enforced by the build, not by convention: they cannot
accidentally acquire a dependency on `Context`, so the editorial semantics stay
testable without an emulator and the test suite runs in seconds.

Dependencies point inward. A feature may depend on core; core never depends on a
feature; nothing depends on `:app`.

## The four decisions that shape everything else

### 1. Time is an integer

Every position and duration is a count of ticks at **705,600,000 per second**
(`core/model/Time.kt`). The base divides exactly:

| | ticks per frame |
|---|---|
| 24 / 25 / 30 / 50 / 60 fps | 29,400,000 / 28,224,000 / 23,520,000 / 14,112,000 / 11,760,000 |
| 24000/1001, 30000/1001, 60000/1001 | 29,429,400 / 23,543,520 / 11,771,760 |
| 44,100 Hz / 48,000 Hz sample | 16,000 / 14,700 |

Frame accuracy is therefore a property of the representation rather than
something each operation has to defend. A split, a retime and a trim compose
without accumulating rounding error, because there is no rounding.

`TimeTest` asserts the divisibility rather than trusting the comment.

### 2. The document is immutable with structural sharing

An edit returns a new `Project` that shares every untouched track and clip with
the old one. Undo is therefore a *reference to a previous value*, not a copy of
the timeline — which is what makes a 200-deep undo stack affordable on a 3 GB
phone.

The alternative, storing inverse commands, requires every operation to know how
to undo itself; the one that gets it subtly wrong corrupts the document in a way
that only surfaces several undos later. Snapshots cannot drift.

### 3. `composeFrame` is the render contract

```kotlin
fun composeFrame(project: Project, time: Ticks): RenderFrame
```

returns a flat list of layers with **nothing left to interpret**: every source
time resolved, every speed applied, mute and solo already collapsed into a single
volume per layer.

The preview (`CompositionPlayer`) and the exporter (`Transformer`) are different
pieces of Media3, and the PRD requires the export to match the preview to within
a frame. Both consume one `Composition` built by `CompositionBuilder` from this
same resolved description, so they cannot reach different conclusions about the
edit. Preview/export parity becomes structural rather than something QA keeps
catching.

### 4. Operations clamp; they never throw

A trim past the end of the media stops at the media. A move onto a locked track
returns the document unchanged. A split where no clip exists changes nothing.

This is a contract, not defensive coding. These functions are driven by touch
gestures, and a gesture can be dropped, doubled, or arrive with a stale position
when a finger leaves the screen mid-drag. If the engine threw on nonsensical
input, every gesture handler would need to guard against states it cannot
observe — and the one that forgot would take the user's session with it.

`OperationsTest` asserts the whole no-op surface: every operation against a
missing id returns the identical document.

## The two PRD requirements that needed teeth

### Zero overflow

Enforced twice over.

**Structurally.** `ApexScaffold` is the only screen container and always applies
`safeDrawingPadding()` and `clipToBounds()`. `EditorLayout` allocates space in
*fractions of what is actually available* — there is no `height(240.dp)` anywhere
in it. The toolbar measures itself and takes what it needs (it is the one region
whose height legitimately depends on font scale); the preview and timeline split
the remainder at a user-draggable ratio clamped to `0.30..0.70`. Because the
split is a ratio, a 200% font scale that grows the toolbar shrinks preview and
timeline proportionally instead of pushing the timeline off the bottom. Tool rows
are `LazyRow`s, so a row can gain tools without ever clipping one.

**By assertion.** `Modifier.overflowSentinel(tag)` compares what a composable
measured against the constraints it was handed. `OverflowPolicy.strict` is on in
UI tests, where a violation throws; off in production, where it reports and
clamps rather than taking down a session over a few pixels.
`app/src/androidTest/.../OverflowMatrixTest.kt` composes the editor at 320×480
through 1280×800, at font scales 0.85 to 2.0, in LTR and RTL.

### Self-explanatory everything

There is no icon-only button in the library to reach for. `ApexToolButton`'s
signature is:

```kotlin
fun ApexToolButton(
    icon: ImageVector,
    label: String,        // visible text
    tooltip: String,      // plain-language long-press explanation
    description: String,  // full TalkBack description
    ...
)
```

All three are required and non-null; the component wires the `TooltipBox` and the
semantics itself, so a caller cannot forget. Omitting one is a compile error.

The type system cannot stop someone passing `""` or a tooltip that restates the
label, so `ToolCopyAuditTest` reads `strings.xml` as data and fails the build if
any tool is missing one of its three strings, if a description is under 40
characters, if a tooltip merely repeats its label, or if a label is one of the
vague words the PRD bans (`Tool`, `FX`, `More`, `Options`, …).

The 48 dp minimum touch target is a default inside the component, asserted by
`OverflowMatrixTest`.

## Device adaptation

`DeviceCapabilities.read()` gathers facts; `classify()` is a **pure function**
over them, so every tier boundary is unit-testable without an emulator.

Precedence: `isLowRamDevice` (the manufacturer's own declaration) wins outright;
then Media Performance Class where present, because it certifies exactly this
media workload and predicts concurrent 4K decode far better than a RAM figure;
then RAM and core count for the many devices declaring neither.

The result is one `PerformancePolicy` — preview cap, proxy size, soft track
limit, export ceiling, recommended Whisper model — that every feature consults
instead of reading `totalMem` for itself. `DeviceProfile.effectivePolicy` folds
in thermal state and any user override, so a throttling flagship is treated as
what it currently is. Limits are always **soft**: the PRD is explicit that the
user may continue anyway.

## Persistence

Room holds *metadata* — enough to draw the projects list without opening
anything. The timeline lives in `project.json` inside a self-contained folder:

```
projects/<id>/
  project.json       the document
  project.autosave   in-progress, promoted on clean close
  media/  proxies/  thumbs/
```

A fully normalised schema would mean a migration every time the edit model gains
a field, and Phase 2 alone adds keyframes, masks, colour grades and chroma
settings. Serialising the document lets the model evolve behind a version number
while the columns the list actually sorts on stay indexed. It also makes "export
project package" a zip of a directory.

Writes go through a temp file and a rename, so a process killed mid-write leaves
either the old document or the new one, never a truncated one. There is no
`fallbackToDestructiveMigration`: on a free offline editor that means someone's
projects vanish after an update, with no cloud copy to restore from.

`AutoSave` debounces on a 2 s quiet period and deduplicates by `revision` — a
counter that only advances when an operation actually changed something — so a
slider drag writes once at the end rather than sixty times during.

## Testing

189 unit tests, no emulator required. The split is deliberate:

| Layer | How |
|---|---|
| `core:model`, `core:engine` | Plain JVM. No Android on the classpath, so they run in seconds. |
| `core:data`, `core:media` | **Robolectric** — real Room, real SQLite, real file I/O, and `ShadowMediaMetadataRetriever` for import. |
| UI overflow matrix, touch targets | Instrumented. Needs a device; runs in CI only. |

### The sample clip

Engine and data tests run against the measurements of a real 33-second phone
recording rather than round synthetic numbers: 576×640 at exactly 30 fps, AAC
44.1 kHz, and — the useful part — **video and audio tracks that are 24 ms
different in length**. The constants live in `SampleVideo` (test fixtures); the
footage itself is deliberately not in the repository.

`SampleVideoFixtureTest` keeps those constants honest by re-deriving them from
the real file with a small test-only MP4 box reader, when a path is supplied:

```bash
./gradlew test -Papex.sampleVideo=/path/to/clip.mp4
```

Without the property those eight tests skip rather than fail, so CI stays green
with no video committed. A fixture that has silently drifted from reality is
worse than none, because everything built on it keeps passing while testing the
wrong thing.

### What testing against real numbers found

Two bugs that synthetic fixtures had not:

- **`Ticks.ofMicros` was lossy.** There are 705.6 ticks in a microsecond;
  integer division truncated that to 705, a 0.085% error — 28 ms across this
  clip, close to a whole frame — on the conversion *every animated property makes
  every frame*. Now held as the exact fraction 3528/5.
- **A sequence beginning with a gap threw.** Media3 rejects one unless a
  force-track flag is set, and `CompositionBuilder` emitted exactly that whenever
  a track's first clip did not start at zero. Dragging a clip away from the start
  would have failed both the preview and the export.

### What cannot be verified here

The development host has no hardware virtualisation — no `vmx`/`svm`, no
`/dev/kvm` — and Android's x86 system images require KVM. So decode, encode,
export, and the alpha shader's GLSL are **unexecuted** in this environment. They
are verified on a device or in the CI emulator job, and the coverage table says
so rather than implying otherwise.

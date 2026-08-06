# Architecture

How the pieces fit, and which invariants hold the whole thing together.

## Layers

```
        ┌───────────────────────────────────────────────────────┐
        │  UI shell            SwiftUI · Compose · React (proto) │
        │  gestures, layout, accessibility                       │
        └────────────┬──────────────────────────┬────────────────┘
                     │ operations               │ RenderFrame
                     ▼                          │
        ┌────────────────────────────┐          │
        │  Edit engine  (portable)   │──────────┘
        │  ────────────────────────  │
        │  document model            │
        │  editing operations        │
        │  keyframes · speed curves  │
        │  render-graph compilation  │
        │  history · I/O · AI queue  │
        └────────────┬───────────────┘
                     │ RenderFrame / AudioBlock
                     ▼
        ┌───────────────────────────────────────────────────────┐
        │  Media layer         AVFoundation/Metal · MediaCodec   │
        │  decode · composite · encode · on-device ML            │
        └───────────────────────────────────────────────────────┘
```

Data flows down as edits and up as descriptions. The engine never calls the
media layer; the media layer never reaches into the document.

## The three invariants everything else rests on

### 1. Time is an integer

Every position, duration and media offset is an integer count of ticks at
705,600,000 per second — a base chosen so that one frame at every supported rate
(including the NTSC /1001 rates) and one sample at both 44.1 and 48 kHz are
exact integers. Floating-point seconds appear only at the boundary with decoders
and gestures.

This is the difference between an editor where a cut lands on the frame you saw
and one where it lands "about there." Three hours of 29.97 material round-trips
frame-exactly (`test/time.test.ts`).

### 2. The document is immutable, and its index is maintained

Every operation returns a new `EditDocument` that structurally shares everything
it did not touch. Two consequences:

- **Unlimited undo is affordable.** A history entry is a reference, not a copy.
  Editing one clip leaves the other 200 clips as the same objects in memory
  (asserted in `test/history.test.ts`).
- **The track index cannot drift.** `trackClips` maps each track to its clips in
  start order. Only `document/mutate.ts` may construct a document, and it
  maintains that index — so no operation, however it is composed, can leave a
  stale id behind.

### 3. A compiled frame contains no unresolved state

`composeFrame(doc, t)` returns a `RenderFrame` with every keyframe evaluated,
every speed curve integrated, every grade resolved to scalars and every media
reference turned into an absolute source time. The renderer performs no lookups
and makes no decisions about *what* to draw.

This is what makes cross-platform identity structural: three renderers consuming
the same struct cannot disagree about the edit, only about pixels.

## Module map

| Module | Responsibility |
|---|---|
| `time/` | Tick base, frame snapping, SMPTE timecode incl. drop-frame |
| `model/` | Document, clip, track, media types; factories and defaults |
| `animation/` | Keyframes, interpolation, cubic-Bézier easing |
| `speed/` | Constant, freeze and ramped retiming, and its inverse |
| `color/` | Grade parameters, monotone tone curves, resolution to scalars |
| `audio/` | Clip audio parameters, gain/fade/pan maths |
| `effects/` | Schema-driven effect registry; generated inspector UI |
| `document/` | Queries and the only permitted mutation surface |
| `edit/` | Editing operations — the verbs the UI binds to |
| `history/` | Undo/redo with gesture coalescing, named snapshots |
| `render/` | Frame and audio graph compilation, export settings |
| `captions/` | Word-level caption model, styling, interchange |
| `ai/` | Job queue, consent, credits, offline behaviour |
| `io/` | Versioned serialisation, migrations, repair |

## Why some things are where they are

**Editing operations clamp, they do not throw.** `trimClipEnd` past the end of
the media returns a clip at the media's limit; `moveClip` onto a locked track
returns the document unchanged. A dropped gesture or a fat-fingered drag must
never break a session, and the UI should not have to catch exceptions from a
pan handler.

**Keyframe times are clip-relative.** Moving a clip on the timeline never
touches its animation. Trimming the head shifts keyframes with the content so
animation stays attached to the footage rather than to the clip's new edge.

**Speed ramps are sliced, not rescaled, on split.** Splitting a ramped clip gives
each half the portion of the curve it actually covered
(`sliceSpeed`), so the cut lands on the frame that was on screen. Rescaling
would snap the ramp to each piece's new edges and change what plays.

**Consent is a state transition, not a flag.** An AI job cannot leave
`awaiting-consent` except through `grantConsent`, which records verbatim what
the user was shown. There is no code path where a button tap uploads media, and
that is verified by test rather than by review.

**Serialisation never writes derived state.** `trackClips` is rebuilt on load, so
a project file cannot contain an index that disagrees with its clips. Loading
also repairs what it can — a clip on a missing track is dropped with a warning
rather than failing the load. Losing an effect is annoying; losing the project
is not acceptable.

## The render contract

```
RenderFrame {
  time, resolution, backgroundColor
  layers: [{
    clipId, trackId, z
    source: media(mediaId, sourceTime, rate, frameBlending) | color | text | shape
    matrix: [a b c d tx ty]      // normalised frame space, resolution-independent
    opacity, blendMode, crop, cornerRadius
    grade: ResolvedGrade | null  // null when neutral, so the pass can be skipped
    masks, chromaKey, effects, stabilization
  }]
  transitions: [{ type, progress, fromLayer, toLayer }]
  captions: [{ styleId, text, words: [{ text, progress, active }] }]
}
```

The transform matrix is in normalised frame space (−0.5…0.5), so the same edit
renders identically to a 480p preview and a 4K export — the resolution only
enters at rasterisation.

`frameCost(frame)` gives a cheap complexity score the UI uses to decide between
full-resolution and proxy playback, calibrated so one ungraded layer scores 1 and
a stack a mid-range phone cannot sustain scores above 10.

## Backend (Phase 1 onward)

Nothing in the MVP requires a server. When server AI arrives:

```
app ──▶ API (auth, projects, jobs) ──▶ queue ──▶ workers ──▶ managed inference
             │                                                 (fal.ai, Replicate, …)
             ├──▶ Postgres  (users, project metadata, job records)
             └──▶ Object storage + CDN  (proxies, results, assets)
```

The app's job queue already models this: jobs are asynchronous, resumable,
retried with backoff, and survive going offline. The server is a job executor,
not a source of truth about the edit — the document stays on the device unless
the user turns on cloud sync.

## Performance strategy

- **Proxies.** Generated on import for heavy media; the preview asks for them
  while scrubbing (`preferProxy`), the exporter never does.
- **Compilation is cheap.** `composeFrame` is O(visible layers), not O(clips) —
  the track index gives sorted access, so a 500-clip timeline compiles a frame in
  the same time as a 5-clip one.
- **Ramp integration is cached** per curve and clip duration, so scrubbing
  through a speed ramp does not re-integrate it every frame.
- **Gesture coalescing** keeps a 60 fps drag from producing 60 history entries.
- **Background export** where the platform allows it, since export is the one
  operation users leave the app during.

# Feature coverage

Every feature named in the PRD, tracked individually. **If something in the PRD
is not in this table, that is a bug in this document.**

The point is to make "nothing was dropped" checkable rather than hopeful. Phase 1
built a foundation; the great majority of the PRD is deliberately not built yet,
and this table says exactly where each piece stands.

## Status key

| | Meaning |
|---|---|
| **Built** | Implemented and working in the app today. |
| **Modelled** | The data model and storage exist; the UI or renderer still has to execute it. Cheap to finish, no redesign needed. |
| **Planned** | Not started. Needs model work as well as UI. |

Phase column refers to PRD §4.4: **P1** foundation (this release) · **P2**
professional editing · **P3** captions and polish · **P4** hardening.

---

## Project & media management

| PRD feature | Status | Phase | Where |
|---|---|---|---|
| Aspect ratio presets (9:16, 16:9, 1:1, 4:5, 4:3, 2.35:1) | Built | P1 | `model/Document.kt` `AspectRatio` |
| Custom aspect ratio | Planned | P2 | — |
| Frame rates 24/25/30/50/60 + NTSC variants | Built | P1 | `model/Time.kt` `FrameRate.ALL` |
| Unlimited projects, local only | Built | P1 | `data/ProjectStore.kt` |
| Export/import project packages | Planned | P3 | Folder layout already supports it |
| Import video / image / audio from device | Built | P1 | `data/MediaImporter.kt` |
| Import from camera | Planned | P2 | CameraX |
| Import from online stock | Planned | P3 | §4.2 APIs |
| Automatic proxy generation | Modelled | P2 | `PerformancePolicy.proxyMaxDimension` decides; generator not written |
| Proxy quality toggle | Modelled | P2 | Policy field exists; Settings UI pending |
| Media metadata view | Modelled | P1 | `MediaRef` carries all of it; no browser screen yet |
| Media favourite, search, folders/tags | Planned | P3 | — |
| Relink missing media | Modelled | P2 | `relinkMedia` + `refreshAvailability` built; picker UI pending |
| Duplicate clip | Built | P1 | `duplicateClip` |
| Replace media in timeline | Planned | P2 | — |

## Timeline

| PRD feature | Status | Phase | Where |
|---|---|---|---|
| Unlimited video/audio tracks (soft limits on low devices) | Built | P1 | `addTrack`, `PerformancePolicy.softTrackLimit` |
| Text / overlay / effect / adjustment tracks | Planned | P2 | `TrackKind` extends |
| Magnetic and freeform modes | Modelled | P2 | `Track.magnetic` honoured by trim; no UI toggle |
| Frame-accurate scrubbing | Built | P1 | Integer tick base |
| Zoom (pinch) | Built | P1 | `Timeline.kt` `detectTransformGestures` |
| Zoom buttons | Planned | P2 | — |
| Snap to clips / markers | Planned | P2 | `compositionBoundaries` supplies the snap points |
| Snap to beats | Planned | P3 | Needs beat detection |
| Split | Built | P1 | `splitClip`, `splitAllTracksAt` |
| Trim | Built | P1 | `trimClip` |
| Delete | Built | P1 | `deleteClip` |
| Ripple delete / close gap | Built | P1 | `rippleDeleteClip` |
| Ripple trim | Built | P1 | `trimClip(ripple = true)` |
| Overwrite edit | Built | P1 | `insertClipAt` |
| Insert / lift / extract edit modes | Planned | P2 | — |
| Roll, slip, slide | Planned | P2 | — |
| Group / ungroup | Planned | P2 | — |
| Nest / compound clips | Planned | P3 | — |
| Freeze frame | Planned | P2 | — |
| Reverse | Planned | P2 | — |
| Constant speed | Built | P1 | `setClipSpeed`, clamped 0.1×–100× |
| Speed curves / ramping / time remapping | Planned | P2 | — |
| Markers | Modelled | P2 | `Marker` in the document; no UI |
| Chapters, comments | Modelled | P3 | `Marker.note` |
| Waveforms on audio | Planned | P2 | `ThumbnailCache` is the pattern to follow |
| Thumbnails on video | Modelled | P2 | `ThumbnailCache` built; strip not yet drawn |
| Multi-select | Modelled | P2 | `deleteClips` takes a collection |
| Copy/paste attributes | Planned | P2 | — |
| Deep undo/redo, persistent per project | Built | P1 | `history/History.kt`, 200 deep, drag-coalescing |
| Playhead | Built | P1 | `Timeline.kt` |
| In/out points, loop playback | Planned | P2 | — |
| Fullscreen preview | Planned | P2 | — |

## Video tools

| PRD feature | Status | Phase | Where |
|---|---|---|---|
| Transform: position, scale, rotation, opacity, flip | Modelled | P2 | `Transform` stored and applied at export via `ScaleAndRotateTransformation`; no gesture handles |
| Transform: anchor point | Planned | P2 | — |
| Crop | Modelled | P2 | `Transform.cropLeft/Top/Right/Bottom` stored, not yet rendered |
| Keyframeable transform | Planned | P2 | — |
| Chroma key with tolerance/edge/spill/shadow | Planned | P2 | FFmpeg `chromakey` |
| Masks: rectangle, ellipse, freehand, text, linear | Planned | P2 | — |
| Mask feather, invert, track matte | Planned | P2 | — |
| Object / motion tracking | Planned | P3 | — |
| Stabilisation | Planned | P2 | FFmpeg `vidstab` |
| Picture-in-picture | Modelled | P2 | Track stacking + transform; needs the transform UI |
| Split-screen layouts | Planned | P2 | — |
| Blending modes | Planned | P2 | — |
| Adjustment layers | Planned | P3 | — |
| Optical-flow slow motion | Planned | P3 | — |

## Effects, transitions, colour

| PRD feature | Status | Phase | Where |
|---|---|---|---|
| Transitions library (50–100+) | Planned | P2 | — |
| Transition duration / parameters / keyframing | Planned | P2 | — |
| Effects: blur, sharpen, glow, glitch, VHS, grain, light leaks, mosaic, mirror | Planned | P2 | — |
| Particles | Planned | P3 | — |
| Effect performance tags (Light/Medium/Heavy) | Planned | P2 | Pairs with `HeavyOperation` |
| Colour basic: exposure, contrast, saturation, temperature, tint, highlights/shadows, vibrance | Planned | P2 | — |
| Colour advanced: RGB/HSL curves | Planned | P2 | — |
| Colour wheels (lift/gamma/gain) | Planned | P2 | — |
| HSL secondary | Planned | P3 | — |
| LUT import (.cube) + bundled LUTs | Planned | P2 | — |
| Scopes: waveform, vectorscope, histogram | Planned | P3 | — |
| Apply to adjustment layer | Planned | P3 | — |
| Copy/paste attributes, intensity control | Planned | P2 | — |

## Audio

| PRD feature | Status | Phase | Where |
|---|---|---|---|
| Multi-track mixing | Built | P1 | `composeFrame` resolves per-layer volume |
| Volume per clip and per track | Built | P1 | `setClipVolume`, `Track.volume` |
| Mute | Built | P1 | `setTrackMuted` |
| Solo (wins over mute, non-destructive) | Built | P1 | `composeFrame`, `ComposeTest` |
| Pan | Planned | P2 | — |
| Keyframeable volume automation | Planned | P2 | — |
| Fade in/out handles | Planned | P2 | — |
| Parametric EQ | Planned | P2 | — |
| Compression | Planned | P2 | — |
| Noise reduction / gate | Planned | P2 | — |
| Reverb / delay | Planned | P3 | — |
| Auto-duck music under voice | Planned | P3 | — |
| Detach audio, replace, extract | Modelled | P2 | `Clip.linkedClipId` models the link |
| Beat detection / markers | Planned | P3 | — |
| Voiceover recording | Planned | P2 | — |
| SFX pack (bundled) | Planned | P3 | — |

## Text & graphics

| PRD feature | Status | Phase | Where |
|---|---|---|---|
| Text: fonts, size, colour, stroke, shadow, background, alignment, tracking, leading | Planned | P2 | — |
| Text animations / presets | Planned | P2 | — |
| Keyframeable text properties | Planned | P2 | — |
| **Whisper auto-captions (offline)** | Planned | P3 | ADR 0003; `CaptionModel` already in the device policy |
| Caption editing, styling, word-level timing | Planned | P3 | — |
| Caption export (burned-in / sidecar SRT) | Planned | P3 | — |
| Stickers, emojis, shapes, lower thirds, callouts | Planned | P3 | — |
| Drawing / freehand annotation | Planned | P3 | — |

## Export, templates & sharing

| PRD feature | Status | Phase | Where |
|---|---|---|---|
| Export presets (TikTok/Reels/Shorts, Instagram, YouTube, 4K, small file) | Built | P1 | `export/ExportSettings.kt` |
| Custom resolution / bitrate / frame rate | Modelled | P1 | `ExportSettings` takes them; no custom UI yet |
| Codec H.264 / H.265 | Built | P1 | `VideoCodec` |
| HDR export | Planned | P3 | — |
| Estimated file size | Built | P1 | `estimatedBytes` |
| Estimated time | Planned | P2 | — |
| Background export + notification + progress | Built | P1 | `ExportWorker`, foreground service |
| Cancellable export | Built | P1 | `ExportViewModel.cancel` |
| Save to gallery | Built | P1 | `MediaStore`, pending-flag guarded |
| Direct share to social apps | Planned | P2 | — |
| Batch export / multiple versions | Planned | P3 | — |
| Templates (bundled + user-saved) | Planned | P3 | — |
| Aspect ratio change with auto-reframe | Planned | P3 | — |

## UI system (PRD Part 2)

| PRD requirement | Status | Phase | Where |
|---|---|---|---|
| Zero overflow on all sizes/orientations/font scales | Built | P1 | `ApexScaffold`, `EditorLayout`, `overflowSentinel`, `OverflowMatrixTest` |
| Label or long-press tooltip on every control | Built | P1 | `ApexToolButton` signature |
| Full `contentDescription` on every control | Built | P1 | Wired inside the components |
| Ban on vague labels ("Tool", "FX", "More") | Built | P1 | `ToolCopyAuditTest` |
| 48 dp minimum touch target | Built | P1 | `MinTouchTarget`, asserted |
| Dark-first Material 3 theme, light supported | Built | P1 | `designsystem/Theme.kt` |
| Adaptive phone / tablet / landscape layout | Built | P1 | `EditorLayout` two-pane branch |
| User-resizable preview/timeline divider | Built | P1 | `EditorLayout` |
| Contextual bottom toolbar | Built | P1 | `EditorScreen` |
| Bottom sheets capped so preview stays visible | Planned | P2 | Rule stated in `01-architecture.md`; no panels yet |
| Projects screen with empty state | Built | P1 | `ProjectsScreen` |
| New Project dialog with per-option guidance | Built | P1 | `AspectRatio.guidance` |
| Export screen with explained presets | Built | P1 | `ExportScreen` |
| Media library with Device/Camera/Stock/Music tabs | Planned | P2 | System picker used for now |
| Settings (performance, storage, theme, licences) | Planned | P2 | — |
| RTL support | Built | P1 | `supportsRtl`, asserted in the overflow matrix |
| Localisation-ready strings | Built | P1 | `core/designsystem/res/values/strings.xml` |

## Performance & error handling (PRD §3.7, §3.8)

| PRD requirement | Status | Phase | Where |
|---|---|---|---|
| Device classification Low/Medium/High | Built | P1 | `device/DeviceClassifier.kt` |
| Classification from RAM, cores, Media Performance Class, storage | Built | P1 | `DeviceCapabilities` |
| Thermal state monitoring + automatic quality reduction | Built | P1 | `ThermalState`, `effectivePolicy` |
| Low-resource warning dialog with the PRD's three buttons | Built | P1 | `LowResourceWarning`, `EditorScreen` |
| "Don't show again for this device" | Modelled | P2 | Copy and button exist; DataStore persistence pending |
| Soft track/layer limits | Built | P1 | `softTrackLimit`, warns without blocking |
| Export ceiling by device class | Built | P1 | `ExportSettings.exceeds` + inline warning |
| Auto-save every few seconds | Built | P1 | `AutoSave`, 2 s debounce |
| Crash recovery "Restore last session?" | Built | P1 | `ProjectStore.load` + `EditorScreen` dialog |
| Missing media → relink UI | Modelled | P2 | Detected and banner-warned; picker pending |
| Corrupted file → skip and continue | Built | P1 | `MediaImporter` returns null; batch import reports the count |
| Out of storage mid-export → pause + cleanup | Planned | P2 | Muxing failure is explained today |
| Orientation / foldable change without data loss | Built | P1 | `configChanges`, state in the view model |
| Font scale 200% usable | Built | P1 | `OverflowMatrixTest` |
| Multi-window | Built | P1 | `resizeableActivity`, matrix test |
| No internet → core tools unaffected | Built | P1 | No `INTERNET` permission at all |
| Very long timelines (30+ min) | Modelled | P2 | Bounded thumbnail cache built; waveform cache pending |

## Online stock (PRD §4.2)

| PRD feature | Status | Phase |
|---|---|---|
| Pexels API + mandatory attribution | Planned | P3 |
| Pixabay API | Planned | P3 |
| Coverr API + clickable logo | Planned | P3 |
| Download-to-project (becomes offline) | Planned | P3 |
| Rate-limit and offline messaging | Planned | P3 |
| API keys kept out of source | Planned | P3 |

## Asset bundling (PRD §4.1)

| PRD item | Status | Phase |
|---|---|---|
| Whisper tiny + base, quantised | Planned | P3 |
| Font pack | Planned | P2 |
| Transitions library | Planned | P2 |
| Effects pack | Planned | P2 |
| Music + SFX pack | Planned | P3 |
| Cinematic LUT pack | Planned | P2 |
| Stickers, shapes, lower thirds | Planned | P3 |
| FFmpeg binaries (arm64-v8a, armeabi-v7a) | Planned | P2 | ADR 0002 |
| Default project templates | Planned | P3 |
| Settings → Storage with per-pack sizes | Planned | P4 |

## Explicitly excluded by the PRD

These are **not** gaps. The PRD rules them out, and the codebase contains nothing
that implements or prepares for them: generative AI of any kind (text-to-video,
generative fill, AI avatars, voice cloning, generative music/SFX), mandatory
accounts, cloud sync, ads, analytics for advertising, paid tiers, watermarks, and
any iOS or web client.

The app requests **no `INTERNET` permission**, which makes the offline and
privacy claims verifiable from the built APK rather than from a policy document:
with no network egress path, there is nowhere for user media to go.

For completeness, the merged manifest holds seven permissions. Three are declared
here — `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`
— all for the background export notification. The other four
(`ACCESS_NETWORK_STATE`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, and WorkManager's
own private receiver permission) are merged in by WorkManager. None grants
network access.

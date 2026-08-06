# Feature coverage

Every feature in PRD §5–§8, tracked individually. **No PRD feature is absent
from this table.** If something in the PRD is not listed here, that is a bug in
this document.

The purpose is to make "the app will have all of it" checkable rather than
hopeful: each row names where the feature stands today and which release it
lands in.

## Status key

| | Meaning |
|---|---|
| **Engine** | Implemented and tested in `packages/edit-engine`. Behaviour is settled. |
| **Modelled** | The data model exists and is serialised; the renderer or UI still has to execute it. Cheap to finish, no redesign. |
| **Reference** | Working in `apps/prototype` — proves the UX and the render path. |
| **Planned** | Not started. Needs new model work as well as UI. |

Release column: **R1** first release · **P1/P2/P3** the PRD's phases.

---

## 5.1 Core editing & timeline

| PRD feature | Status | Release | Where |
|---|---|---|---|
| Multi-track timeline, 6 video + 6 audio | Engine · Reference | R1 | `model/factory.ts` |
| Expand to 12+ tracks | Engine | P1 | `createDocument({videoTracks, audioTracks})` — no cap exists |
| Magnetic + free track modes | Engine | R1 | `Track.magnetic`, `edit/operations.ts` |
| Frame-accurate trim | Engine · Reference | R1 | `edit/clip-edit.ts` |
| Split | Engine · Reference | R1 | `splitClip`, `splitAt` |
| Ripple | Engine | R1 | `rippleDeleteClips`, `TrimOptions.ripple` |
| Roll | Engine | R1 | `rollEdit` |
| Slip | Engine | R1 | `slipClipBy` |
| Slide | Engine | R1 | `slideClip` |
| Precision zoom to 30× | Reference | R1 | `MAX_ZOOM` = 30× default |
| Audio scrub | Planned | R1 | Host media layer |
| Unlimited undo/redo | Engine · Reference | R1 | `history/history.ts` |
| Project history snapshots | Engine | R1 | `takeSnapshot`, `restoreSnapshot` |
| Markers | Engine | R1 | `Marker`, `addMarker` |
| Notes | Engine | R1 | `Marker.note` |
| Colour tags | Engine | R1 | `Clip.colorTag` |
| Clip linking / grouping | Engine | R1 | `linkClips`, `detachAudio` |
| Constant speed 0.1×–100× | Engine · Reference | R1 | `constantSpeed`, `MIN_RATE`/`MAX_RATE` |
| Reverse | Engine | R1 | `reverseClip` |
| Freeze frame | Engine | R1 | `freezeFrameAt` |
| Optical-flow slow motion | Modelled | P1 | `FrameBlending = 'optical-flow'`; algorithm is host-side |
| Speed curves with Bézier | Engine · Reference | R1 | `speed/speed.ts`, `slowMoRamp` |
| Transform keyframes (pos/scale/rot/opacity) | Engine · Reference | R1 | `animation/keyframes.ts` |
| Velocity graphs | Engine | P1 | `velocity()` exists; UI is the remaining work |
| Picture-in-picture | Engine · Reference | R1 | Transform + track stacking |
| Basic split-screen | Modelled | R1 | Transform + crop; needs presets in UI |
| Crop | Engine · Reference | R1 | `Transform.crop` |
| Rotate | Engine · Reference | R1 | `Transform.rotation` |
| Flip | Engine · Reference | R1 | `flipH`, `flipV` |
| Pan & zoom (Ken Burns) | Engine | R1 | Position/scale keyframes |
| Blending modes | Engine · Reference | R1 | 17 modes; 4 separable in the reference renderer |
| Opacity | Engine · Reference | R1 | `Transform.opacity` |
| Shape masks with feather | Modelled · Reference | R1 | `Mask`; ellipse/rect in reference renderer |
| Freehand masks | Modelled | P1 | `MaskShape = 'freehand'`; needs stencil pass |
| Basic chroma key | Engine · Reference | R1 | `ChromaKey`, chroma-space keyer in shader |
| Local stabilisation | Modelled | R1 | `Clip.stabilization`; analysis is host-side |
| Aspect ratios (7 presets + custom) | Engine · Reference | R1 | `ASPECT_RATIOS` |
| Frame rates 24/25/30/50/60 + NTSC | Engine · Reference | R1 | `FRAME_RATES`, 8 rates, all exact |

## 5.2 Colour & effects

| PRD feature | Status | Release | Where |
|---|---|---|---|
| Exposure, contrast, highlights/shadows | Engine · Reference | R1 | `color/grade.ts` |
| Temperature, tint | Engine · Reference | R1 | Shader white balance |
| Vibrance | Engine · Reference | R1 | Saturation-weighted |
| Curves (RGB + luma) | Engine · Reference | R1 | Monotone cubic, cannot band |
| HSL | Modelled | P1 | 8 bands in `ColorGrade.hsl` |
| Colour wheels | Modelled · Reference | P1 | Lift/gamma/gain/offset in shader; needs touch control |
| Scopes (waveform, vectorscope, histogram) | Planned | P2 | Derived from the composed frame |
| LUT import (.cube) + library | Modelled | R1 | `LutRef`; parser is host-side |
| Filters, film looks, glitch, grain, light leaks | Engine · Reference | R1 | 16 effects in the registry |
| Keyframable effects | Engine | R1 | `ParamDef.animatable` |
| Body/face beauty with tracking | Planned | P1 | Needs on-device face tracking |

## 5.3 Audio

| PRD feature | Status | Release | Where |
|---|---|---|---|
| Multi-track audio | Engine | R1 | `render/audio-graph.ts` |
| Volume keyframes | Engine · Reference | R1 | `AudioClipParams.gainDb` |
| Fades | Engine · Reference | R1 | 4 fade shapes |
| Ducking | Engine | R1 | `DuckingRule`, sidechain |
| Waveform display | Modelled | R1 | `MediaAsset.waveformPeaks`; drawing is UI |
| Basic EQ | Engine | R1 | `EqBand`, 3-band default |
| Noise reduction (on-device) | Modelled · Reference | R1 | `noiseReduction`; DSP is host-side |
| Voiceover while timeline plays | Planned | R1 | Host recording layer |
| Audio extraction | Engine | R1 | `detachAudio` |
| Audio reverse | Engine | R1 | `AudioClipParams.reverse` |
| Pitch | Engine · Reference | R1 | `pitchSemitones`, independent of rate |
| Beat detection / markers | Modelled | R1 | `MediaAsset.beats`; detection is on-device |
| Local music + SFX library | Planned | R1 | Bundled pack, downloadable extras |

## 5.4 Text, captions & graphics

| PRD feature | Status | Release | Where |
|---|---|---|---|
| Rich text (font, size, colour, outline, shadow, background) | Engine · Reference | R1 | `TextStyle`, rasterised in reference build |
| Text animations + keyframes | Engine | R1 | Transform keyframes on text clips |
| On-device auto-captions | Modelled | R1 | `CaptionTrack`, `source: 'on-device'` |
| High-accuracy multi-language captions | Modelled | P1 | `captions-premium` capability |
| Caption translation | Modelled | P1 | `translate-captions` capability |
| Caption styling templates | Engine | R1 | 5 presets in `CAPTION_STYLES` |
| Word-level animation | Engine | R1 | `CaptionWord`, per-word progress in `RenderFrame` |
| Stickers | Planned | R1 | Asset pipeline |
| Shapes | Engine | R1 | `ClipContent.shape` |
| Lower thirds | Engine | R1 | Text + shape composition |
| Brand kit (logo, colours, fonts) | Planned | P1 | Needs a document-level model |

## 5.5 AI

All 22 capabilities are defined in `ai/jobs.ts` with their upload tier, credit
cost and time estimate, and all appear in the app. On-device ones run at R1;
server ones are visible and marked "Coming soon" until P1.

| PRD feature | Status | Release |
|---|---|---|
| Background / subject removal (on-device) | Modelled · Reference | R1 |
| Basic object tracking (on-device) | Modelled | R1 |
| Simple enhancement / denoise (on-device) | Modelled | R1 |
| Basic auto-captions (on-device) | Modelled | R1 |
| Premium captions | Modelled | P1 |
| Filler word removal | Engine | P1 |
| Bilingual / translation | Modelled | P1 |
| High-quality TTS | Modelled | P1 |
| Voice cloning | Modelled | P1 |
| Text-to-video | Modelled | P3 |
| Image-to-video | Modelled | P3 |
| AI avatars | Modelled | P3 |
| Advanced object removal + temporal inpainting | Modelled | P1 |
| Super-resolution / upscaling | Modelled | P1 |
| Style transfer / anime | Modelled | P2 |
| AI auto-edit | Modelled | P2 |
| Highlight reel | Modelled | P2 |
| Long-to-short | Modelled | P2 |
| Natural language editing | Modelled | P3 |
| Generative music | Modelled | P3 |
| Generative SFX | Modelled | P3 |
| "Requires internet" state | Engine · Reference | R1 |
| "Process later" queue | Engine · Reference | R1 |
| Upload only proxies / necessary media | Engine · Reference | R1 |
| Async with completion notification | Engine | R1 |

## 5.6 Media, export & sharing

| PRD feature | Status | Release | Where |
|---|---|---|---|
| In-app camera (auto) | Planned | R1 | Host camera layer |
| Pro camera (ISO, shutter, WB, focus) | Planned | R1 | Host camera layer |
| Teleprompter | Planned | R1 | UI over the camera |
| Import from camera roll / Files | Reference | R1 | Host pickers |
| Import from external drives | Planned | P1 | Host |
| Import from cloud | Planned | P1 | Host |
| Export to 4K60 | Engine · Reference | R1 | `render/export.ts` |
| H.264 / HEVC | Engine | R1 | `VideoCodec` |
| Bitrate control | Engine · Reference | R1 | `recommendedBitrate` |
| HDR support | Modelled | P2 | `colorSpace`, `ExportSettings.hdr` |
| Platform presets | Engine · Reference | R1 | 9 presets |
| Direct share to socials | Planned | R1 | Host share sheet |
| Watermark-free exports | Engine | R1 | No watermark exists in the pipeline |
| Project package export | Engine | R1 | `buildPackageManifest` |

## 5.7 Collaboration & cloud

| PRD feature | Status | Release |
|---|---|---|
| Optional cloud project sync | Planned | P2 |
| Shared spaces + comments | Planned | P2 |
| Brand kits shared across a team | Planned | P2 |
| Review links | Planned | P2 |

## 5.8 Templates & assets

| PRD feature | Status | Release |
|---|---|---|
| Large template library | Planned | R1 (curated set) → P1 (library) |
| Easy media replace | Planned | R1 |
| User-saved templates | Planned | P1 |
| Downloadable asset packs for offline | Planned | R1 |

## §7 UI/UX requirements

| PRD requirement | Status | Where |
|---|---|---|
| Dark theme primary | Reference | `styles/tokens.css` |
| Optional light mode | Reference | `[data-theme='light']` |
| 8pt grid | Reference | Spacing scale |
| Accent colour finalised | Decided | Teal `#22E3C3` — [`04-ui-spec.md`](04-ui-spec.md) |
| Bottom toolbar in thumb zone | Reference | `.toolbar` |
| Contextual slide-up panels | Reference | `.panel` |
| Pinch to zoom timeline | Reference | `Timeline.tsx` |
| Long-press for advanced options | Planned | R1 |
| Double-tap to select + transform | Planned | R1 |
| Haptics on cut / keyframe / export | Reference | `haptic()` |
| Real-time resizable preview | Reference | Preview is always visible |
| Phone vertical layout | Reference | Single column |
| Tablet dual-pane / landscape | Reference | ≥900px breakpoint |
| Simple vs Pro mode | Reference | Constant vs keyframe writes |
| VoiceOver / TalkBack | Reference | Named controls throughout |
| Dynamic Type | Reference | Scrolling toolbar, relative units |
| Reduced motion | Reference | `prefers-reduced-motion` |
| Colour-blind safe indicators | Reference | Hatching + luminance-separated tags |
| Keyboard support | Reference | Space, arrows, S, delete, ⌘Z |

## §8 Technical requirements

| PRD requirement | Status | Note |
|---|---|---|
| iOS 17+ native | Planned | ADR 0001 |
| Android 12+ native | Planned | Capacitor shell exists; native layer is ADR 0001 |
| Offline-first local database | Planned | Engine is storage-agnostic by design |
| Hardware-accelerated media engine | Reference | WebGL2 today; Metal/Vulkan planned |
| On-device ML | Planned | Core ML / NNAPI / MediaPipe |
| Backend API, queue, workers, storage | Planned | P1, per ADR 0002 |
| Never block editing on network | Engine · Reference | Verified with the network disabled |
| 60 fps scrubbing | Reference | `frameCost()` drives proxy fallback |
| Proxy generation | Modelled | `MediaAsset.proxyState` |
| Background rendering | Planned | Host |
| Launch to timeline < 2.5s | Planned | Native shells |
| Media stays on device by default | Engine | No upload path without consent |
| Explicit consent before upload | Engine · Reference | State transition, not a flag |
| E2E encryption for cloud projects | Planned | P2 |
| Data deletion tools | Planned | P1 |

---

## Honest gaps

Three PRD items are not purely engineering, and no amount of code closes them:

- **Music and generative-content licensing** (§11). R1 ships an owned or
  perpetually-licensed pack to avoid the question for one release.
- **App Store review risk on generative AI** (§11). Mitigated by launching
  without server generation, so there is a shipped, reviewed app before the
  risky surface turns on.
- **Free vs paid split** (§11). Watermark-free free-tier exports are decided;
  the rest waits on real Phase 1 inference costs.

Everything else on this page is a matter of build order.

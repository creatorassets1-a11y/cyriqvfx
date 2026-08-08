# ApexEdits – Product Requirements Document (PRD)

Version 1.0 | Enterprise-Grade Offline-First Android Video Editor
App Name: ApexEdits
Platform: Android (API 24+ / Android 7.0+, optimized for all devices including low-spec)
Language/Stack: 100% Kotlin + Jetpack Compose + Media3 + FFmpeg + whisper.cpp
Pricing: Completely free, no ads, no in-app purchases, no watermarks, no tracking for monetization.
Philosophy: The single most complete, professional, clutter-free, offline-capable mobile video editor that rivals CapCut + Premiere Pro + After Effects capabilities in one app. Built for real editors who want power without friction.

This PRD is written for Claude Code (and any senior Android/Kotlin developer). It is exhaustive, scenario-aware, and specifies exact behavior. Deliver in modular parts if needed. No AI generative features (no text-to-video, no generative fill, no AI avatars, no voice cloning, etc.). Auto-captions via bundled Whisper only.

---

## Part 1: Vision, Goals, Non-Goals, Target Users & Success Metrics

### Vision

ApexEdits is the ultimate Android video editor: professional desktop-class power (multi-track, keyframes, color, masking, audio, effects) in a clean, mobile-native, gesture-first interface that never overflows, never feels cluttered, and works primarily offline. Most features run fully offline. The APK can be large (Whisper models + assets + FFmpeg) — that is acceptable and preferred for completeness and offline reliability.

### Primary Goals

- Deliver near-parity with CapCut's speed + social polish + Premiere Pro's precision + After Effects' compositing/animation depth, adapted perfectly for touch and Android constraints.
- Offline-first: Core editing, preview, export, effects, color, audio, text, transitions, stabilization, chroma key, masking, keyframing, and Whisper captions work without internet.
- Perfect UI: Zero overflow on any screen size/orientation/DPI. Everything stays within safe areas and visible bounds. Adaptive, responsive, gesture-driven, minimal chrome.
- Universal device support: Runs on low-end (2–3 GB RAM) to flagship. Intelligent performance adaptation + clear warnings.
- Zero compromise on quality, speed, reliability, and polish. Smart error handling. Human-feeling UX (no "AI slop").
- Free forever, privacy-respecting (local processing preferred).

### Non-Goals

- No generative AI features.
- No mandatory cloud accounts or locked features.
- No ads, tracking for ads, or paid tiers.
- Not a pure social short-form only tool (supports long-form too).
- Not a web/desktop app (Android native only).

### Target Users

- Social media creators (TikTok/Reels/Shorts/YouTube)
- Professional mobile editors and freelancers
- Students, educators, businesses doing internal/external video
- Hobbyists who want pro tools without desktop
- Users on low-to-high end Android devices worldwide

### Success Metrics (Internal)

- 60 fps smooth timeline scrubbing on mid-range devices with proxies.
- Export times competitive with CapCut on same hardware.
- Crash rate < 0.5% on supported devices.
- 95%+ of core features usable offline.
- User retention via pure utility and polish.

---

## Part 2: Technical Architecture & Offline Strategy

### Core Stack (Mandatory)

- **UI:** Jetpack Compose + Material 3 (custom themed). Strict constraint-based layouts, WindowInsets, safe drawing, adaptive navigation. No fixed dp sizes that overflow. Use BoxWithConstraints, `Modifier.fillMaxSize()`, nested scroll, and responsive breakpoints.
- **Playback & Preview:** Media3 ExoPlayer (with custom renderers if needed).
- **Editing/Export Pipeline:** Media3 Transformer for hardware-accelerated paths + full FFmpeg (mobile-ffmpeg or statically compiled FFmpeg with all necessary codecs/filters) for complex filters, chroma, advanced effects, multi-track mixing, and final export. Prefer hardware (MediaCodec) wherever possible; fall back gracefully.
- **Project Storage:** Room + SQLite + file-based media cache. Projects are self-contained folders (XML/JSON project file + relative media links + rendered proxies).
- **Audio:** Media3 + custom DSP where needed (EQ, compression, noise reduction via offline algorithms/FFmpeg).
- **Captions:** Bundled whisper.cpp (official Android example + optimized AAR or JNI). Ship multiple models (tiny, base, small — quantized). User can download additional larger models later if desired, but core models are bundled. Full offline, timestamps, multi-language support via Whisper.
- **Other:** Kotlin Coroutines + Flow, WorkManager for background export, CameraX for in-app capture if needed, Coil/Glide for thumbnails.

### Offline-First Rules

- All core editing tools, effects library (bundled), fonts, transitions, basic music/SFX pack, LUTs, stickers, shapes = fully offline.
- Media import from device storage/gallery/files/camera = offline.
- Whisper auto-captions = fully offline (model in APK/assets or first-run extract).
- Proxies generated and stored locally.
- Only optional online: stock media (Pexels, Pixabay, Coverr free APIs), extra free fonts/music if available via free endpoints, community templates (if implemented later).
- Graceful degradation: if online feature fails, show clear offline message and continue.

### Performance & Low-Spec Handling

On launch and before heavy ops (high-res import, complex effects, long timeline, export, Whisper on long audio, multi-layer composite): detect device class via RAM, CPU cores, SoC, available storage, thermal state.

Classification: Low / Medium / High.

Low-spec behavior:

- Automatic proxy generation (lower resolution/bitrate for timeline).
- Reduced preview quality / frame rate option.
- Warning dialog before heavy features: "Your device has limited resources. Running [feature] may cause lag, high battery use, or crash. Continue anyway?" with "Always allow on this device" checkbox and "Use safer settings" alternative.
- Limit simultaneous tracks/layers on very low devices (soft limit with upgrade path via proxies).
- Aggressive memory management, bitmap recycling, background thread everything possible.

Support 720p/1080p/4K import & export (device-dependent). Use hardware decode/encode. Timeline uses efficient thumbnail generation and waveform caching. No UI element may overflow: test on smallest phones, foldables, tablets, landscape/portrait, different font scales, and display cutouts.

### APK Size

Large is acceptable. Bundle:

- Whisper models (tiny + base at minimum; small if feasible).
- Comprehensive free effects, transitions, fonts, basic royalty-free music/SFX pack, LUTs, stickers.
- FFmpeg binaries for required ABIs (arm64-v8a primary, armeabi-v7a if needed).

Provide "Lite" optional download for extra assets post-install if Play Store size limits force it, but prefer single complete APK.

---

## Part 3: Feature Set (Core Editing) – The Ultimate List

### Project & Media Management

- Create project with aspect ratio presets (9:16, 16:9, 1:1, 4:5, custom, cinematic, stories, etc.) + frame rate (24/25/30/50/60).
- Unlimited projects. Local only. Export/import project packages.
- Media library: import video, image, audio, from gallery, files, camera, or online stock (optional).
- Automatic proxy generation (user-toggleable quality).
- Media metadata view, favorite, search, folders/tags.
- Relink missing media.
- Duplicate, replace media in timeline.

### Timeline (Multi-Track Professional)

- Unlimited video, audio, text, overlay, effect, adjustment tracks (practical soft limits on low devices).
- Magnetic and freeform modes.
- Precise frame-accurate scrubbing, zoom (pinch + buttons), snap to clips/markers/beats.
- Ripple, overwrite, insert, lift, extract edit modes.
- Split, trim, delete, ripple delete, close gap.
- Group/ungroup, nest/compound clips, freeze frame, reverse.
- Speed: constant + curve/ramping (ease in/out), time remapping.
- Markers, chapters, comments (local).
- Waveforms on all audio, thumbnails on video.
- Multi-select, copy/paste attributes, paste insert.
- Undo/redo stack (deep, persistent per project).
- Playhead, in/out points, loop playback, fullscreen preview.

### Video Tools

- Transform: position, scale, rotation, anchor, opacity, crop, flip — all keyframeable.
- Chroma key / green screen with fine controls (tolerance, edge, spill, shadow).
- Masks: rectangle, ellipse, freehand/pen, text, linear; feather, invert, track matte; keyframeable.
- Object tracking / motion tracking for masks, text, stickers (offline optical flow or feature-based where feasible).
- Stabilization (FFmpeg/vid.stab or Media3 equivalent, strength control, crop compensation).
- Picture-in-picture, split-screen layouts (templates + free).
- Blending modes, opacity.
- Adjustment layers.
- Retiming, optical flow interpolation for slow-mo where possible.

### Effects, Filters, Transitions, Color

- Large bundled library of transitions (cuts, dissolves, wipes, zooms, glitches, light leaks, etc.) — duration and parameters adjustable, keyframeable where makes sense.
- Video effects: blur, sharpen, glow, glitch, VHS, film grain, light leaks, particles (performance-aware), 3D-ish transforms, etc.
- Color: basic (exposure, contrast, saturation, temperature, tint, highlights/shadows), advanced (RGB/HSL curves, color wheels for lift/gamma/gain, HSL secondary, LUTs import + bundled cinematic LUTs), scopes (waveform, vectorscope, histogram — simple implementations).
- Apply to clip or adjustment layer. Copy/paste attributes. Intensity control.

### Audio

- Multi-track mixing with volume, pan, mute, solo.
- Keyframeable volume automation, fades.
- EQ (parametric), compression, noise reduction/gate (offline algorithms), reverb/delay basic.
- Auto-duck music under voice (simple detection).
- Detach audio, replace, extract.
- Beat detection / markers for music (offline).
- Voiceover recording in-app.
- Audio effects library + SFX pack (bundled free).

### Text & Graphics

- Advanced text: system + bundled fonts, size, color, stroke, shadow, background, alignment, tracking, leading.
- Text animations and presets (kinetic, typewriter, etc.), keyframeable path/position/scale/opacity/rotation.
- Captions: Whisper auto-generate (offline) → editable timeline captions with styles, word-level timing if available, animation presets (CapCut-style social captions).
- Stickers, emojis, shapes, lower-thirds, callouts — all transformable and animatable.
- Drawing tools (freehand annotation).

### Other Essential

- Templates: bundled starter templates + ability to save user templates.
- Aspect ratio change with manual/auto-reframe tools (position/scale).
- Batch export, multiple versions.
- Export presets for TikTok, Reels, Shorts, YouTube, Instagram, custom (resolution, bitrate, codec H.264/H.265, frame rate, audio).
- Background export with notification + progress. Cancelable.
- Share directly or save to gallery/files.

---

## Part 2 (UI): UI/UX Design System, Screens, Layout Rules & Self-Explanatory Interface

This part is written so Claude Code (or any implementer) cannot produce cluttered, overflowing, or cryptic UI. Every interactive element must be self-explanatory. Icons alone are never sufficient. Every button, tool, and control requires:

- A clear visible text label **or**
- A long-press / hover tooltip that fully explains the action in plain language (as if the user has never used a video editor), **and**
- A complete `contentDescription` / semantics for TalkBack and accessibility that states exactly what the control does and what happens when activated.

Example (mandatory pattern):

> Icon of scissors → Label or Tooltip: "Split Clip – Cuts the selected clip into two separate pieces at the playhead position."
> `contentDescription`: "Split the currently selected clip into two clips at the current playhead. The right half becomes a new clip."

Never use vague names like "Tool", "FX", "More", or icon-only without explanation.

### 2.1 Core UI/UX Principles (Non-Negotiable)

**Zero Overflow Guarantee**
Every screen, panel, dialog, bottom sheet, and timeline element must stay fully within the visible bounds on all Android devices (phones from 4.5" to large foldables/tablets, all densities, all orientations, font scale 0.85–2.0, display cutouts, gesture navigation, 3-button navigation).

Use Jetpack Compose exclusively with: `BoxWithConstraints`, `Modifier.fillMaxSize()`, `windowInsetsPadding`, `safeDrawingPadding`, `Modifier.clipToBounds()`, adaptive `WindowSizeClass`, and `ConstraintLayout` or nested `Column`/`Row` with weights and scroll only where content legitimately exceeds.

Never hard-code fixed heights/widths that can push content off-screen. Timeline height is adaptive and user-resizable within safe limits. Preview area always remains visible.

Test matrix (must pass): smallest phones, foldables (inner/outer), tablets, landscape, portrait, multi-window, high font scale, dark/light, RTL languages.

**No Clutter / Progressive Disclosure**
Main editing screen shows only: Preview, Timeline, primary transport controls, and a contextual bottom toolbar of the currently relevant tools. Secondary tools live in expandable bottom sheets, side drawers (on larger screens), or tabbed panels that slide up without covering the preview completely. Maximum visible primary tools at once: 6–8. Everything else is one tap away. Collapsible sections with clear "Show more tools" / "Hide advanced" labels that explain what is hidden.

**Self-Explanatory Everything**
Every icon button must have either an always-visible short text label under/beside it or a mandatory long-press tooltip + accessibility description that explains the function in full plain English. Tooltips appear on long-press (mobile) and are dismissible. They never assume prior knowledge. Buttons that open panels must say what the panel contains (e.g. "Color & Light – Adjust brightness, contrast, color temperature, and advanced grading"). Destructive actions always require confirmation with clear consequence text.

**Thumb Zone & Reachability**
Primary actions (Play/Pause, Split, Delete, Export) live in the bottom 40–50% of the screen. Timeline scrubbing and zoom are gesture-first (pinch, drag). Minimum touch target: 48 dp. Preferred 56 dp for primary tools.

**Visual Design**
Material 3 with custom dark-first theme optimized for video (deep charcoal backgrounds, high-contrast accents, subtle elevation). Light theme fully supported. High contrast for timeline clips, waveforms, and playhead. Consistent iconography (Material Icons + custom set for video tools). Icons are simple, filled when active. Smooth 60 fps animations using Compose animation APIs. No jank.

**Accessibility (WCAG 2.2 AA minimum)**
Full TalkBack support with meaningful `contentDescription`s. Scalable text. Sufficient color contrast. Keyboard/d-pad navigation support where possible. Captions and waveforms always available.

### 2.2 Main Editing Screen Layout

Structure (top to bottom, portrait default; landscape adapts by moving timeline beside or below preview):

**Top App Bar** (compact, collapsible on scroll if needed)
Left: Back / Projects (Tooltip: "Return to your project list. Unsaved changes will be saved automatically."). Center: Project name (editable on tap) + current duration / resolution indicator. Right: Undo, Redo, Export button (always visible, labeled "Export Video – Render and save your finished video").

**Preview Area** (largest possible space)
Video preview with safe-area overlays for aspect ratio guides (optional toggle). Overlay controls that appear on tap: Play/Pause large button, current time / total time, fullscreen toggle. Pinch-to-zoom and pan on the preview itself for precise framing. On-screen transform handles when a clip is selected (position, scale, rotation) with clear labels.

**Timeline Area** (adaptive height, user can drag the divider to resize between preview and timeline within safe min/max)
Horizontal scrollable multi-track timeline. Tracks labeled clearly on the left (Video 1, Audio 1, Text, Overlay, etc.) with lock, mute, solo, visibility toggles. Each toggle has full tooltip/explanation. Playhead (vertical line) with time readout. Clip blocks show thumbnail strip + name + duration. Selected clip highlighted. Waveforms on audio tracks. Zoom controls (pinch + dedicated +/– buttons with tooltips: "Zoom Timeline In – Make clips larger so you can edit more precisely"). Snap toggle (Tooltip: "Snap to Edges – When on, clips automatically align to other clips, markers, and the playhead for clean edits").

**Bottom Contextual Toolbar** (always visible, changes based on selection)
When nothing selected: Import Media, Add Track, Templates, Stock Media, Captions (Whisper), Audio Library. When a video clip is selected: Split, Delete, Speed, Volume, Transform, Effects, Color, Mask, Chroma Key, Duplicate, etc. Each button follows the self-explanatory rule. Overflow menu ("More Tools") only if absolutely necessary; it must list and explain every hidden item.

**Landscape & Large Screen Adaptations**
On tablets/foldables: optional dual-pane (preview left, timeline + tools right) or expanded multi-column tool panels. Timeline can be placed beside the preview. All rules about overflow and labels still apply.

### 2.3 Key Screens & Flows

**Home / Projects Screen** — Grid or list of projects with thumbnail, name, duration, last modified, resolution. Floating Action Button: "New Project – Start a new video edit from scratch". Long-press project → Rename, Duplicate, Delete, Export Project Package, Share. Empty state with clear illustration and "Create your first project" button that explains the next step.

**New Project Dialog** — Aspect ratio selector with visual previews and labels (e.g. "9:16 Vertical – Best for TikTok, Reels, Shorts"). Frame rate, starting resolution (or "Match first media"). Optional starting template. "Create" button.

**Media Import / Library** — Tabs: Device, Camera, Stock (online free APIs), Music, Recent. Clear search, filters (video/image/audio, duration, orientation). Multi-select with "Add to Timeline" button that explains insertion point options (at playhead, at end, replace).

**Export Screen** — Preview of final settings. Presets: TikTok, Instagram Reels, YouTube Shorts, YouTube Landscape, Custom – each with explanation of recommended resolution/bitrate. Advanced: resolution, bitrate, codec (H.264/H.265), frame rate, audio settings. Estimated file size and time. "Start Export" with progress, background support, and cancel. Low-spec warning if applicable: "Your device may struggle with 4K export. Continue with 1080p instead?"

**Settings** — Performance (proxy quality, preview resolution, hardware acceleration toggle). Storage management (clear cache, proxies). Accessibility, theme, language. About / Licenses (for bundled assets, FFmpeg, Whisper, free APIs).

### 2.4 Tool Panels (Bottom Sheets / Side Panels)

All panels: Slide up from bottom (or side on large screens). Drag handle + clear title that states purpose. Scrollable content inside with sticky apply/reset buttons. Never cover the entire preview; leave at least 30–40% of preview visible. Close by swipe down or explicit "Done" / "Apply" button.

Examples of required panel titles and explanations:

- "Split & Trim Tools – Cut, trim, or delete parts of the selected clip."
- "Speed Controls – Change how fast or slow the clip plays, including smooth speed ramps."
- "Color & Light – Adjust brightness, contrast, saturation, temperature, and professional color wheels."
- "Effects Library – Browse and apply visual effects such as blur, glow, film grain, and glitch. Effects can be keyframed."
- "Text & Captions – Add titles, lower thirds, or generate automatic captions from speech using the built-in offline engine."
- "Chroma Key (Green Screen) – Remove a solid color background so you can place the subject over another video or image."

Every slider, toggle, and button inside these panels must itself follow the self-explanatory labeling rule.

### 2.5 Online Free Stock Integration (Optional, Non-Blocking)

Stock tab in media library uses free APIs only: Pexels API (videos + photos), Pixabay API, Coverr API (with required attribution logo as per their terms). Search, preview, download to local project cache. Clear offline indicator when no network. Attribution displayed where required (Coverr logo clickable). No paid APIs. Rate-limit handling with friendly messages. Downloaded media becomes fully offline after first fetch.

### 2.6 Error Handling & Low-Spec UX

Non-blocking snackbars for minor issues. Modal dialogs only for destructive or risky actions.

Low-spec popup (exact text example):

> **Limited Device Resources Detected**
> Running high-resolution preview or complex effects may cause lag, overheating, or the app to close unexpectedly.
> Recommended: Use lower-quality proxies and 1080p export.
> [Use Safer Settings] [Continue Anyway] [Don't show again for this device]

Smart recovery: auto-save every few seconds, crash recovery on relaunch with "Restore last session?" dialog.

---

## Part 3 (Detail): Detailed Feature Specifications, Acceptance Criteria, Key Systems & Edge Cases

### 3.1 Keyframe Animation System

Full property keyframing for almost every parameter (inspired by Premiere Pro / After Effects / LumaFusion). Users can animate position, scale, rotation, opacity, volume, effect intensity, color values, mask parameters, text properties, etc.

**UI Requirements** — When a clip or effect is selected, a "Keyframes" button appears in the contextual toolbar. Tooltip / Label: "Keyframes – Add animation points so properties change smoothly over time. Double-tap the diamond icon on any slider to add a keyframe at the playhead." Timeline shows keyframe diamonds on the selected clip. Drag to move, long-press to delete or edit easing. Graph editor (simple curves view) accessible via "Show Animation Curves – Edit the speed and shape of how values change between keyframes (linear, ease-in, ease-out, bezier)." Easing presets with clear names and previews.

**Technical** — Store keyframes as time + value + interpolation type in the project model (Room + JSON). Preview uses Media3 effects or custom GL shaders that interpolate in real time. Export: bake keyframes into the final composition via Media3 Transformer custom effects or FFmpeg filter expressions / sendcmd. Unlimited keyframes per property (soft limit on very low RAM devices with warning).

**Acceptance Criteria** — Adding, moving, deleting keyframes is instantaneous on mid-range devices. Smooth real-time preview of animated properties. Export matches preview exactly (within 1 frame). Works fully offline. Low-spec: automatic reduction of preview quality; warning before adding >50 keyframes on a single clip.

### 3.2 Color Grading & Correction Tools

**Basic Panel** — Title: "Color & Light – Quickly fix brightness, contrast, and color balance." Sliders with live preview + numeric values + reset: Exposure, Contrast, Highlights, Shadows, Saturation, Temperature, Tint, Vibrance. Each slider tooltip explains the effect in plain language (e.g. "Temperature – Make the image warmer (orange) or cooler (blue)").

**Advanced Panel** — Color Wheels (Lift / Gamma / Gain) with clear labels. RGB and HSL Curves (tap to add points). Secondary HSL (select a color range and adjust only that). LUT browser: bundled cinematic LUTs + user import (.cube). Scopes: simple Waveform, Vectorscope, Histogram (toggleable, performance-aware).

**Technical** — Prefer Media3 built-in color effects + custom GL shaders. Complex grading falls back to FFmpeg (eq, curves, colorbalance, lut3d, etc.). Adjustment layers supported (affect everything below).

**Acceptance Criteria** — Real-time preview on Medium+ devices; proxy-based on Low. LUTs apply correctly and can be intensity-blended. Fully offline. Export preserves full bit-depth where hardware allows.

### 3.3 Effects, Transitions, Masks, Chroma Key

**Effects Library** — Panel title: "Effects Library – Browse visual effects you can apply to clips. Many effects can be animated with keyframes." Categories with search. Each effect card shows name + short description + intensity slider after apply. Examples: Blur, Sharpen, Glow, Film Grain, VHS, Glitch, Light Leak, Mosaic, Mirror, etc. Performance tags (Light / Medium / Heavy) shown so users know impact.

**Transitions** — Applied between clips. Panel: "Transitions – Smooth or creative ways to change from one clip to the next. Drag the edges to change duration." Duration, alignment, and parameters adjustable. Many are keyframeable.

**Masks** — "Mask Tools – Hide or reveal parts of a clip. Use shapes or draw freely. Masks can be animated and tracked." Rectangle, Ellipse, Freehand, Linear. Feather, invert, expansion. Track matte support.

**Chroma Key** — "Chroma Key (Green Screen) – Remove a solid-colored background (usually green or blue) so you can place your subject over another video or image." Color picker, tolerance, edge softness, spill suppression, shadow controls. Live preview.

**Technical** — Simple effects via Media3. Advanced (chroma, complex masks, stabilization) via FFmpeg filters (chromakey, colorkey, geq, overlay, vidstab, etc.) or custom GL. Stabilization: vid.stab or equivalent, with strength and cropping options.

**Acceptance Criteria** — Chroma key produces clean edges on well-lit green screen. Masks and effects are keyframeable. Heavy effects trigger low-spec warning and offer proxy mode. All work offline.

### 3.4 Audio Tools

**Multi-track Mixer** — Volume, pan, mute, solo per track/clip. Keyframeable volume automation. Waveforms always visible (cached). "Audio Effects – Add equalizer, compression, noise reduction, or reverb to make your sound clearer and more professional."

**Specific Tools** — Parametric EQ with visual graph. Noise reduction / gate (offline spectral or simple algorithms). Auto-duck (music lowers when voice is detected). Fade in/out handles on clips. Voiceover recording with monitoring. Detach audio from video, replace, extract.

**Acceptance Criteria** — Real-time mixing on Medium+ devices. No audible glitches when scrubbing. Fully offline processing. Export mixes down correctly with chosen bitrates.

### 3.5 Text, Graphics & Auto-Captions (Whisper)

**Text Tool** — "Add Text – Create titles, captions, lower thirds, or animated text. You can change font, color, size, and animate any property." Full typography controls + animation presets + keyframing.

**Auto-Captions Workflow** — Button: "Auto Captions – Automatically create subtitles from the spoken words in your video using the built-in offline speech engine. Works without internet."

Flow: Select clip(s) or whole timeline. Choose language (auto-detect available) and model size (Tiny / Base recommended; Small on high-end). Progress indicator with estimated time and "Cancel". Results appear as editable caption clips on a dedicated track with word-level or sentence-level timing. Style panel: font, size, color, background, animation (pop, typewriter, etc.), position. Edit text, timing, split, merge freely.

**Technical Implementation (Mandatory Details)** — Bundle quantized whisper.cpp models (ggml or GGUF): at minimum Tiny and Base (Q5_K_M or Q4_K_M preferred for size/speed). Small optional via first-run download or larger APK. Use official whisper.android example + optimized AAR / JNI (arm64-v8a primary). Support NEON / FP16 where available. Extract audio from timeline (Media3 or FFmpeg) → 16 kHz mono WAV → whisper.cpp → timed segments. VAD (Voice Activity Detection) recommended to speed up and improve accuracy. Models stored in app assets or files dir; loaded on demand and released after use to control RAM. Low-spec: force Tiny model + warning for clips > 2–3 minutes. Show estimated RAM/CPU impact. Fully offline. Privacy: audio never leaves device.

**Acceptance Criteria** — Accurate transcription on clear speech (target comparable to CapCut free tier for English + major languages). Editable, styleable, exportable captions (burned-in or sidecar SRT). Works on devices with ≥ 3 GB RAM using Tiny/Base. Clear failure message + suggestion on weaker devices. Progress is cancellable; partial results recoverable.

### 3.6 Export Pipeline & Project Management

**Export Screen** — Presets with explanations: "TikTok / Reels / Shorts – Vertical 1080×1920, optimized bitrate for social media." Custom: resolution, codec (H.264 / H.265), bitrate, frame rate, audio settings, HDR if supported. Estimated size & time. Background export via WorkManager + notification. "Save Project Package – Create a single file containing your project and media references so you can move it to another device."

**Technical** — Prefer Media3 Transformer for hardware path (trim, basic effects, composition). Complex multi-track, advanced effects, keyframes, chroma → FFmpeg or hybrid. Proxy workflow: edit on proxies, switch to original media for final export. Automatic checkpointing.

**Acceptance Criteria** — Export matches timeline preview. Supports 720p–4K (device dependent). Background export survives app backgrounding. Crash recovery restores last auto-save.

### 3.7 Performance Adaptation Matrix & Low-Spec Handling

Device classification on launch and before heavy operations (RAM, CPU cores, Media Performance Class, available storage, thermal):

- **Low** (≤ 3–4 GB RAM or weak SoC): Force proxies, lower preview resolution (480p/720p), limit simultaneous heavy effects, Tiny Whisper only, soft track limits, frequent warnings.
- **Medium**: Proxies optional, 1080p preview, Base Whisper OK.
- **High**: Full quality, larger models, more layers.

Every heavy action shows the exact dialog from Part 2. Proxies generated in background on import (user can disable). Memory: aggressive recycling, limit decoded frames, release Whisper context after use.

### 3.8 Edge Cases & Error Handling

- Missing media → clear relink UI.
- Corrupted file → skip with message + continue project.
- Out of storage mid-export → pause + offer cleanup.
- Thermal throttling → reduce quality automatically + notify.
- Orientation change / foldable posture → layout adapts without data loss or overflow.
- Font scale 200% → all text and buttons remain usable and non-overflowing.
- No internet → stock tab shows offline message; all core tools remain fully functional.
- Very long timelines (30+ min) → proxy + efficient thumbnail/waveform caching.
- Multi-window / split-screen → responsive, no overflow.
- First launch on low storage → guide user to free space before downloading optional models.

---

## Part 4: Asset Bundling, Free Online APIs, Testing, Phases, Localization, Privacy & Final Acceptance

### 4.1 Asset Bundling Strategy

Ship as much as possible inside the APK/AAB so core features work immediately offline. Large size is explicitly accepted. Use Android App Bundle + Play Asset Delivery (or equivalent for sideload) where helpful, but prefer a complete experience on first launch.

**Must Bundle (Install-Time)** — Quantized Whisper models: Tiny (primary) + Base (Q4_K_M / Q5_K_M preferred). Small as optional fast-follow or larger variant. Comprehensive free font pack. Core transitions library (50–100+). Core effects pack with performance tags. Basic royalty-free music + SFX pack (30–60 short tracks + impacts). Cinematic LUT pack (.cube). Stickers, shapes, lower-third templates, basic text animation presets. UI icons, illustrations for empty states, onboarding. FFmpeg binaries (arm64-v8a primary; armeabi-v7a if supporting older devices). Default project templates.

**Optional / On-Demand** — Larger Whisper models. Expanded music/SFX and effects packs. Extra high-quality fonts or specialty assets.

**Implementation Notes** — Place large models and media in `assets/` or use Play Asset Delivery install-time packs. Compress where possible (WebP for images, optimized audio). Provide clear Settings → Storage screen showing size of each pack + "Clear cache / Remove optional assets". On first launch, show a short, non-blocking progress if extracting models, with "Works offline" messaging.

### 4.2 Free Online API Integrations (Stock Media Only)

Only free tiers with obtainable API keys. All online features are optional and never block core editing.

**1. Pexels API** — Base: `https://api.pexels.com/v1/`. Videos: `GET /videos/search` (query, orientation, size, page, per_page ≤ 80). Also curated and popular endpoints. Auth: `Authorization: YOUR_API_KEY` header. Default limits: 200 requests/hour, 20,000/month. **Attribution (mandatory):** prominent "Photos/Videos provided by Pexels" link or logo + credit photographer when possible. Cache responses aggressively (24 h). Download selected media to local project cache so it becomes offline.

**2. Pixabay API** — Videos: `GET https://pixabay.com/api/videos/`. Parameters: key, q, lang, category, video_type, min_width/height, etc. Free key from account; ~100 requests per 60 seconds typical. License is very permissive (often no attribution required, but still show "Powered by Pixabay"). Same local caching + download-to-project behavior.

**3. Coverr API** — Base: `https://api.coverr.co`. Key endpoints: `/videos`, `/videos?query=...`, `/videos/:id`, categories. Auth: `api_key` query param or `Authorization: Bearer KEY`. Free/Demo tier: 50 requests/hour. **Attribution:** show Coverr logo (white/dark versions provided) and make it clickable as required. Same offline caching strategy.

**UI/UX for Stock** — Dedicated "Stock" tab in media library. Search, filters (orientation, duration range, vertical/horizontal), preview with mute toggle. Clear "Download to Project (becomes offline)" button. Offline state: "Stock library requires internet. All your local media and editing tools still work." Rate-limit handling: friendly message + retry / cached results. Never hotlink in final export; always use local copies.

**Security** — Store API keys securely (BuildConfig, encrypted prefs, or remote config if needed). Never hardcode in public source.

### 4.3 Testing Matrix

**Devices** — Low: 2–3 GB RAM, older SoCs. Medium: 4–6 GB. High: 8 GB+ flagships, foldables, tablets. Orientations: portrait, landscape, multi-window, fold postures. Font scales: 0.85–2.0. Dark / Light theme. RTL languages.

**Functional** — Every tool listed in Parts 1–3 with acceptance criteria. Full offline workflow (import → edit → keyframe → color → audio → Whisper captions → export). Online stock search → download → use offline. Proxy generation and quality switch. Long projects (10–30+ min), many tracks, heavy effects. Crash recovery, auto-save, project package export/import. Export presets accuracy. Whisper accuracy on clear speech + edge cases.

**UI/Overflow** — No element ever clipped or pushed off-screen. All tooltips, labels, and `contentDescription`s present and accurate. Touch targets ≥ 48 dp. Smooth 60 fps scrubbing on Medium+ with proxies.

**Performance / Stability** — Memory leaks (LeakCanary). Thermal behavior. Battery impact of background export and Whisper. Low-spec warning dialogs trigger correctly and offer safer paths.

**Accessibility** — Full TalkBack navigation and announcements. Sufficient contrast. Scalable text.

### 4.4 Development Phases & Prioritization

- **Phase 1 – Foundation (MVP Core):** Project model, Media3 preview + basic timeline, import, trim/split/delete, multi-track basics, simple export, clean Compose UI shell with zero-overflow layout system, auto-save.
- **Phase 2 – Professional Editing:** Keyframes, transform tools, basic effects/transitions, color basic + advanced, audio mixer + keyframes, text, masks, chroma key, stabilization, proxies, low-spec detection.
- **Phase 3 – Captions & Polish:** Whisper integration (Tiny/Base), caption styling & editing, scopes, adjustment layers, templates, stock API integration, full export presets, project packages.
- **Phase 4 – Hardening & Delight:** Performance tuning across device classes, comprehensive error recovery, accessibility audit, localization strings, onboarding, Settings storage management, final asset polish, extensive testing.

Prioritize offline reliability and UI correctness over adding more effects.

### 4.5 Localization Readiness

All user-facing strings in `strings.xml` (or Compose resources) with clear keys. Support RTL from day one (`layoutDirection` aware). Whisper language selection includes major languages; UI language independent. Date/time, number formatting via Android APIs. Prepare for at least English + 5–10 high-priority languages in initial release.

### 4.6 Privacy & Legal Notes

Fully offline processing for editing and Whisper (audio never leaves device). Stock downloads are user-initiated. No analytics that identify users for ads (app is ad-free). Optional anonymous crash reporting only if user consents. Clear in-app privacy statement: "Your videos and audio stay on your device. We do not upload your media." Comply with Pexels, Pixabay, Coverr terms (attribution, no resale of unaltered stock, no AI training on their content). Open-source licenses (FFmpeg, whisper.cpp, fonts, etc.) properly attributed in Settings → Licenses. No accounts required.

### 4.7 Final Acceptance Checklist (Definition of Done)

- [ ] App name "ApexEdits", free, no ads, no watermarks, no paywalls.
- [ ] 100% Kotlin + Jetpack Compose + Media3 + FFmpeg + whisper.cpp.
- [ ] Zero UI overflow on all tested devices, orientations, font scales.
- [ ] Every interactive element has self-explanatory label or long-press tooltip + complete `contentDescription`.
- [ ] Core editing, keyframes, color, audio, effects, masks, chroma, text, export fully offline.
- [ ] Whisper auto-captions work offline with bundled models + clear low-spec handling.
- [ ] Stock via Pexels + Pixabay + Coverr with correct attribution and local caching.
- [ ] Intelligent low-spec detection + warning dialogs before risky operations.
- [ ] Smooth performance with proxies on low/mid devices.
- [ ] Crash recovery, deep undo, project packages.
- [ ] Accessibility (TalkBack, contrast, scaling) passes.
- [ ] All acceptance criteria from Parts 1–3 verified.
- [ ] Feels like a polished human-designed professional tool, not AI-generated clutter.

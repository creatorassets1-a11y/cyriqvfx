# Product Requirements Document (PRD)
## Ultimate Mobile Video Editor
**Codename:** ApexEdit (or "the greatest mobile video editor on earth")

**Version:** 1.0  
**Date:** August 6, 2026  
**Author:** Lead Product / UI-UX Designer + Pro Developer  
**Audience:** Engineering, Design, AI (Claude), Stakeholders  
**Status:** Draft for Implementation

---

## 1. Vision & Overview

**Vision Statement**  
Build the single greatest mobile video editing app on Earth — one that combines the power of desktop professional NLEs (LumaFusion / Premiere / Resolve level control) with CapCut-level trend speed and AI magic, while remaining fully usable offline and feeling buttery smooth on a phone.

**Core Philosophy**
- Offline-first: Core editing must work perfectly with zero internet.
- Hybrid AI: On-device models for common tasks + server APIs for premium generative power.
- Touch-native excellence: Every interaction designed for one-handed phone use and large tablets.
- Zero compromise on quality: 4K60 export, frame-accurate editing, professional color & audio tools.
- Creator-centric: From first-time TikToker to professional mobile filmmaker.

**One-sentence product definition**  
A professional-grade, multi-track, AI-augmented video editor for iOS and Android that works completely offline for core editing and only calls servers for advanced AI, collaboration, and cloud features.

---

## 2. Goals & Success Metrics

### Primary Goals
1. Become the #1 rated and most feature-complete mobile video editor within 18 months of launch.
2. Achieve high retention through offline reliability + delightful AI features.
3. Support thousands of concurrent users with cost-efficient hybrid infrastructure.
4. Enable creators to go from raw footage to publish-ready social or cinematic content entirely on mobile.

### Success Metrics (Year 1)
| Metric | Target |
|--------|--------|
| App Store / Play Store rating | ≥ 4.8 |
| Day-1 retention | ≥ 55% |
| Day-7 retention | ≥ 30% |
| % of users who export at least one video | ≥ 70% |
| % of projects completed fully offline | ≥ 60% |
| Average session length | ≥ 12 minutes |
| Crash-free sessions | ≥ 99.5% |
| Time-to-first-export (new user) | < 8 minutes |

---

## 3. Target Users & Personas

### Primary Personas

**1. Social Creator (Maya, 22)**  
- Posts daily TikTok / Reels / Shorts  
- Wants speed, trends, auto-captions, templates, effects  
- Low patience for complex UI  
- Mostly offline editing + occasional AI

**2. Serious Mobile Filmmaker (Alex, 29)**  
- Shoots 4K on phone + external mics  
- Needs multi-track, keyframes, color scopes, proper audio mixing  
- Values offline reliability and professional export quality  
- Occasionally uses AI for cleanup or generative B-roll

**3. Hybrid Creator / Small Business (Jordan, 34)**  
- Makes client videos, YouTube long-form + shorts  
- Needs collaboration, brand kits, cloud projects, consistent looks  
- Mixes offline precision work with online generative features

### Secondary
- Students / educators
- Casual users making family videos
- Agencies testing mobile-first workflows

---

## 4. Core Product Principles (UI/UX + Engineering)

1. **Offline-first, always** — Core timeline, color, audio, text, effects must never require network.
2. **Progressive disclosure** — Simple mode for beginners, full pro tools one tap away.
3. **Touch excellence** — Large hit targets, predictive gestures, haptic feedback, one-handed reachable primary actions.
4. **Immediate feedback** — Real-time preview, no laggy scrubbing, instant keyframe visual response.
5. **Honest AI** — Clearly label online features. Never surprise-upload user media.
6. **Performance obsession** — 60 fps UI on modern devices, graceful degradation on mid-range.
7. **Accessibility first** — VoiceOver / TalkBack, Dynamic Type, high contrast, reduced motion support.

---

## 5. Feature Requirements

### Priority Legend
- **P0** = Must have for MVP / launch
- **P1** = High priority (first 3–6 months)
- **P2** = Nice to have / later

### 5.1 Core Editing & Timeline (All Offline – P0)

- Multi-track timeline (minimum 6 video + 6 audio tracks at launch; expand to 12+)
- Magnetic + free track modes
- Frame-accurate trim, split, ripple, roll, slip, slide
- Precision zoom (up to 30×) with audio scrub
- Unlimited undo/redo + project history snapshots
- Markers, notes, color tags
- Clip linking / grouping
- Speed: constant (0.1×–100×), reverse, freeze frame, optical-flow slow-mo, speed curves with Bézier
- Transform keyframes (position, scale, rotation, opacity) with velocity graphs
- Picture-in-picture, basic split-screen
- Crop, rotate, flip, pan & zoom (Ken Burns)
- Blending modes + opacity
- Shape & freehand masks with feather
- Basic chroma key / green screen
- Local stabilization
- Project aspect ratios: 9:16, 16:9, 1:1, 4:5, 4:3, 2.35:1, custom
- Frame rates: 24 / 25 / 30 / 50 / 60 (and common variants)

### 5.2 Color & Effects (Mostly Offline – P0/P1)

- Full color correction: exposure, contrast, highlights/shadows, temperature, tint, vibrance, curves (RGB + luma), HSL
- Color wheels + scopes (waveform, vectorscope, histogram)
- LUT import (.cube) + library
- Large library of filters, film looks, glitch, grain, light leaks
- Keyframable effects
- Body/face beauty tools with tracking (on-device)

### 5.3 Audio (Offline Core – P0)

- Multi-track audio with independent volume keyframes, fades, ducking
- Waveform display
- Basic EQ + noise reduction (on-device)
- Voiceover recording while timeline plays
- Audio extraction, reverse, pitch
- Beat detection / markers
- Local music + SFX library (downloadable packs)

### 5.4 Text, Captions & Graphics (Hybrid – P0)

- Rich text tool (fonts, size, color, outline, shadow, background, animations + keyframes)
- Auto-captions:
  - On-device basic version (P0)
  - High-accuracy multi-language + translation via API (P0)
- Caption styling templates + word-level animation
- Stickers, shapes, lower thirds
- Brand kit (logo, colors, fonts)

### 5.5 AI Features (Hybrid – Clear Online Indicators)

**On-device (P0/P1)**
- Background / subject removal
- Basic object tracking
- Simple enhancement / denoise
- Basic auto-captions

**Server / API (P0–P2)**
- Premium captions + filler word removal + bilingual
- High-quality TTS + voice cloning
- Text-to-video / Image-to-video / AI avatars
- Advanced object removal + temporal inpainting
- Super-resolution / upscaling
- Style transfer / anime conversion
- AI auto-edit / highlight reel / long-to-short
- Natural language editing commands
- Generative music / SFX

All online AI features must:
- Show clear “Requires internet” state
- Support “Process later” queue
- Upload only necessary media (or proxies)
- Be asynchronous with push notification on completion

### 5.6 Media, Export & Sharing (P0)

- In-app camera (Auto + Pro mode: ISO, shutter, WB, focus)
- Teleprompter
- Import from camera roll, Files, external drives, cloud
- Export up to 4K60 (H.264 / HEVC), bitrate control, HDR support
- Platform presets (TikTok, Reels, Shorts, YouTube, etc.)
- Direct share to major social platforms
- Watermark-free exports (free tier policy to be decided)
- Project package export (for backup or desktop handoff)

### 5.7 Collaboration & Cloud (P1)

- Optional cloud project sync
- Shared spaces + comments
- Brand kits shared across team
- Review links

### 5.8 Templates & Assets (Hybrid)

- Large template library (trending + cinematic)
- Easy media replace
- User can save own templates
- Downloadable asset packs for offline use

---

## 6. Key User Flows

### 6.1 First-Time User → First Export (Happy Path)
1. Open app → Onboarding (3–4 screens max) explaining offline power + optional AI.
2. Create new project → Choose aspect ratio + frame rate.
3. Import or shoot media.
4. Timeline appears with smart suggestions (optional).
5. User trims, adds text/captions, applies look.
6. Export → Choose quality/platform → Done.

### 6.2 Offline Editing Session
- Full timeline work with zero network.
- If user taps online AI feature → polite blocker + “Queue for later”.

### 6.3 Online AI Feature Flow
1. User selects clip + chooses “AI Remove Object” (or similar).
2. App checks connectivity.
3. Shows estimated time + data usage.
4. Uploads proxy or selected region.
5. Job enters queue → progress indicator.
6. Result returns → user reviews and accepts/rejects.
7. Non-destructive (original remains).

### 6.4 Collaboration Flow (P1)
- User enables cloud sync on project.
- Invites collaborator via link/email.
- Real-time or async comments on timeline.
- Version history.

---

## 7. UI / UX Design Guidelines

### Visual Design
- Dark theme primary (cinema feel), optional light mode.
- High contrast, generous spacing on phone, denser on iPad.
- Consistent 8pt grid.
- Accent color: energetic but professional (to be finalized — candidate: vibrant teal or electric blue).
- Typography: SF Pro / Roboto + custom display font for titles.
- Icons: Custom set, highly legible at small sizes.

### Interaction Design
- Bottom toolbar for primary tools on phone (thumb zone).
- Contextual tool panels that slide up.
- Pinch to zoom timeline.
- Long-press for advanced options.
- Double-tap to select + enter transform mode.
- Haptic feedback on key actions (cut, keyframe add, export complete).
- Real-time preview always visible (resizable).

### Layout Principles
- Phone: Vertical timeline at bottom, preview on top.
- iPad / large phones: Optional dual-pane or landscape optimized layout.
- Progressive complexity: “Simple” vs “Pro” mode toggle.

### Accessibility
- Full VoiceOver / TalkBack support.
- Dynamic Type.
- Reduced motion option.
- Color-blind safe scopes and indicators.
- Keyboard support on iPad + external keyboards.

---

## 8. Technical Requirements

### Platforms
- iOS 17+ (iPhone + iPad)
- Android 12+ (phones + tablets)
- Native performance critical (Swift/SwiftUI + Kotlin/Compose or high-performance cross-platform with native modules for media).

### Architecture
- **Offline-first local database** (SQLite / Realm / Core Data) for projects and media references.
- **Media engine**: Hardware-accelerated (AVFoundation / MediaCodec + custom rendering pipeline).
- **On-device ML**: Core ML / NNAPI / MediaPipe for background removal, basic captions, tracking.
- **Backend**: 
  - API layer (auth, projects metadata, job management)
  - Job queue (Redis / SQS)
  - GPU workers for heavy AI (or managed inference APIs: fal.ai, Replicate, etc.)
  - Object storage (S3 / R2) + CDN
  - Postgres for user/project data
- **Hybrid rule**: Never block core editing on network. Online features are progressive enhancement.

### Performance Targets
- 60 fps timeline scrubbing and preview on flagship devices.
- Smooth 4K timeline on devices with sufficient RAM/GPU.
- Proxy generation for heavy media.
- Background rendering / export where possible.
- App launch to timeline < 2.5 seconds (warm).

### Security & Privacy
- Media stays on device by default.
- Explicit user consent before any upload.
- End-to-end encryption for cloud projects (ideal).
- Clear privacy policy and data deletion tools.
- No selling of user footage.

### Scalability (Thousands of Users)
- Auto-scaling API and GPU workers.
- Managed inference APIs initially → self-hosted GPU when volume justifies.
- Aggressive caching of assets.
- Cost controls and usage quotas on generative features.

---

## 9. Monetization (High-Level)

- Free tier: Full offline editing + limited online AI credits + watermark-free basic exports.
- Pro subscription: Unlimited or high AI credits, premium templates/effects, cloud storage, collaboration, priority processing, advanced features.
- Optional credit packs for heavy generative use.
- Transparent pricing. No dark patterns.

---

## 10. Phased Roadmap

### Phase 0 – Foundation (MVP)
- Full offline multi-track editor
- Core color, audio, text, basic effects
- On-device background removal + basic captions
- 4K export
- Basic templates
- Clean, excellent UI

### Phase 1 – Intelligence & Polish
- Premium online AI suite
- Advanced keyframing & speed curves
- Brand kits
- Improved templates & asset store
- Performance optimizations

### Phase 2 – Collaboration & Scale
- Cloud sync + collaboration
- Multicam
- Advanced scopes & professional color tools
- Desktop project interchange
- Team features

### Phase 3 – Generative Future
- Full text-to-video / agentic editing
- Deeper generative integration
- Advanced marketplace

---

## 11. Open Questions & Risks

- Exact free vs paid feature split
- Preferred AI model providers and cost model
- Cross-platform tech stack decision (native vs Flutter/React Native + heavy native modules)
- How aggressive to be with on-device model size vs quality trade-offs
- Legal / copyright handling for music & generative content
- App Store review risk around generative AI features

---

## 12. Appendix – Reference Inspiration

- CapCut (trends, AI, templates, captions)
- VN (free multi-track, keyframes, no watermark)
- LumaFusion (pro timeline, color, audio)
- PowerDirector (AI generation speed)
- Adobe Premiere mobile / Final Cut for iPad (ecosystem polish)
- DaVinci Resolve for iPad (color)

---

**This PRD is designed to be directly usable by Claude or any engineering/design team.**  
It prioritizes clarity, offline-first principles, hybrid AI architecture, and professional mobile UX.

Next recommended steps:
1. Review & prioritize P0 features for MVP scope.
2. Create detailed user flow diagrams and wireframes.
3. Decide tech stack and AI provider strategy.
4. Begin technical spike on media engine + on-device ML.

End of PRD.
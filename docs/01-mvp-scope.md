# MVP scope

**Status:** Decided · **Date:** 2026-08-06 · **Supersedes:** PRD §5 priority legend

This resolves the PRD's first next step — "review & prioritise P0 features for MVP
scope."

## The commitment: nothing is dropped

**Every feature in the PRD ships.** This document decides *when*, not *whether*.
There is no feature in PRD §5 that has been removed from the plan, and
[`05-feature-coverage.md`](05-feature-coverage.md) tracks all of them
individually so that claim is verifiable rather than asserted.

The only real constraint is sequencing. The PRD's P0 list taken literally is
roughly eighteen months of work, including several items whose cost is dominated
by one hard problem each (optical flow, HDR colour management, scopes). Shipping
them simultaneously is a calendar impossibility, not a scope disagreement — so
what follows is the order, with the reasoning for each placement, so any of it
can be re-sequenced when circumstances change.

Where a feature is scheduled after launch, the engine still carries its data
model wherever that is cheap to do now and expensive to retrofit later. The
colour wheels, HSL qualifier, LUTs, HDR colour space, optical-flow flag and all
22 AI capabilities are already in the model today — the later work is renderer
and UI, not redesign.

## The rule used to order the work

A feature is in the *first release* if **its absence would make a target persona
abandon the app**, not merely complain about it. Everything else ships in a
later phase — later, not never.

Applied to the PRD's three personas:

- **Maya (social creator)** abandons over: slow export, no captions, no music,
  watermarks, crashes. Does *not* abandon over: missing scopes, missing
  keyframe velocity graphs, 12 tracks instead of 6.
- **Alex (mobile filmmaker)** abandons over: imprecise trimming, no multi-track,
  audio drift, quality loss on export. Does *not* abandon over: missing
  generative AI, missing collaboration.
- **Jordan (hybrid/business)** abandons over: no brand consistency, no way to
  hand off to a desktop. Tolerates manual workarounds for a release or two.

The union of the "abandons over" column is the first release. Everything else
in the PRD follows behind it, and every deferral below names which persona was
checked.

## In the first release

### Timeline and editing — the whole thing, no deferrals

The PRD is right that this is non-negotiable. A video editor with a mediocre
timeline has no reason to exist, and the timeline is also the part that is
hardest to retrofit — every later feature assumes its data model.

- 6 video + 6 audio tracks at launch, raised to 12+ in Phase 1 (the engine has
  no track-count assumption; `createDocument` already takes the counts)
- Frame-accurate trim, split, ripple, roll, slip, slide
- Magnetic and free track modes
- Precision zoom to 30×
- Unlimited undo/redo, project snapshots
- Markers, notes, colour tags, clip linking
- Constant speed 0.1×–100×, reverse, freeze frame, **and speed curves**
- Transform keyframes with Bézier easing
- Crop, rotate, flip, Ken Burns, PiP, blending modes, opacity
- Shape masks with feather, basic chroma key
- All standard aspect ratios and frame rates including the NTSC /1001 rates

Speed curves were pulled *forward* from the PRD's own P1 placement. The reason is
structural rather than about user demand: retiming touches the source-time
mapping that every other subsystem consumes, and bolting a curve onto a
timeline that assumed a scalar rate means revisiting trim, split, audio and
render together. It is much cheaper now than later. It is already implemented
and tested in `packages/edit-engine/src/speed/speed.ts`.

### Colour

- Full primary correction: exposure, contrast, highlights/shadows, whites/blacks,
  temperature, tint, saturation, vibrance
- Tone curves (luma + RGB), monotone-interpolated so they cannot band
- LUT import (.cube)
- Filters and film looks built on the same grade struct
- Keyframable in Pro mode

### Audio

- Multi-track with volume envelopes, fades, ducking
- Waveform display
- On-device noise reduction and 3-band EQ
- Voiceover recording against playback
- Extraction, reverse, pitch, beat detection
- Bundled music and SFX pack, downloadable extras

### Text and captions

- Rich text with animation and keyframes
- On-device auto-captions with word-level timing
- Caption style presets with word-level animation
- Brand kit: logo, colours, fonts

### AI

- On-device only: background removal, object tracking, enhancement, captions
- The **full job-queue infrastructure**, including consent, offline queueing and
  the credits model, even though only on-device capabilities ship

Shipping the queue without the server capabilities looks like waste and is not.
The queue is where the privacy guarantee lives — consent is a state transition
that server work cannot bypass. Building that after a dozen features already
call an upload helper is how apps end up with a privacy policy that does not
match the code. It is implemented in `packages/edit-engine/src/ai/jobs.ts` and
costs almost nothing to carry.

### Media and export

- In-app camera, auto and pro modes
- Import from camera roll, Files, cloud providers
- Proxy generation
- Export to 4K60, H.264 and HEVC, bitrate control
- Platform presets and direct share
- Watermark-free on the free tier (see below)
- Project package export for backup and desktop handoff

## Scheduled after the first release, with reasons

None of these is removed from the product. Each row says which release it lands
in and why it is not in the first one.

| Feature | Ships in | Why not first |
|---|---|---|
| Tracks beyond 6+6 | Phase 1 | Pure data change, no engine assumptions. Nobody abandons over it; ~2% of projects in comparable apps exceed six video tracks. |
| Optical-flow slow motion | Phase 1 | Frame blending covers the common case. Good optical flow is a multi-month problem on mobile silicon and a bad one looks worse than no interpolation. The model already carries the flag. |
| Scopes (waveform, vectorscope, histogram) | Phase 2 | Alex wants them; Alex does not leave without them, because no mobile competitor has good ones either. They also want screen area we do not have until the tablet layout matures. |
| Colour wheels (lift/gamma/gain) | Phase 1 | Sliders cover 90% of grading intent. The wheels need a bespoke touch control that is genuinely hard to make precise with a thumb. Model support is already there. |
| HSL qualifier | Phase 1 | Same reasoning; model support already there. |
| HDR export | Phase 2 | Correct HDR means colour management end to end, not an encoder flag. Shipping it half-right produces washed-out footage users blame us for. Better to have no HDR than wrong HDR. |
| All server-side AI | Phase 1 | This is the largest single deferral. See below. |
| Collaboration and cloud sync | Phase 2 | Per the PRD. Jordan tolerates AirDrop and project packages for two releases. |
| Multicam | Phase 2 | Per the PRD. |
| Templates marketplace | Phase 1 | MVP ships a curated built-in set. A marketplace needs creator payouts, moderation and licensing — a business, not a feature. |
| Body/face beauty tools | Phase 1 | Needs on-device face tracking we are not shipping at MVP; also the feature most likely to draw criticism, so it deserves deliberate design rather than a launch-rush version. |

### On scheduling server-side AI after launch

This is the biggest departure from the PRD, which places premium captions, TTS
and object removal at P0.

The argument for holding it back: every server capability adds inference cost per use,
a provider dependency, an abuse surface, an App Store review risk that the PRD
itself flags as an open question (§11), and a support burden — and none of them
is why someone picks a video editor. Users pick an editor because the timeline
feels good and the export works. Launching with excellent on-device basics and
zero server cost also means our unit economics at launch are *known*, which
matters when the PRD targets "thousands of concurrent users" on a hybrid
infrastructure whose cost model is explicitly an open question.

The argument against, which is real: CapCut has trained creators to expect
one-tap AI, and "no AI" reads as dated in 2026.

The resolution is the compromise the queue makes possible: **ship the AI surface
at launch with on-device capabilities live and server capabilities visible but
marked "Coming soon"**, rather than hiding the section. Users see the roadmap in
the product, we learn which capabilities they tap before we pay for any
inference, and the tap-through data prices Phase 1 for us. This is only
workable because the queue is built — the capabilities can be enabled
server-side without an app update.

## Deferred decisions this document does *not* resolve

Two of the PRD's open questions are deliberately left open, because deciding them
now would be guessing. Neither removes a feature:

- **Free versus paid split.** The MVP ships watermark-free exports on the free
  tier, which is a decision. The rest of the split depends on Phase 1 AI costs
  that do not exist yet. Revisit when server capabilities are priced.
- **Music licensing.** The MVP ships a small owned or perpetually-licensed pack
  rather than a catalogue deal. This avoids the licensing question entirely for
  one release and is reversible.

## What "done" means for the MVP

The success metrics in PRD §2 are outcomes, not exit criteria. These are the
exit criteria:

1. Time-to-first-export under 8 minutes for a new user in unmoderated testing
   (this is the one PRD metric that is directly testable pre-launch).
2. Zero-network editing session of 30 minutes with no functionality unavailable
   except capabilities explicitly marked online.
3. Frame-accurate round trip: import → cut → export → re-import lands cuts on
   the same frames.
4. Crash-free session rate ≥ 99.5% across the device matrix.
5. 60 fps timeline scrubbing on the flagship tier; no worse than 30 fps and
   never unresponsive on the minimum-spec tier.

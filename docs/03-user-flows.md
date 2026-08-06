# User flows

The PRD's second next step: detailed flows. These expand PRD §6 with the
decision points and failure paths, which is where flows actually earn their
keep — the happy path is rarely what needs designing.

Notation: `→` a step, `?` a branch, `!` a failure path.

## 1. First run to first export

Target: under 8 minutes (PRD §2). The clock starts at first launch, not at first
edit, so onboarding is inside the budget — which is the main argument for
keeping it to three screens.

```
Launch
  → Onboarding, 3 screens, skippable from screen 1
      1. "Everything here works offline."
      2. "Your media stays on your device."   ← sets the expectation the
                                                consent sheet later honours
      3. "Some AI needs the internet. You'll always be asked first."
  → Permissions, requested in context, never up front
      ? Photo library      — asked when the user taps Import
      ? Camera + mic       — asked when the user taps Record
      ! Denied → the other path stays fully available; never a dead end
  → New project
      ? Aspect ratio  (9:16 default — the majority case, and changeable later
                       without re-editing since transforms are normalised)
      ? Frame rate    (inferred from the first imported clip; only surfaced
                       when the import disagrees with the project)
  → Import or shoot
      → Proxy generation starts in the background, non-blocking
  → Timeline
      → Optional smart suggestions (silence removal, beat markers) as
        dismissible chips, never auto-applied
  → Edit: trim, captions, a look
  → Export
      ? Platform preset
      → Pre-flight summary: resolution, duration, estimated size, warnings
      → Render with progress; app may be backgrounded
      → Share sheet
```

**Where this flow usually fails, and the mitigation**

| Failure | Mitigation |
|---|---|
| User abandons during onboarding | Skippable from screen 1; nothing in it is required to use the app |
| Permission denied, user stuck | Both import paths independent; denial degrades, never blocks |
| Import of a long 4K clip stalls the UI | Import is immediate at low res; proxy generation is background and the timeline is usable throughout |
| Frame-rate mismatch confusion | Project rate inferred from first import; conversion is silent and frame-accurate |
| Export fails at 90% | Progress is per-frame and resumable; partial output is never presented as success |

## 2. An offline editing session

The flow the PRD's core philosophy is really about. The design rule: **offline is
not a mode.** Nothing detects the network and changes behaviour; capabilities
that need it are marked as such at all times, online or not.

```
Airplane mode
  → Every timeline, colour, audio, text and effect operation: unchanged
  → On-device AI (background removal, captions, tracking): unchanged
  → Tap an online capability
      → Sheet: what it does, what it would upload, cost, estimated time
      → Primary action: "Queue for later"    ← not an error, not a paywall
      → Job enters the queue in `awaiting-consent`
  → Queue shows "Waiting for a connection" per job
  → Connection returns
      → Consented jobs start automatically
      → Notification when results are ready
      → Results are reviewed and accepted or discarded; originals untouched
```

The reason "Queue for later" is the primary action rather than a fallback: an
offline-first product that treats offline as a failure state is offline-tolerant,
not offline-first. `blockedReason()` in the engine returns "Waiting for a
connection" as a status, in the same shape as "Waiting for another job to
finish."

## 3. An online AI capability, end to end

```
Select clips → choose capability
  → Engine enqueues in `awaiting-consent`         (cannot start; no upload possible)
  → Consent sheet
      · exactly what leaves the device, in plain words
      · credit cost and estimated time
      · "your original stays here; the result comes back separately"
      ? Cancel  → job cancelled, nothing sent
      ? Approve → consent recorded verbatim, job → `queued`
  → Gates checked in order: consent → connectivity → credits → concurrency
      ! any gate unmet → job waits, and says which gate
  → Upload (proxy / region / audio / text — per the capability's tier)
  → Processing, with progress
      ! transient failure → retry with exponential backoff, up to 3 attempts
      ! permanent failure → job fails, no credits charged
  → Ready → user reviews
      ? Accept  → applied as a new version alongside the original
      ? Discard → original untouched, credits already spent are not refunded
                  (and the user was told the cost before approving)
```

Credits are deducted on **completion**, not submission, so a failure costs
nothing. That is enforced in `completeJob`, not left to backend etiquette.

## 4. Precision trim

Worth writing out because it is the interaction that separates a real editor
from a toy, and it is entirely about gesture disambiguation.

```
Tap clip                    → select, show trim handles
Drag clip body              → move
    ? magnetic track        → neighbours make room (ripple)
    ? free track            → overwrite what it lands on
    ? drag vertically > ½ row → retarget track (video↔video, audio↔audio only)
Drag handle                 → trim
    ? Ripple mode on        → everything after moves with the edit
    ? Ripple mode off       → clamps at the neighbour
Pinch                       → zoom, up to 30×
Long-press handle           → roll / slip / slide menu (Pro mode)
```

Throughout:

- Snapping to cuts, markers and the playhead within 12px, with a haptic tick.
- The whole drag is **one** undo entry, via gesture coalescing.
- Trims clamp at the media's limits — you cannot trim into footage that does not
  exist, and the handle simply stops.
- Frame snapping is applied to every result, so no edit can land off-frame.

## 5. Captions

```
Tap Captions
  → On-device transcription (works offline, no upload)
  → Word-level timings produced, not just cue-level
  → Cues grouped by style: sentence ends and pauses break early, so a cue
    never straddles a natural break
  → Review
      · low-confidence words highlighted for correction
      · filler words flagged; "remove all" ripples both audio and captions
      · editing a cue's text redistributes its word timings proportionally
  → Style: changing preset re-flows cues and loses no words
  ? Translate / higher accuracy → online capability, consent flow (§3)
```

Word-level timing is load-bearing rather than a flourish: caption animation,
filler-word removal and edit-by-transcript all need to know where individual
words sit, and retrofitting it onto cue-level timings is not possible.

## 6. Collaboration (Phase 2)

```
Enable cloud sync on a project
  → Explicit consent: this uploads the project and its media
  → Invite by link or email
  → Async comments anchored to timeline positions
  → Version history with named snapshots
  ! Conflict → last-writer-wins per clip, with both versions kept in history
```

Deliberately async rather than real-time co-editing. Real-time on a
frame-accurate multi-track document is a research problem (operational transform
over an immutable document with a maintained index), and the actual use case
Jordan describes is review-and-comment, not simultaneous editing.

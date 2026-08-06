# ADR 0002 — AI provider and cost strategy

**Status:** Accepted · **Date:** 2026-08-06
**Resolves:** PRD §11, "Preferred AI model providers and cost model" and "how aggressive to be with on-device model size vs quality trade-offs"

## Context

The PRD's hybrid rule is that core editing never blocks on network and online AI
is progressive enhancement. That settles the architecture. It does not settle
who runs the models, what they cost, or where the on-device/server line falls.

Three constraints shape the answer:

- Generative inference is the only per-use variable cost in the product. Every
  other feature is amortised engineering. Get this wrong and the free tier is a
  liability that scales with success.
- The PRD promises "media stays on device by default" and "never surprise-upload
  user media." That is a hard constraint on which capabilities *may* be
  server-side at all, independent of cost.
- Model quality in this category moves faster than release cycles. Any provider
  choice made today is wrong within two quarters.

## Decision

### 1. The on-device/server line is drawn by privacy sensitivity first, capability second

Not by what is technically possible. A capability runs on-device if it can, and
runs on-device even at some quality cost when the alternative means uploading
raw footage.

| On-device, always | Rationale |
|---|---|
| Background/subject removal | Applies to footage of people, often in private settings. Highest sensitivity in the product. On-device quality is good enough. |
| Object tracking | Needs to be interactive; a round trip is not just private-data risk but bad UX. |
| Denoise / enhance | Applies to every frame. Uploading whole clips for this is indefensible. |
| Basic captions | Audio of the user's own voice. Modern on-device ASR is strong. |
| Beat detection | Cheap, and there is no quality argument for a server. |

Server capabilities are then constrained by **what they may upload**, encoded in
the engine as the `uploads` field on each capability
(`packages/edit-engine/src/ai/jobs.ts`):

- `text-only` — translation, TTS, generative music/SFX, natural-language edits.
  No media leaves the device. Preferred wherever a capability can be expressed
  this way.
- `audio-only` — premium captions, filler-word removal. No video leaves.
- `region` — object removal. Only the marked frames and region.
- `proxy` — style transfer, auto-edit, long-to-short. Low-resolution copy; the
  original never leaves.
- `original` — upscaling, image-to-video. The only tier that sends full-quality
  media, and deliberately the smallest.

This ordering is a design rule, not a taxonomy: when a capability could be built
either way, build the version that sits higher in the list, even if it is
slightly worse.

### 2. Managed inference at launch, self-hosted only when arithmetic forces it

Start on managed APIs (fal.ai and Replicate for generative video and image work,
a dedicated ASR provider for premium captions, a dedicated TTS provider for
voice). Do not build GPU infrastructure.

The break-even is straightforward: managed inference costs roughly 2–4× the raw
GPU cost of the same work, but self-hosting adds an SRE burden, idle capacity
during off-peak, and a model-update treadmill. Self-hosting is correct when
sustained utilisation would exceed roughly 40% of a reserved GPU fleet — below
that, reserved capacity idles and managed wins on cost as well as effort.

For the PRD's "thousands of concurrent users," managed is correct. Revisit at
sustained six-figure monthly inference spend, and revisit per capability rather
than wholesale: the first capability to justify self-hosting will be whichever
becomes routine, most likely captions.

### 3. Providers are behind a capability interface, and always at least two deep

No provider name appears above the job layer. The app requests a *capability*;
a server-side registry maps capability → provider → model version.

This is not architectural fastidiousness. It is the direct consequence of models
improving faster than we ship: swapping the model behind "Remove Object" must be
a config change, not a release. It also means a provider outage degrades one
capability instead of the AI surface, and pricing renegotiation has a credible
alternative behind it.

Every capability that reaches general availability must have a second provider
qualified before launch, even if unused.

### 4. Credits price the user's cost, not ours

Credits are denominated so that one credit ≈ one unit of the cheapest meaningful
operation, and each capability's `creditsPerUnit`
(`packages/edit-engine/src/ai/jobs.ts`) is set from *relative* compute cost, not
from a margin target. Generative video costs 30 credits per second and captions
cost 1 per minute because that is roughly their cost ratio.

Two rules follow:

- **Estimates before commitment, always.** The consent sheet shows credits and
  estimated time before a job can start. A user should never be surprised by a
  balance.
- **Credits are deducted on completion, not on submission.** A failed job costs
  the user nothing. This is implemented in `completeJob`, not left to the
  backend's good behaviour.

### 5. On-device model size: budget by user-visible cost, not by megabytes

The PRD asks how aggressive to be on model size versus quality. Size is the
wrong unit — users do not experience megabytes, they experience download time,
storage pressure and battery drain.

The budget:

- **Bundled with the app: under 50 MB total.** Only captions and background
  removal, at their smallest usable quality. The app must be usable offline
  straight from the store.
- **Downloaded on first use: up to 200 MB per model.** Higher-quality variants,
  fetched when the user first invokes the feature, with an explicit prompt on
  cellular.
- **Battery is the real ceiling.** Any on-device model that cannot process one
  minute of 1080p in under 30 seconds on the minimum-spec device does not ship
  on-device, regardless of quality. This is why background removal exposes a
  fast/balanced/precise choice rather than one setting.

## Consequences

**Good**

- Launch has zero variable inference cost, which makes free-tier economics known
  rather than modelled (see `docs/01-mvp-scope.md` on cutting server AI from MVP).
- The privacy promise is enforced by structure — consent is a state transition,
  and the upload tier is data on the capability, not a convention.
- Provider churn is absorbed without app releases.

**Costs**

- Managed inference has a worse per-unit cost than self-hosting at scale; we are
  buying optionality with margin, and should expect to give some of it back.
- The capability abstraction is real work that buys nothing on day one.
- Insisting on on-device for the sensitive capabilities means shipping
  measurably worse background removal than a server-side competitor. This is a
  deliberate trade and should be defended as one, not quietly reversed.

## Open, deliberately

- **Music and generative-content licensing** (PRD §11). Not resolvable by
  architecture. The MVP avoids it by shipping an owned pack.
- **App Store review risk on generative features** (PRD §11). Mitigated by
  launching without server generation, which gives us a shipped, reviewed app
  before the risky surface is enabled.

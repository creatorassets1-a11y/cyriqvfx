# UI specification

Resolves the PRD's undecided visual details and specifies the layout precisely
enough to build against. The reference implementation of everything here is in
`apps/prototype`.

## Accent colour: vibrant teal `#22E3C3`

The PRD leaves this open between "vibrant teal or electric blue." Teal, for
three reasons:

1. **Blue collides.** At the surface luminance a cinema-dark UI needs, an
   electric blue sits close to the system blue both platforms already use for
   links, selection and focus. An accent that reads as "system control" is a
   weak accent.
2. **It stays distinct from the semantic colours.** Record red `#FF3B46`, warning
   amber `#FFB443` and the online-feature blue `#6BA7FF` all need to be
   instantly separable from "this is interactive." Teal is far from all three;
   blue is not far from the last one.
3. **It survives on video.** The accent is frequently adjacent to arbitrary
   footage. Teal holds its identity against the widest range of frame content,
   where blue disappears against sky and water — a large fraction of what people
   shoot.

Against `--bg-panel` `#0F1319` this passes WCAG AA for large text and UI
components. It is never used for body text.

## Tokens

Full set in `apps/prototype/src/styles/tokens.css`. The load-bearing ones:

```
Surfaces   base #07090D · panel #0F1319 · raised #161B23 · hover #1E2530
Text       primary #EEF2F7 · secondary #9AA7B8 · tertiary #6B7889
Accent     #22E3C3, on-accent #04231F
Semantic   danger #FF5A5F · warning #FFB443 · record #FF3B46 · online #6BA7FF
Spacing    4 · 8 · 12 · 16 · 24 · 32 · 48        (8pt grid, per PRD §7)
Radii      6 · 10 · 16 · full
Touch      44px minimum · 48px for primary timeline actions
Motion     120ms fast · 220ms normal · cubic-bezier(0.32, 0.72, 0, 1)
```

Light mode inverts surfaces and darkens the accent to `#06A68C` so it still
passes contrast on a light panel.

## Layout

### Phone (portrait, default)

```
┌─────────────────────────────────┐
│ ↺ ↻      00:00:04:12   Save Pro │  topbar, safe-area padded
├─────────────────────────────────┤
│                                 │
│          preview                │  fills available height,
│      (letterboxed to            │  letterboxes to project aspect
│       project aspect)           │
│                                 │
│   ⏮  ◀  ( ▶ )  ▶  ⏭            │  transport, 48px primary
├─────────────────────────────────┤
│ Snap  Ripple        −[====]+    │  timeline toolbar
│ 0:00    0:02    0:04    0:06    │  ruler
│ ┃ ▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓               │  V2
│ ┃ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓           │  V1
│ ┃ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒                │  A1
├─────────────────────────────────┤
│ ＋  ✂  🗑  ⤢  ⏱  ◑  ♪  ✦  T  ✨ ↥│  toolbar, thumb zone, scrolls
└─────────────────────────────────┘
```

Proportions: timeline capped at 42dvh so the preview always dominates. Toolbar
scrolls horizontally rather than wrapping — a wrapping toolbar changes height as
the app changes, which moves everything else.

### Tablet / landscape (≥900px)

Preview and inspector side by side; timeline full width beneath. The inspector
becomes a persistent pane rather than a sheet, because at this size covering the
timeline to change a value is a regression.

```
┌──────────────────────────┬────────────────┐
│ topbar                                    │
├──────────────────────────┼────────────────┤
│  preview                 │  inspector     │
│  transport               │  (persistent)  │
├──────────────────────────┴────────────────┤
│  timeline, full width                     │
├───────────────────────────────────────────┤
│  toolbar, centred                         │
└───────────────────────────────────────────┘
```

Two CSS details that are not optional, both of which broke the layout during
implementation and are commented in the stylesheet:

- The app grid uses `minmax(0, 1fr)` for both its column and its flexible row.
  A bare `1fr` track still has a min-content floor, so the timeline's wide
  scrolling canvas stretches the whole app past the viewport, and a long
  inspector pushes the timeline off the bottom.
- The preview is a fixed stage with the canvas letterboxing inside it via
  `object-fit`. Sizing the wrapper to the canvas makes the canvas's own
  `max-width` resolve against a content-sized parent — circular, and it blows
  out to the project resolution.

## Interaction

| Gesture | Result |
|---|---|
| Tap clip | Select |
| Drag clip body | Move; vertical past ½ row retargets track |
| Drag clip edge | Trim |
| Drag ruler or empty track | Scrub |
| Tap ruler or empty track | Move playhead there immediately |
| Pinch | Zoom timeline, to 30× |
| Long-press clip | Context menu: roll, slip, slide, speed, detach audio |
| Double-tap value label | Reset to default |

The ruler is 26px tall. Making it the only scrub surface leaves the playhead
effectively unreachable on a phone, so **empty track area scrubs too** — clips
handle their own pointer events, so only presses landing on the lane background
reach it.

**Haptics** on cut, keyframe added, snap engaged, and export complete (PRD §7).
Three intents — light, medium, success — mapped to each platform's haptic
engine.

## Progressive disclosure: Simple and Pro

The PRD's "simple mode for beginners, full pro tools one tap away." The
distinction is **not** which features exist — it is whether a control writes a
constant or a keyframe.

| | Simple | Pro |
|---|---|---|
| Transform, colour, audio sliders | write a constant value | write a keyframe at the playhead |
| Colour controls shown | 6 primary | all 10 + look controls |
| Effects offered | low and medium cost | all, including heavy |
| Pitch, frame blending, roll/slip/slide | hidden | shown |

The mode toggle is in the topbar, persistent and one tap. A beginner never
encounters a keyframe by accident; an expert never has to hunt for one.

## Accessibility

Not a checklist item — several of these changed the visual design.

- **Every control has an accessible name**, including timeline clips
  ("Color on V1, 3 seconds") and trim handles ("Trim start of …").
- **Dynamic Type** throughout. The toolbar scrolls rather than wraps
  specifically so larger type does not reflow the whole layout.
- **Reduced motion** honoured globally via `prefers-reduced-motion`; sheet
  animations and transitions collapse to zero duration.
- **Colour is never the only signal.** Locked tracks get a diagonal hatch as
  well as a colour change; modified sliders get a filled value chip as well as
  an accent colour; the clip-tag palette is chosen to differ in luminance as
  well as hue.
- **High contrast** via `prefers-contrast: more`, which lightens borders and
  secondary text.
- **Keyboard** support on tablets: space to play, arrows to step (shift for 10
  frames), `S` to split, delete to remove, ⌘Z / ⌘⇧Z, Home/End.
- **Focus is always visible** — 2px accent outline with offset, never removed.

## Copy

Three rules, applied throughout:

1. **Name the thing that happens, not the feature.** "Only the audio of the
   selected clips is uploaded" beats "Cloud-powered transcription."
2. **Waiting is a status, not an error.** "Waiting for a connection" — no
   warning colour, no exclamation mark.
3. **Never imply loss.** "The result comes back as a separate version you can
   accept or discard — nothing is overwritten."

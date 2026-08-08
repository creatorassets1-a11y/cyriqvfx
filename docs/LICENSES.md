# Licences and attribution

ApexEdits itself is MIT (see `LICENSE`). This file is the source for the
Settings → Licences screen required by PRD §4.6.

## Currently shipping

| Component | Licence |
|---|---|
| Kotlin, Kotlin stdlib, coroutines, kotlinx.serialization | Apache 2.0 |
| Jetpack Compose, Material 3, Material Icons | Apache 2.0 |
| AndroidX Media3 (ExoPlayer, Transformer, Effect, UI Compose) | Apache 2.0 |
| AndroidX Room, DataStore, WorkManager, Lifecycle, Navigation, Core | Apache 2.0 |
| JUnit 4 | Eclipse Public License 1.0 |

## Arriving in later phases

| Component | Licence | Notes |
|---|---|---|
| FFmpeg via `com.antonkarpenko:ffmpeg-kit-full` | **LGPL 2.1+** | The LGPL build, deliberately not `-gpl`. See ADR 0002. Dynamic linking; full licence text and a written offer for the source must ship in-app. |
| whisper.cpp | MIT | Vendored and built with the NDK. See ADR 0003. |
| Whisper model weights | MIT | Attribution to OpenAI required. |
| Bundled fonts | SIL OFL / Apache 2.0 | Each font's own licence ships with it. |
| Bundled music and SFX | CC0 or equivalent | Provenance recorded per file. |
| Bundled LUTs | To be confirmed per pack | Only permissively licensed packs. |

## Stock media APIs (Phase 3)

| Service | Requirement |
|---|---|
| **Pexels** | Mandatory. "Photos/Videos provided by Pexels" prominently, plus photographer credit where available. |
| **Pixabay** | Not strictly required by licence; "Powered by Pixabay" shown anyway. |
| **Coverr** | Mandatory. The supplied Coverr logo, clickable. |

All three forbid resale of unaltered stock and use of their content for AI
training. ApexEdits does neither: downloads are user-initiated, land in a local
project cache, and the app has no network egress path for user media — it does
not request the `INTERNET` permission at all today.

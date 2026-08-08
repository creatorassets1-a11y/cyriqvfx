package com.apexedits.core.model

import java.io.File

/**
 * A real clip's metadata, as a test fixture.
 *
 * These numbers were parsed from the MP4 boxes of an actual 33-second phone
 * recording. **The file itself is not in this repository** — only its
 * measurements, so tests derived from it run everywhere, including CI, without
 * anyone's footage entering version control.
 *
 * It is worth having because synthetic fixtures are too tidy. This clip has three
 * properties that a hand-written fixture would not have thought to include:
 *
 *  - **576×640 is 0.9:1** — it matches none of the app's aspect presets, so
 *    anything that assumes 16:9 or 9:16 fails against it.
 *  - **Its audio and video tracks are different lengths**, 33.0091 s against
 *    33.0333 s. Real recordings routinely end mid-frame or mid-packet, and code
 *    that assumes the two agree breaks on them.
 *  - **It is exactly 30 fps**, which independently confirms the tick base:
 *    705,600,000 / 30 is a whole number, and so is 705,600,000 / 44,100.
 */
object SampleVideo {

    // --- container ---

    const val SIZE_BYTES = 3_748_747L
    const val MIME_TYPE = "video/mp4"

    /** `mvhd` duration: 33034 / 1000. What `METADATA_KEY_DURATION` reports. */
    const val DURATION_MS = 33_034L
    val duration: Ticks = Ticks.ofMillis(DURATION_MS)

    // --- video track ---

    const val WIDTH = 576
    const val HEIGHT = 640
    const val ROTATION_DEGREES = 0

    /** `mdhd` timescale 15360 with 991 samples of 512 units: exactly 30 fps. */
    const val FRAME_COUNT = 991L
    val frameRate: FrameRate = FrameRate.FPS_30

    /** 507392 / 15360. Very slightly shorter than the movie duration. */
    const val VIDEO_TRACK_DURATION_MS = 33_033L

    // --- audio track ---

    const val SAMPLE_RATE = 44_100
    const val CHANNEL_COUNT = 2

    /** 1455700 / 44100. 24 ms shorter than the video track. */
    const val AUDIO_TRACK_DURATION_MS = 33_009L

    /** The mismatch itself, which is the point of testing against this clip. */
    val audioVideoDriftMs: Long = VIDEO_TRACK_DURATION_MS - AUDIO_TRACK_DURATION_MS

    // --- derived ---

    /** A [MediaRef] as [com.apexedits.core.data.MediaImporter] would produce it. */
    fun mediaRef(id: String = "sample-video", uri: String = "file:///sample/clip.mp4") = MediaRef(
        id = id,
        uri = uri,
        displayName = "clip.mp4",
        kind = MediaKind.VIDEO,
        duration = duration,
        width = WIDTH,
        height = HEIGHT,
        rotationDegrees = ROTATION_DEGREES,
        frameRate = 30f,
        hasAudio = true,
        sizeBytes = SIZE_BYTES,
        available = true,
    )

    /** A project shaped for this clip: same pixel dimensions, same rate. */
    fun project(ids: IdSource, name: String = "Sample"): Project = createProject(
        ids = ids,
        name = name,
        format = ProjectFormat(
            width = WIDTH,
            height = HEIGHT,
            frameRate = frameRate,
            // 0.9:1 is none of the presets. Portrait is the nearest description,
            // and the mismatch is deliberate — a project whose media does not fit
            // a preset is the normal case, not an edge case.
            aspect = AspectRatio.PORTRAIT_4_5,
        ),
    ).copy(media = listOf(mediaRef()))

    /**
     * The real file, when a path was supplied.
     *
     * Tests that need the actual bytes take `-Dapex.sampleVideo=<path>` and skip
     * cleanly without it, so they can be run against real media locally while
     * remaining green in CI where no such file exists.
     */
    fun fileOrNull(): File? =
        System.getProperty(SYSTEM_PROPERTY)?.let(::File)?.takeIf { it.isFile }

    const val SYSTEM_PROPERTY = "apex.sampleVideo"
}

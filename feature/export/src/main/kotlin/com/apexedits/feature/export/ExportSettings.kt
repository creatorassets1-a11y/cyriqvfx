package com.apexedits.feature.export

import com.apexedits.core.device.PerformancePolicy
import com.apexedits.core.model.FrameRate
import com.apexedits.core.model.Ticks

/**
 * Export presets.
 *
 * Each carries the explanation the PRD requires the export screen to show, so
 * the user picks by what they are doing ("posting to TikTok") rather than by
 * guessing at a bitrate. The numbers are the platforms' own published
 * recommendations rather than round figures.
 */
enum class ExportPreset(
    val displayName: String,
    val explanation: String,
    val width: Int,
    val height: Int,
    val frameRate: FrameRate,
    val videoBitrate: Int,
    val codec: VideoCodec,
) {
    TIKTOK_REELS_SHORTS(
        displayName = "TikTok, Reels & Shorts",
        explanation = "Vertical 1080 × 1920 at 30 frames per second. The right shape and quality " +
            "for TikTok, Instagram Reels, and YouTube Shorts.",
        width = 1080,
        height = 1920,
        frameRate = FrameRate.FPS_30,
        videoBitrate = 10_000_000,
        codec = VideoCodec.H264,
    ),

    INSTAGRAM_FEED(
        displayName = "Instagram Feed",
        explanation = "Portrait 1080 × 1350. Fills more of the screen than a square post without " +
            "being cropped in the feed.",
        width = 1080,
        height = 1350,
        frameRate = FrameRate.FPS_30,
        videoBitrate = 9_000_000,
        codec = VideoCodec.H264,
    ),

    YOUTUBE_1080(
        displayName = "YouTube 1080p",
        explanation = "Widescreen 1920 × 1080 at 30 frames per second. The standard for landscape " +
            "video on YouTube and most players.",
        width = 1920,
        height = 1080,
        frameRate = FrameRate.FPS_30,
        videoBitrate = 12_000_000,
        codec = VideoCodec.H264,
    ),

    YOUTUBE_4K(
        displayName = "YouTube 4K",
        explanation = "Ultra-high-definition 3840 × 2160. The sharpest option, and by far the " +
            "slowest to export. Best on a recent, powerful phone.",
        width = 3840,
        height = 2160,
        frameRate = FrameRate.FPS_30,
        videoBitrate = 45_000_000,
        codec = VideoCodec.H265,
    ),

    SMALL_FILE(
        displayName = "Small File",
        explanation = "1280 × 720 at a lower quality. Much smaller file, quick to export and easy " +
            "to send in a message.",
        width = 1280,
        height = 720,
        frameRate = FrameRate.FPS_30,
        videoBitrate = 4_000_000,
        codec = VideoCodec.H264,
    );

    val longestEdge: Int get() = maxOf(width, height)

    fun toSettings() = ExportSettings(
        width = width,
        height = height,
        frameRate = frameRate,
        videoBitrate = videoBitrate,
        codec = codec,
        preset = this,
    )
}

enum class VideoCodec(val displayName: String, val explanation: String, val mimeType: String) {
    H264(
        "H.264",
        "Works everywhere. Choose this unless you have a reason not to.",
        "video/avc",
    ),
    H265(
        "H.265 (HEVC)",
        "Smaller files at the same quality, but some older devices and websites cannot play it.",
        "video/hevc",
    ),
}

data class ExportSettings(
    val width: Int,
    val height: Int,
    val frameRate: FrameRate,
    val videoBitrate: Int,
    val codec: VideoCodec,
    val audioBitrate: Int = 192_000,
    val preset: ExportPreset? = null,
) {
    val longestEdge: Int get() = maxOf(width, height)

    /**
     * Rough output size.
     *
     * Deliberately presented as an estimate: real size depends on how
     * compressible the footage is, and a precise-looking number that turns out
     * wrong by 40% is worse than an honest approximation.
     */
    fun estimatedBytes(duration: Ticks): Long {
        val seconds = duration.toSeconds()
        return (((videoBitrate + audioBitrate) / 8.0) * seconds).toLong()
    }

    /**
     * Whether this export exceeds what the device should be asked to do.
     *
     * Returns the warning rather than blocking. The PRD is explicit that the
     * user may always continue anyway — the app's job is to tell them what is
     * likely to happen, not to decide for them.
     */
    fun exceeds(policy: PerformancePolicy): Boolean = longestEdge > policy.exportMaxDimension

    /** The safer alternative offered alongside the warning. */
    fun cappedTo(policy: PerformancePolicy): ExportSettings {
        if (!exceeds(policy)) return this
        val scale = policy.exportMaxDimension.toDouble() / longestEdge
        return copy(
            width = (width * scale).toInt().evenised(),
            height = (height * scale).toInt().evenised(),
            videoBitrate = (videoBitrate * scale * scale).toInt().coerceAtLeast(2_000_000),
            preset = null,
        )
    }
}

/** Encoders reject odd dimensions, so every derived size is rounded to even. */
private fun Int.evenised(): Int = if (this % 2 == 0) this else this + 1

/** Progress reported out of the export worker. */
sealed interface ExportProgress {
    data object Preparing : ExportProgress
    data class Running(val percent: Int) : ExportProgress
    data class Complete(val outputUri: String, val sizeBytes: Long) : ExportProgress
    data class Failed(val message: String, val isRecoverable: Boolean) : ExportProgress
    data object Cancelled : ExportProgress
}

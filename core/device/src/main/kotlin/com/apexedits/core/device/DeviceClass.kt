package com.apexedits.core.device

/**
 * Device capability tiers and what the app does differently on each.
 *
 * The PRD requires ApexEdits to run on 2–3 GB devices as well as flagships, and
 * to warn before an operation that will hurt. That needs a single place where
 * "how much can this phone take" is decided, rather than each feature guessing.
 *
 * [PerformancePolicy] is that place: the classifier produces one, and every
 * feature asks it instead of reading `totalMem` for itself. Which means the
 * policy can be overridden wholesale — by the user in Settings, or by a thermal
 * event — and everything downstream adapts without knowing why.
 */
enum class DeviceClass {
    LOW,
    MEDIUM,
    HIGH;

    val displayName: String
        get() = when (this) {
            LOW -> "Limited"
            MEDIUM -> "Standard"
            HIGH -> "High performance"
        }

    /** Shown in Settings so the classification is visible rather than mysterious. */
    val explanation: String
        get() = when (this) {
            LOW -> "This device has limited memory or processing power. ApexEdits uses " +
                "lower-quality previews and smaller working files to stay responsive."
            MEDIUM -> "This device handles most editing comfortably. Previews run at up to " +
                "1080p and heavy effects may still need lower-quality previews."
            HIGH -> "This device can handle full-quality previews, 4K export, and many " +
                "layers at once."
        }
}

/**
 * What the app is allowed to do on this device.
 *
 * Every field answers a question some feature would otherwise answer by
 * guessing. The values are deliberately conservative on [DeviceClass.LOW]: the
 * PRD's stated preference is that a weak device stays usable rather than
 * offering a quality it cannot sustain.
 */
data class PerformancePolicy(
    val deviceClass: DeviceClass,
    /** Longest edge of the timeline preview, in pixels. */
    val previewMaxDimension: Int,
    /** Longest edge of generated proxy media. Zero means proxies are off. */
    val proxyMaxDimension: Int,
    /** Generate proxies on import without being asked. */
    val proxiesByDefault: Boolean,
    /** Longest edge this device should be offered for export. */
    val exportMaxDimension: Int,
    /** Above this many tracks, warn — but never refuse. */
    val softTrackLimit: Int,
    /** Above this many simultaneous video layers, warn before compositing. */
    val softLayerLimit: Int,
    /** Whisper model to default to once captions ship in Phase 3. */
    val recommendedCaptionModel: CaptionModel,
    /** Warn before operations tagged heavy. */
    val warnBeforeHeavyOperations: Boolean,
) {
    companion object {
        fun forClass(deviceClass: DeviceClass): PerformancePolicy = when (deviceClass) {
            DeviceClass.LOW -> PerformancePolicy(
                deviceClass = deviceClass,
                previewMaxDimension = 720,
                proxyMaxDimension = 540,
                proxiesByDefault = true,
                // 4K on a low-tier device is usually a thermal shutdown with a
                // corrupt file at the end, so it is not offered by default.
                exportMaxDimension = 1080,
                softTrackLimit = 4,
                softLayerLimit = 2,
                recommendedCaptionModel = CaptionModel.TINY,
                warnBeforeHeavyOperations = true,
            )

            DeviceClass.MEDIUM -> PerformancePolicy(
                deviceClass = deviceClass,
                previewMaxDimension = 1080,
                proxyMaxDimension = 720,
                proxiesByDefault = false,
                exportMaxDimension = 1920,
                softTrackLimit = 8,
                softLayerLimit = 4,
                recommendedCaptionModel = CaptionModel.BASE,
                warnBeforeHeavyOperations = true,
            )

            DeviceClass.HIGH -> PerformancePolicy(
                deviceClass = deviceClass,
                previewMaxDimension = 1920,
                proxyMaxDimension = 1080,
                proxiesByDefault = false,
                exportMaxDimension = 3840,
                softTrackLimit = 16,
                softLayerLimit = 8,
                recommendedCaptionModel = CaptionModel.BASE,
                warnBeforeHeavyOperations = false,
            )
        }
    }

    /** A copy with everything dialled down, for the "Use Safer Settings" button. */
    fun safer(): PerformancePolicy = copy(
        previewMaxDimension = minOf(previewMaxDimension, 720),
        proxyMaxDimension = if (proxyMaxDimension == 0) 540 else minOf(proxyMaxDimension, 540),
        proxiesByDefault = true,
        exportMaxDimension = minOf(exportMaxDimension, 1080),
        warnBeforeHeavyOperations = true,
    )
}

/** Whisper model sizes. Phase 3 ships tiny and base; the policy already names one. */
enum class CaptionModel(val displayName: String, val approximateMemoryMb: Int) {
    TINY("Tiny — fastest, good for clear speech", 200),
    BASE("Base — slower, more accurate", 400),
    SMALL("Small — slowest, most accurate", 900),
}

/**
 * Operations heavy enough to warrant a warning on a constrained device.
 *
 * Naming them as a type rather than passing strings means the warning dialog can
 * state exactly what is about to happen, and the set is enumerable — so it is
 * obvious when a new heavy feature has not been classified.
 */
enum class HeavyOperation(val displayName: String, val why: String) {
    IMPORT_HIGH_RESOLUTION(
        "Importing high-resolution video",
        "Large videos need to be decoded and prepared, which uses a lot of memory.",
    ),
    EXPORT_HIGH_RESOLUTION(
        "Exporting at high resolution",
        "Rendering at 4K uses the most processing power of anything in the app and can make the device hot.",
    ),
    MANY_LAYERS(
        "Playing many layers at once",
        "Every extra video layer has to be decoded and combined for each frame of preview.",
    ),
    LONG_TIMELINE(
        "Working with a long timeline",
        "Long projects need more memory for thumbnails and sound waveforms.",
    ),
    GENERATE_CAPTIONS(
        "Generating captions",
        "Speech recognition runs entirely on this device, which is demanding on the processor.",
    ),
}

/**
 * The Limited Resources dialog's content.
 *
 * The PRD specifies this copy almost verbatim, including the three buttons. It
 * is modelled as data so the dialog is one composable rather than one per call
 * site, and so the wording cannot drift between them.
 */
data class LowResourceWarning(
    val operation: HeavyOperation,
    val deviceClass: DeviceClass,
) {
    val title: String = "Limited Device Resources Detected"

    val body: String = buildString {
        append(operation.why)
        append(" Running high-resolution preview or complex effects may cause lag, ")
        append("overheating, or the app to close unexpectedly.")
    }

    val recommendation: String = "Recommended: use lower-quality previews and export at 1080p."

    val saferButton: String = "Use Safer Settings"
    val continueButton: String = "Continue Anyway"
    val suppressButton: String = "Don't show again for this device"
}

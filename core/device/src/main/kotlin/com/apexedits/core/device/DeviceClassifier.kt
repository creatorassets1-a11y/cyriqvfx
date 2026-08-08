package com.apexedits.core.device

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.os.StatFs
import androidx.core.content.getSystemService

/**
 * Measured facts about the device, separated from the judgement made from them.
 *
 * Splitting the two is what makes the classification testable: [classify] is a
 * pure function over this record, so every tier boundary can be checked on the
 * JVM without an emulator or a fake `Context`.
 */
data class DeviceCapabilities(
    val totalMemoryMb: Long,
    val availableMemoryMb: Long,
    val cpuCores: Int,
    /** `Build.VERSION.MEDIA_PERFORMANCE_CLASS`, or 0 when the device declares none. */
    val mediaPerformanceClass: Int,
    val availableStorageMb: Long,
    val isLowRamDevice: Boolean,
    val supportsHevcHardware: Boolean,
) {
    companion object {
        /**
         * Reads the device's actual numbers.
         *
         * `totalMem` rather than `maxMemory`: the heap limit tells you what one
         * process may allocate, but video decoding happens largely outside the
         * Java heap, so the whole-device figure is the one that predicts whether
         * a 4K decode session survives.
         */
        fun read(context: Context): DeviceCapabilities {
            val activityManager = context.getSystemService<ActivityManager>()
            val memoryInfo = ActivityManager.MemoryInfo().also {
                activityManager?.getMemoryInfo(it)
            }

            val storage = runCatching {
                val stat = StatFs(context.filesDir.absolutePath)
                stat.availableBytes / BYTES_PER_MB
            }.getOrDefault(0L)

            return DeviceCapabilities(
                totalMemoryMb = memoryInfo.totalMem / BYTES_PER_MB,
                availableMemoryMb = memoryInfo.availMem / BYTES_PER_MB,
                cpuCores = Runtime.getRuntime().availableProcessors(),
                mediaPerformanceClass = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    Build.VERSION.MEDIA_PERFORMANCE_CLASS
                } else {
                    0
                },
                availableStorageMb = storage,
                isLowRamDevice = activityManager?.isLowRamDevice ?: false,
                supportsHevcHardware = hasHardwareHevc(),
            )
        }

        private const val BYTES_PER_MB = 1024L * 1024L

        private fun hasHardwareHevc(): Boolean = runCatching {
            val list = android.media.MediaCodecList(android.media.MediaCodecList.REGULAR_CODECS)
            list.codecInfos.any { info ->
                info.isEncoder &&
                    info.supportedTypes.any { it.equals("video/hevc", ignoreCase = true) } &&
                    (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || info.isHardwareAccelerated)
            }
        }.getOrDefault(false)
    }
}

/**
 * Turns measurements into a tier. Pure, so the boundaries are unit-testable.
 *
 * The ordering matters. `isLowRamDevice` is checked first because it is the
 * manufacturer's own declaration that this device runs the low-memory Android
 * configuration — no amount of favourable CPU count overrides that. Media
 * Performance Class is checked next where present, because it is a measured
 * certification of exactly the media workload this app runs, and it is far more
 * predictive than RAM alone: a certified class-31 device handles concurrent 4K
 * decode sessions that a 6 GB uncertified phone may not.
 *
 * RAM and core count are the fallback for the many devices that declare neither.
 */
fun classify(capabilities: DeviceCapabilities): DeviceClass = with(capabilities) {
    if (isLowRamDevice) return DeviceClass.LOW

    if (mediaPerformanceClass >= Build.VERSION_CODES.TIRAMISU) return DeviceClass.HIGH
    if (mediaPerformanceClass >= Build.VERSION_CODES.S) return DeviceClass.MEDIUM

    when {
        // The PRD's low tier: 2–3 GB devices, or anything with too few cores to
        // decode and composite at the same time.
        totalMemoryMb < 3_500 || cpuCores <= 4 -> DeviceClass.LOW
        totalMemoryMb < 6_500 -> DeviceClass.MEDIUM
        else -> DeviceClass.HIGH
    }
}

/**
 * Current thermal state, mapped to what the app should do about it.
 *
 * The PRD asks for automatic quality reduction under throttling. Reading
 * `currentThermalStatus` at the moment of a heavy operation catches the case
 * that matters — a device that was fine when the project opened and is not fine
 * twenty minutes into an export.
 */
enum class ThermalState {
    NORMAL,
    /** Warm. Preview quality drops; the user is told once. */
    THROTTLING,
    /** Hot. Heavy operations are discouraged and export offers to pause. */
    SEVERE;

    companion object {
        fun read(context: Context): ThermalState {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return NORMAL
            val power = context.getSystemService<PowerManager>() ?: return NORMAL
            return when (power.currentThermalStatus) {
                PowerManager.THERMAL_STATUS_NONE,
                PowerManager.THERMAL_STATUS_LIGHT,
                -> NORMAL

                PowerManager.THERMAL_STATUS_MODERATE -> THROTTLING

                else -> SEVERE
            }
        }
    }
}

/**
 * The device profile the rest of the app consumes.
 *
 * [effectivePolicy] folds in thermal state and any user override, so callers get
 * one answer rather than having to combine three sources themselves.
 */
data class DeviceProfile(
    val capabilities: DeviceCapabilities,
    val deviceClass: DeviceClass,
    val thermalState: ThermalState = ThermalState.NORMAL,
    /** Set when the user chose "Use Safer Settings" or changed Settings by hand. */
    val userOverride: PerformancePolicy? = null,
) {
    val basePolicy: PerformancePolicy get() = PerformancePolicy.forClass(deviceClass)

    val effectivePolicy: PerformancePolicy
        get() {
            val policy = userOverride ?: basePolicy
            // A hot device gets the safer policy regardless of tier: a flagship
            // that is throttling is, for the next few minutes, not a flagship.
            return if (thermalState == ThermalState.NORMAL) policy else policy.safer()
        }

    companion object {
        fun read(context: Context): DeviceProfile {
            val capabilities = DeviceCapabilities.read(context)
            return DeviceProfile(
                capabilities = capabilities,
                deviceClass = classify(capabilities),
                thermalState = ThermalState.read(context),
            )
        }
    }
}

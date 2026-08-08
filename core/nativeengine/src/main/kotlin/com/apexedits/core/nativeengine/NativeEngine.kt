package com.apexedits.core.nativeengine

import java.nio.ByteBuffer

/**
 * The Kotlin side of the JNI boundary.
 *
 * Deliberately small — see ADR 0006. Kotlin owns the document; C++ owns the
 * pixels. What crosses this line is parameters and, in the CPU path only,
 * a direct buffer the native side writes in place. Frames in the live preview
 * and export paths never cross at all: they stay in `AHardwareBuffer` / GPU
 * memory end to end.
 *
 * Every method here is either called once per edit or once per still. If a
 * method is ever needed 60 times a second, that is the signal it belongs on the
 * native side of the line instead.
 */
object NativeEngine {

    /**
     * Whether the native library loaded.
     *
     * Checked rather than assumed: a device with an unexpected ABI, or a
     * sideloaded APK stripped of one, should degrade to the Kotlin paths with a
     * clear message rather than dying in a static initialiser before the app has
     * drawn anything.
     */
    val isAvailable: Boolean = runCatching {
        System.loadLibrary("apexengine")
        true
    }.getOrDefault(false)

    /**
     * The native ABI version.
     *
     * Guards against a stale `.so` — an incremental build that shipped new
     * Kotlin against old native code fails here, loudly, instead of misreading
     * a parameter block and producing a silently wrong matte.
     */
    fun abiVersion(): Int = if (isAvailable) nativeAbiVersion() else 0

    const val EXPECTED_ABI_VERSION = 1

    /**
     * Converts a picked screen colour into the keyer's normalised chroma space.
     *
     * Exposed rather than reimplemented in Kotlin so the eyedropper and the
     * shader cannot disagree about the space. The normalisation is not obvious —
     * chroma is divided by luma so an unevenly lit screen keys with one
     * tolerance — and two implementations of it would drift.
     */
    fun rgbToChroma(r: Int, g: Int, b: Int): FloatArray =
        if (isAvailable) nativeRgbToChroma(r, g, b) else floatArrayOf(0f, 0f)

    /**
     * Keys an RGBA image in place, returning how many pixels became fully
     * transparent, or -1 if the buffer was unusable.
     *
     * [pixels] **must** be a direct [ByteBuffer]: the native side takes its
     * address rather than copying, and a heap buffer has no stable address to
     * take. Returns -1 rather than crashing if given one anyway.
     *
     * The count is what lets the UI say "this removed almost the whole frame —
     * check the screen colour" instead of showing a black preview and leaving
     * the user to work out why.
     */
    fun keyRgba(pixels: ByteBuffer, width: Int, height: Int, params: ChromaKeyParams): Int {
        if (!isAvailable) return -1
        require(pixels.isDirect) { "keyRgba needs a direct ByteBuffer" }
        return nativeKeyRgba(pixels, width, height, params.pack())
    }

    private external fun nativeAbiVersion(): Int
    private external fun nativeRgbToChroma(r: Int, g: Int, b: Int): FloatArray
    private external fun nativeKeyRgba(
        buffer: ByteBuffer,
        width: Int,
        height: Int,
        packed: FloatArray,
    ): Int
}

/** Which channel the screen is. Spill suppression restrains this one specifically. */
enum class ScreenChannel { GREEN, BLUE, RED }

/**
 * Keyer parameters, mirroring `apex::matte::ChromaKeyParams`.
 *
 * [pack] flattens these into the float array the native side reads. A flat array
 * rather than per-field JNI getters because a keyer panel drags a dozen of these
 * at 60 Hz, and one array copy costs far less than two dozen field lookups. The
 * ordering is load-bearing and asserted by tests on both sides.
 */
data class ChromaKeyParams(
    /** Screen colour in normalised chroma space, from [NativeEngine.rgbToChroma]. */
    val screenCb: Float = -0.5389f,
    val screenCr: Float = -0.6350f,
    val channel: ScreenChannel = ScreenChannel.GREEN,
    /** Radius that keys out completely. */
    val tolerance: Float = 0.15f,
    /** Width of the falloff band beyond tolerance. This is where hair lives. */
    val softness: Float = 0.10f,
    /** Alpha below this is forced transparent — clears screen haze. */
    val blackPoint: Float = 0.05f,
    /** Alpha above this is forced opaque — recovers a subject dimmed by the key. */
    val whitePoint: Float = 0.95f,
    val spillStrength: Float = 1.0f,
    /** Below this luma the key is disabled, so dark hair keeps its detail. */
    val lumaLow: Float = 0.02f,
    val lumaHigh: Float = 1.0f,
) {
    fun pack(): FloatArray = floatArrayOf(
        screenCb,
        screenCr,
        channel.ordinal.toFloat(),
        tolerance,
        softness,
        blackPoint,
        whitePoint,
        spillStrength,
        lumaLow,
        lumaHigh,
        // Reserved, so the block can grow without a version bump.
        0f,
    )

    companion object {
        /** Length of the packed block. The native side reads exactly this many. */
        const val PACKED_SIZE = 11
    }
}

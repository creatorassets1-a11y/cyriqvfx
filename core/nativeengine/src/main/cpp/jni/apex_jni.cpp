// The JNI boundary.
//
// Deliberately thin — see ADR 0006. Nothing per-pixel crosses this line: Kotlin
// hands over parameters and the engine works on frames that are already in
// native or GPU memory. The functions here are the whole surface.

#include <jni.h>
#include <android/log.h>

#include <vector>

#include "apex/matte/chroma_key.h"

namespace {

constexpr const char* kTag = "ApexEngine";

/// Reads the parameter block Kotlin passes as a float array.
///
/// A flat array rather than per-field JNI getters: each `GetFieldID` /
/// `GetFloatField` pair is a lookup, and a keyer panel drags twelve of these at
/// 60 Hz. One array copy is cheaper than twenty-four JNI calls, and the ordering
/// is asserted by a test on both sides.
apex::matte::ChromaKeyParams params_from(JNIEnv* env, jfloatArray packed) {
    apex::matte::ChromaKeyParams p;
    if (packed == nullptr || env->GetArrayLength(packed) < 11) return p;

    jfloat values[11];
    env->GetFloatArrayRegion(packed, 0, 11, values);

    p.screen = {values[0], values[1]};
    p.channel = static_cast<apex::matte::ScreenChannel>(static_cast<uint8_t>(values[2]));
    p.tolerance = values[3];
    p.softness = values[4];
    p.black_point = values[5];
    p.white_point = values[6];
    p.spill_strength = values[7];
    p.luma_low = values[8];
    p.luma_high = values[9];
    // values[10] is reserved so the array length can grow without a version bump.
    return p;
}

}  // namespace

extern "C" {

/// Reports the engine version, so the Kotlin side can fail loudly on a stale
/// `.so` rather than crashing somewhere unrelated later.
JNIEXPORT jint JNICALL
Java_com_apexedits_core_nativeengine_NativeEngine_nativeAbiVersion(JNIEnv*, jobject) {
    return 1;
}

/// Converts an RGB colour to the keyer's normalised chroma space.
///
/// Called once when the user picks a screen colour with the eyedropper, not per
/// frame. Exposed so the picker and the shader agree exactly on the space,
/// rather than Kotlin reimplementing the conversion and drifting from it.
JNIEXPORT jfloatArray JNICALL
Java_com_apexedits_core_nativeengine_NativeEngine_nativeRgbToChroma(
        JNIEnv* env, jobject, jint r, jint g, jint b) {
    const auto c = apex::matte::rgb_to_chroma(
            static_cast<uint8_t>(r), static_cast<uint8_t>(g), static_cast<uint8_t>(b));
    jfloat out[2] = {c.cb, c.cr};
    jfloatArray result = env->NewFloatArray(2);
    if (result != nullptr) env->SetFloatArrayRegion(result, 0, 2, out);
    return result;
}

/// Keys an RGBA buffer in place.
///
/// The CPU path, used for stills, thumbnails and the test harness. Live preview
/// and export use the GPU transliteration of the same functions and never call
/// this — a 1080p frame through JNI per frame is exactly what ADR 0006 forbids.
JNIEXPORT jint JNICALL
Java_com_apexedits_core_nativeengine_NativeEngine_nativeKeyRgba(
        JNIEnv* env, jobject, jobject buffer, jint width, jint height, jfloatArray packed) {
    auto* pixels = static_cast<uint8_t*>(env->GetDirectBufferAddress(buffer));
    if (pixels == nullptr) {
        __android_log_print(ANDROID_LOG_ERROR, kTag,
                            "nativeKeyRgba needs a direct ByteBuffer");
        return -1;
    }
    const auto p = params_from(env, packed);
    return static_cast<jint>(apex::matte::key_image_rgba(p, pixels, width, height));
}

}  // extern "C"

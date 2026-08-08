// ApexEdits — chroma key core.
//
// Deliberately free of Android, GL and JNI headers so it compiles for the host
// and its numerics can be unit-tested without a device. The GPU implementation
// is a direct transliteration of these functions into GLSL; this file is the
// reference the shader is checked against.

#ifndef APEX_MATTE_CHROMA_KEY_H
#define APEX_MATTE_CHROMA_KEY_H

#include <cstdint>
#include <cstddef>

namespace apex::matte {

/// A colour in the chroma plane. Luma is deliberately absent: the whole point of
/// keying in this space is that brightness must not influence the key, so an
/// unevenly lit screen still pulls a clean matte.
struct ChromaPoint {
    float cb;
    float cr;
};

/// Rec. 709 chroma, divided by luma.
///
/// The division is the important part: plain YCbCr chroma scales with
/// brightness, so the same green at two exposures lands 0.30 apart — twice a
/// sensible tolerance — and an unevenly lit screen could not be keyed with one
/// setting. Normalising leaves hue and saturation only, so brightness variation
/// across the screen costs nothing.
///
/// 709 rather than 601 because everything the app handles is HD or larger; using
/// 601 coefficients on 709 content shifts the screen axis slightly and costs
/// tolerance headroom that would otherwise go to edge quality.
ChromaPoint rgb_to_chroma(uint8_t r, uint8_t g, uint8_t b) noexcept;

float rgb_to_luma(uint8_t r, uint8_t g, uint8_t b) noexcept;

/// Which screen channel is being keyed. Spill suppression has to know: it
/// restrains that channel specifically rather than desaturating everything.
enum class ScreenChannel : uint8_t { Green, Blue, Red };

/// Professional keyer parameters.
///
/// Tolerance and softness are two radii rather than one "similarity" slider.
/// Inside `tolerance` a pixel is fully transparent; between `tolerance` and
/// `tolerance + softness` it falls off; beyond, it is fully opaque. Collapsing
/// them into one number is the main reason cheap keyers produce either hard
/// jagged edges or a milky, half-transparent subject — there is no single value
/// that both rejects the screen and keeps hair.
struct ChromaKeyParams {
    /// The screen colour, sampled by the user's eyedropper. Defaults to pure
    /// green in the luma-normalised space — the value `rgb_to_chroma(0,255,0)`
    /// returns, so a user who never touches the picker still gets a sane key.
    ChromaPoint screen{-0.5389f, -0.6350f};

    ScreenChannel channel{ScreenChannel::Green};

    /// Chroma-plane radius that keys out completely.
    ///
    /// In the normalised space a well-lit screen sits within ~0.12 of the picked
    /// colour while skin is ~0.88 away, so there is a wide margin — most footage
    /// needs no adjustment at all.
    float tolerance{0.15f};

    /// Width of the falloff band beyond `tolerance`. This is where hair lives.
    float softness{0.10f};

    /// Alpha below this is forced to 0 — removes screen-coloured haze.
    float black_point{0.05f};

    /// Alpha above this is forced to 1 — recovers a subject dimmed by the key.
    float white_point{0.95f};

    /// How strongly the screen channel is restrained in spill regions. 0..1.
    float spill_strength{1.0f};

    /// Luma range over which the key applies. Keeps deep shadows opaque, where
    /// chroma is noise and a keyer would otherwise punch holes in dark hair.
    float luma_low{0.02f};
    float luma_high{1.0f};
};

/// The alpha for one pixel, before any spatial refinement.
///
/// Pure and branch-light by design: this is transliterated into a fragment
/// shader, where divergent branches cost more than the arithmetic they skip.
float key_alpha(const ChromaKeyParams& p, uint8_t r, uint8_t g, uint8_t b) noexcept;

/// Removes screen colour reflected onto the subject.
///
/// The part most implementations get wrong. Desaturating green turns skin grey
/// and drains warm tones; the correct move is to limit the screen channel to a
/// function of the other two, so a genuinely green object stays green while
/// green *light* on skin is neutralised.
///
/// Applied in place. `alpha` scales the effect so fully transparent pixels are
/// left alone — there is nothing there to de-spill.
void suppress_spill(const ChromaKeyParams& p, float alpha,
                    uint8_t& r, uint8_t& g, uint8_t& b) noexcept;

/// Keys an interleaved RGBA image, writing alpha in place and de-spilling RGB.
///
/// `pixels` is `width * height * 4` bytes. Returns the count of pixels that
/// ended fully transparent, which the UI uses to warn when a key has removed
/// essentially everything — usually a mis-picked screen colour, and far more
/// helpful to report than a black preview.
size_t key_image_rgba(const ChromaKeyParams& p, uint8_t* pixels,
                      int width, int height) noexcept;

// --- alpha refinement --------------------------------------------------------

/// Erodes (negative) or dilates (positive) the matte by `radius` pixels.
///
/// Called a "choker" in compositing. Eroding by a pixel is the standard fix for
/// the thin screen-coloured fringe left around a subject.
void choke_alpha(uint8_t* alpha, int width, int height, int radius,
                 uint8_t* scratch) noexcept;

/// Separable box blur on the alpha channel — the cheap feather.
///
/// Two passes of a box blur approximate a Gaussian closely enough for a matte
/// edge at a fraction of the cost, and separability makes it O(n) in radius
/// rather than O(n²).
void feather_alpha(uint8_t* alpha, int width, int height, int radius,
                   uint8_t* scratch) noexcept;

/// Edge-aware upsample of a low-resolution matte, guided by full-resolution luma.
///
/// The most valuable function in the file. It lets inference run at 384–512 px
/// while the matte still lands on real image edges at 1080p, which is both much
/// faster and often *sharper on hair* than running the network at full
/// resolution — once the alpha is snapped to the actual luma edge, the network's
/// own boundary precision stops being the limiting factor.
///
/// A guided filter proper (He et al.) computes local linear coefficients; this
/// is the joint-bilateral approximation, which is cheaper, maps cleanly onto a
/// compute shader, and is within noise of the full version on matte edges.
void guided_upsample(const uint8_t* low_alpha, int low_width, int low_height,
                     const uint8_t* guide_luma, int width, int height,
                     uint8_t* out_alpha, float edge_sigma) noexcept;

}  // namespace apex::matte

#endif  // APEX_MATTE_CHROMA_KEY_H

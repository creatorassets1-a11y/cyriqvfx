#include "chroma_key.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace apex::matte {
namespace {

constexpr float kInv255 = 1.0f / 255.0f;

inline float clamp01(float v) noexcept { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }

inline uint8_t to_u8(float v) noexcept {
    return static_cast<uint8_t>(clamp01(v) * 255.0f + 0.5f);
}

/// Hermite smoothstep. Used for every falloff so edges have continuous first
/// derivative — a linear ramp leaves a visible band where the slope changes,
/// which reads as a hard line in an otherwise soft matte.
inline float smoothstep(float edge0, float edge1, float x) noexcept {
    if (edge1 <= edge0) return x < edge0 ? 0.0f : 1.0f;
    const float t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3.0f - 2.0f * t);
}

}  // namespace

float rgb_to_luma(uint8_t r, uint8_t g, uint8_t b) noexcept {
    // Rec. 709.
    return (0.2126f * r + 0.7152f * g + 0.0722f * b) * kInv255;
}

ChromaPoint rgb_to_chroma(uint8_t r, uint8_t g, uint8_t b) noexcept {
    const float rf = r * kInv255;
    const float gf = g * kInv255;
    const float bf = b * kInv255;
    const float y = 0.2126f * rf + 0.7152f * gf + 0.0722f * bf;

    // Normalised by luma, which is the difference between a keyer that survives
    // a real screen and one that does not.
    //
    // Plain YCbCr chroma scales with brightness: pure green at full intensity
    // and the same green at half intensity sit 0.30 apart in the chroma plane —
    // twice a sensible tolerance. A screen lit brighter at the top than the
    // bottom would then need two different tolerances, which is exactly the
    // complaint people have about cheap keyers. Dividing by luma removes the
    // magnitude and leaves pure hue and saturation, so those two greens land on
    // the *same point* and one tolerance covers the whole screen.
    //
    // The division is unstable as luma approaches zero, which is why
    // ChromaKeyParams::luma_low exists: near-black pixels never reach this
    // comparison. The epsilon here only stops a NaN escaping into the matte.
    const float safe_y = y > 1e-3f ? y : 1e-3f;
    return ChromaPoint{(bf - y) * 0.5389f / safe_y, (rf - y) * 0.6350f / safe_y};
}

float key_alpha(const ChromaKeyParams& p, uint8_t r, uint8_t g, uint8_t b) noexcept {
    const ChromaPoint c = rgb_to_chroma(r, g, b);

    // Distance from the screen colour *in the chroma plane only*. Luma is
    // excluded on purpose: a screen lit brighter at the top than the bottom
    // still keys with one tolerance, which is what makes this survive real
    // lighting rather than a studio ideal.
    const float dcb = c.cb - p.screen.cb;
    const float dcr = c.cr - p.screen.cr;
    const float distance = std::sqrt(dcb * dcb + dcr * dcr);

    // Inside tolerance: transparent. Across softness: falloff. Beyond: opaque.
    float alpha = smoothstep(p.tolerance, p.tolerance + std::max(p.softness, 1e-4f), distance);

    // Deep shadows carry almost no chroma information, so their measured
    // distance is noise. Without this guard a keyer punches holes in dark hair
    // and black clothing — one of the most common complaints about automatic
    // keying, and entirely avoidable.
    const float luma = rgb_to_luma(r, g, b);
    if (luma < p.luma_low) {
        alpha = 1.0f;
    } else if (p.luma_high < 1.0f && luma > p.luma_high) {
        alpha = 1.0f;
    }

    // Black and white points pull the near-transparent and near-opaque regions
    // to the rails, which is what clears screen haze without eating the soft
    // edge in between.
    if (p.white_point > p.black_point) {
        alpha = clamp01((alpha - p.black_point) / (p.white_point - p.black_point));
    }
    return alpha;
}

void suppress_spill(const ChromaKeyParams& p, float alpha,
                    uint8_t& r, uint8_t& g, uint8_t& b) noexcept {
    if (p.spill_strength <= 0.0f) return;

    float rf = r * kInv255;
    float gf = g * kInv255;
    float bf = b * kInv255;

    // Restrain the screen channel toward the other two rather than desaturating.
    // A genuinely green jumper keeps its green because its own green already sits
    // near its red and blue; green *light* spilled on skin does not, and only
    // that is pulled down.
    // Initialised at declaration rather than only in the switch: an enum value
    // outside the three cases would otherwise leave these dangling, and a wild
    // pointer write on the render thread is not a failure mode worth risking
    // for a branch the compiler cannot prove is exhaustive.
    float* screen = &gf;
    float other_a = rf;
    float other_b = bf;
    switch (p.channel) {
        case ScreenChannel::Green: screen = &gf; other_a = rf; other_b = bf; break;
        case ScreenChannel::Blue:  screen = &bf; other_a = rf; other_b = gf; break;
        case ScreenChannel::Red:   screen = &rf; other_a = gf; other_b = bf; break;
    }

    // The ceiling is the average of the other two channels. Using max() is the
    // common alternative and under-suppresses; using min() over-suppresses and
    // greys the image. The mean is the compromise professional keyers settle on.
    const float ceiling = (other_a + other_b) * 0.5f;
    if (*screen > ceiling) {
        const float excess = *screen - ceiling;
        // Scale by alpha so a fully transparent pixel is untouched — there is no
        // subject there to de-spill, and modifying it would tint the edge when it
        // is later blended over the new background.
        *screen -= excess * p.spill_strength * alpha;
    }

    r = to_u8(rf);
    g = to_u8(gf);
    b = to_u8(bf);
}

size_t key_image_rgba(const ChromaKeyParams& p, uint8_t* pixels,
                      int width, int height) noexcept {
    if (pixels == nullptr || width <= 0 || height <= 0) return 0;

    size_t fully_transparent = 0;
    const size_t count = static_cast<size_t>(width) * static_cast<size_t>(height);

    for (size_t i = 0; i < count; ++i) {
        uint8_t* px = pixels + i * 4;
        const float alpha = key_alpha(p, px[0], px[1], px[2]);
        suppress_spill(p, alpha, px[0], px[1], px[2]);
        px[3] = to_u8(alpha);
        if (px[3] == 0) ++fully_transparent;
    }
    return fully_transparent;
}

// --- alpha refinement --------------------------------------------------------

void choke_alpha(uint8_t* alpha, int width, int height, int radius,
                 uint8_t* scratch) noexcept {
    if (alpha == nullptr || scratch == nullptr || radius == 0) return;
    if (width <= 0 || height <= 0) return;

    const bool erode = radius < 0;
    const int r = std::abs(radius);

    // Separable min/max: a 2D structuring element is the composition of a
    // horizontal and a vertical pass, turning O(r²) per pixel into O(r).
    for (int pass = 0; pass < 2; ++pass) {
        const uint8_t* src = (pass == 0) ? alpha : scratch;
        uint8_t* dst = (pass == 0) ? scratch : alpha;

        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                uint8_t best = erode ? 255 : 0;
                for (int k = -r; k <= r; ++k) {
                    const int sx = (pass == 0) ? std::clamp(x + k, 0, width - 1) : x;
                    const int sy = (pass == 0) ? y : std::clamp(y + k, 0, height - 1);
                    const uint8_t v = src[static_cast<size_t>(sy) * width + sx];
                    best = erode ? std::min(best, v) : std::max(best, v);
                }
                dst[static_cast<size_t>(y) * width + x] = best;
            }
        }
    }
}

void feather_alpha(uint8_t* alpha, int width, int height, int radius,
                   uint8_t* scratch) noexcept {
    if (alpha == nullptr || scratch == nullptr || radius <= 0) return;
    if (width <= 0 || height <= 0) return;

    const int window = radius * 2 + 1;

    // Horizontal, then vertical. Running sums make each pass O(1) per pixel
    // regardless of radius, which is what allows a wide feather in real time.
    for (int y = 0; y < height; ++y) {
        const uint8_t* row = alpha + static_cast<size_t>(y) * width;
        uint8_t* out = scratch + static_cast<size_t>(y) * width;
        int sum = 0;
        for (int k = -radius; k <= radius; ++k) sum += row[std::clamp(k, 0, width - 1)];
        for (int x = 0; x < width; ++x) {
            out[x] = static_cast<uint8_t>(sum / window);
            const int add = std::clamp(x + radius + 1, 0, width - 1);
            const int drop = std::clamp(x - radius, 0, width - 1);
            sum += row[add] - row[drop];
        }
    }

    for (int x = 0; x < width; ++x) {
        int sum = 0;
        for (int k = -radius; k <= radius; ++k) {
            sum += scratch[static_cast<size_t>(std::clamp(k, 0, height - 1)) * width + x];
        }
        for (int y = 0; y < height; ++y) {
            alpha[static_cast<size_t>(y) * width + x] = static_cast<uint8_t>(sum / window);
            const int add = std::clamp(y + radius + 1, 0, height - 1);
            const int drop = std::clamp(y - radius, 0, height - 1);
            sum += scratch[static_cast<size_t>(add) * width + x] -
                   scratch[static_cast<size_t>(drop) * width + x];
        }
    }
}

void guided_upsample(const uint8_t* low_alpha, int low_width, int low_height,
                     const uint8_t* guide_luma, int width, int height,
                     uint8_t* out_alpha, float edge_sigma) noexcept {
    if (low_alpha == nullptr || guide_luma == nullptr || out_alpha == nullptr) return;
    if (low_width <= 0 || low_height <= 0 || width <= 0 || height <= 0) return;

    const float sx = static_cast<float>(low_width) / static_cast<float>(width);
    const float sy = static_cast<float>(low_height) / static_cast<float>(height);
    const float sigma = std::max(edge_sigma, 1e-3f);
    const float inv_two_sigma_sq = 1.0f / (2.0f * sigma * sigma);

    for (int y = 0; y < height; ++y) {
        const int ly = std::min(static_cast<int>(y * sy), low_height - 1);
        for (int x = 0; x < width; ++x) {
            const int lx = std::min(static_cast<int>(x * sx), low_width - 1);
            const float centre_luma = guide_luma[static_cast<size_t>(y) * width + x] * kInv255;

            // Joint bilateral: weight each low-res neighbour by how close its
            // guide luma is to this pixel's. A neighbour across a real image edge
            // contributes almost nothing, so the upsampled alpha snaps to that
            // edge instead of blurring across it — which is exactly how hair
            // detail is recovered from a small inference.
            float weighted = 0.0f;
            float total = 0.0f;
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    const int nx = std::clamp(lx + dx, 0, low_width - 1);
                    const int ny = std::clamp(ly + dy, 0, low_height - 1);

                    // The neighbour's position in full-resolution space, so its
                    // guide luma is sampled from the same image the edge is in.
                    const int gx = std::clamp(static_cast<int>(nx / sx), 0, width - 1);
                    const int gy = std::clamp(static_cast<int>(ny / sy), 0, height - 1);
                    const float neighbour_luma =
                        guide_luma[static_cast<size_t>(gy) * width + gx] * kInv255;

                    const float d = neighbour_luma - centre_luma;
                    const float w = std::exp(-d * d * inv_two_sigma_sq);

                    weighted += w * low_alpha[static_cast<size_t>(ny) * low_width + nx];
                    total += w;
                }
            }
            out_alpha[static_cast<size_t>(y) * width + x] =
                total > 0.0f ? static_cast<uint8_t>(weighted / total + 0.5f)
                             : low_alpha[static_cast<size_t>(ly) * low_width + lx];
        }
    }
}

}  // namespace apex::matte

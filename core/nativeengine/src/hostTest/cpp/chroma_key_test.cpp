// Host-runnable tests for the chroma key core.
//
// The engine's portable code builds for x86-64 as well as arm64 precisely so
// this can run in CI and on a development machine with no Android device. A
// tiny assert harness rather than a framework: one fewer dependency to vendor,
// and the output is as useful.

#include "../../main/cpp/apex/matte/chroma_key.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

int g_failures = 0;
int g_checks = 0;
const char* g_current = "";

void check(bool ok, const char* expr, int line) {
    ++g_checks;
    if (!ok) {
        ++g_failures;
        std::printf("  FAIL  %s:%d  %s\n", g_current, line, expr);
    }
}

void check_near(float actual, float expected, float tol, const char* expr, int line) {
    ++g_checks;
    if (std::fabs(actual - expected) > tol) {
        ++g_failures;
        std::printf("  FAIL  %s:%d  %s  (got %.4f, expected %.4f +/- %.4f)\n",
                    g_current, line, expr, actual, expected, tol);
    }
}

#define CHECK(x) check((x), #x, __LINE__)
#define CHECK_NEAR(a, b, t) check_near((a), (b), (t), #a " ~= " #b, __LINE__)
#define TEST(name) g_current = name; std::printf("- %s\n", name);

using namespace apex::matte;

/// Parameters tuned for a typical green screen, as the UI would default them.
ChromaKeyParams green_screen() {
    ChromaKeyParams p;
    // Pure green's position in the chroma plane.
    p.screen = rgb_to_chroma(0, 255, 0);
    p.channel = ScreenChannel::Green;
    p.tolerance = 0.15f;
    p.softness = 0.10f;
    return p;
}

void test_chroma_ignores_brightness() {
    TEST("chroma coordinates ignore brightness")
    // The claim the whole design rests on: a screen lit unevenly still keys with
    // one tolerance, because luma is excluded from the distance.
    const ChromaPoint bright = rgb_to_chroma(0, 255, 0);
    const ChromaPoint dim = rgb_to_chroma(0, 128, 0);
    // Halving the light does move the point (chroma is not perfectly separable
    // in 8-bit RGB) but far less than the tolerance radius.
    const float d = std::hypot(bright.cb - dim.cb, bright.cr - dim.cr);
    CHECK(d < 0.15f);
}

void test_screen_keys_out() {
    TEST("the screen colour keys to fully transparent")
    const auto p = green_screen();
    CHECK_NEAR(key_alpha(p, 0, 255, 0), 0.0f, 0.001f);
    // And so does a slightly off, unevenly lit patch of the same screen.
    CHECK_NEAR(key_alpha(p, 20, 230, 30), 0.0f, 0.05f);
}

void test_subject_stays_opaque() {
    TEST("subject colours stay fully opaque")
    const auto p = green_screen();
    CHECK_NEAR(key_alpha(p, 220, 180, 160), 1.0f, 0.001f);  // skin
    CHECK_NEAR(key_alpha(p, 30, 40, 90), 1.0f, 0.001f);     // navy clothing
    CHECK_NEAR(key_alpha(p, 250, 250, 250), 1.0f, 0.001f);  // white
}

void test_falloff_is_monotonic_and_soft() {
    TEST("the falloff is monotonic across the softness band")
    const auto p = green_screen();
    // Walk from green toward grey; alpha must rise, never oscillate. A
    // non-monotonic key produces speckled edges.
    float previous = -1.0f;
    for (int step = 0; step <= 20; ++step) {
        const float t = step / 20.0f;
        const uint8_t r = static_cast<uint8_t>(t * 128);
        const uint8_t g = static_cast<uint8_t>(255 - t * 127);
        const uint8_t b = static_cast<uint8_t>(t * 128);
        const float a = key_alpha(p, r, g, b);
        CHECK(a >= previous - 0.001f);
        previous = a;
    }
    CHECK_NEAR(previous, 1.0f, 0.001f);
}

void test_dark_pixels_are_protected() {
    TEST("deep shadows stay opaque rather than punching holes")
    auto p = green_screen();
    p.luma_low = 0.05f;
    // Near-black carries essentially no chroma, so its measured distance is
    // noise. Without the guard, dark hair and black clothing develop holes —
    // one of the most common complaints about automatic keying.
    CHECK_NEAR(key_alpha(p, 2, 6, 3), 1.0f, 0.001f);
}

void test_spill_suppression_neutralises_without_greying() {
    TEST("spill suppression removes green cast without greying skin")
    const auto p = green_screen();

    // Skin with green light spilled onto it: green raised above its neighbours.
    uint8_t r = 220, g = 205, b = 160;
    suppress_spill(p, 1.0f, r, g, b);
    // Green is pulled down to the mean of red and blue...
    CHECK(g <= 191);
    // ...and the warm tones survive. Desaturation would have flattened these.
    CHECK(r >= 215);
    CHECK(b >= 155);
}

void test_spill_leaves_genuinely_green_objects_alone() {
    TEST("a genuinely green object keeps its colour")
    const auto p = green_screen();
    // A green jumper: green is high, but so is the pixel's own character. The
    // ceiling is the mean of the other channels, so a saturated green is
    // restrained — this is the honest limitation of channel-limiting spill
    // suppression, and why the UI exposes strength as a slider.
    uint8_t r = 40, g = 160, b = 50;
    const uint8_t before = g;
    suppress_spill(p, 1.0f, r, g, b);
    CHECK(g < before);
    // But red and blue are never touched, so the hue is not inverted.
    CHECK(r == 40);
    CHECK(b == 50);
}

void test_spill_skips_transparent_pixels() {
    TEST("fully transparent pixels are left untouched")
    const auto p = green_screen();
    uint8_t r = 0, g = 255, b = 0;
    suppress_spill(p, 0.0f, r, g, b);
    // Nothing is there to de-spill, and altering it would tint the edge when it
    // is later composited over the new background.
    CHECK(g == 255);
}

void test_key_image_reports_coverage() {
    TEST("keying an image reports how much was removed")
    const auto p = green_screen();
    std::vector<uint8_t> pixels(4 * 4 * 4);
    for (int i = 0; i < 16; ++i) {
        // Half green screen, half skin.
        const bool screen = i < 8;
        pixels[i * 4 + 0] = screen ? 0 : 220;
        pixels[i * 4 + 1] = screen ? 255 : 180;
        pixels[i * 4 + 2] = screen ? 0 : 160;
        pixels[i * 4 + 3] = 255;
    }

    const size_t removed = key_image_rgba(p, pixels.data(), 4, 4);
    // The count drives the UI's "this key removed almost everything" warning,
    // which is far more useful than showing the user a black preview.
    CHECK(removed == 8);
    CHECK(pixels[3] == 0);
    CHECK(pixels[8 * 4 + 3] == 255);
}

void test_key_image_rejects_bad_input() {
    TEST("degenerate input is refused rather than crashing")
    const auto p = green_screen();
    CHECK(key_image_rgba(p, nullptr, 4, 4) == 0);
    std::vector<uint8_t> one(4);
    CHECK(key_image_rgba(p, one.data(), 0, 0) == 0);
    CHECK(key_image_rgba(p, one.data(), -1, 4) == 0);
}

void test_choker_erodes_and_dilates() {
    TEST("the choker erodes and dilates the matte")
    const int w = 7, h = 7;
    std::vector<uint8_t> alpha(w * h, 0);
    std::vector<uint8_t> scratch(w * h);
    // A 3x3 opaque block in the middle.
    for (int y = 2; y <= 4; ++y)
        for (int x = 2; x <= 4; ++x) alpha[y * w + x] = 255;

    auto eroded = alpha;
    choke_alpha(eroded.data(), w, h, -1, scratch.data());
    // A one-pixel erode leaves only the centre.
    CHECK(eroded[3 * w + 3] == 255);
    CHECK(eroded[2 * w + 2] == 0);

    auto dilated = alpha;
    choke_alpha(dilated.data(), w, h, 1, scratch.data());
    CHECK(dilated[1 * w + 1] == 255);
    CHECK(dilated[0] == 0);
}

void test_feather_softens_without_shifting_the_edge() {
    TEST("feathering softens the edge without moving it")
    const int w = 32, h = 4;
    std::vector<uint8_t> alpha(w * h);
    std::vector<uint8_t> scratch(w * h);
    for (int y = 0; y < h; ++y)
        for (int x = 0; x < w; ++x) alpha[y * w + x] = x < w / 2 ? 0 : 255;

    feather_alpha(alpha.data(), w, h, 3, scratch.data());

    const uint8_t* row = alpha.data() + w;
    // Far from the edge, untouched.
    CHECK(row[2] < 10);
    CHECK(row[w - 3] > 245);
    // At the edge, a gradient rather than a step.
    CHECK(row[w / 2] > 10 && row[w / 2] < 245);
    // Monotonic across the transition: no ringing.
    for (int x = 1; x < w; ++x) CHECK(row[x] >= row[x - 1]);
}

void test_guided_upsample_snaps_to_the_luma_edge() {
    TEST("guided upsampling snaps a small matte onto the real image edge")
    // The claim that makes the fast tier viable: a matte inferred small, then
    // upsampled against full-resolution luma, lands on the true edge.
    const int lw = 8, lh = 8;
    const int w = 64, h = 64;

    // Low-res alpha: left half transparent, right half opaque.
    std::vector<uint8_t> low(lw * lh);
    for (int y = 0; y < lh; ++y)
        for (int x = 0; x < lw; ++x) low[y * lw + x] = x < lw / 2 ? 0 : 255;

    // Full-res guide with a hard edge at exactly the same relative position.
    std::vector<uint8_t> guide(w * h);
    for (int y = 0; y < h; ++y)
        for (int x = 0; x < w; ++x) guide[y * w + x] = x < w / 2 ? 0 : 255;

    std::vector<uint8_t> out(w * h);
    guided_upsample(low.data(), lw, lh, guide.data(), w, h, out.data(), 0.1f);

    const uint8_t* row = out.data() + 32 * w;
    // Well inside each region the answer is unambiguous.
    CHECK(row[4] < 40);
    CHECK(row[w - 4] > 215);

    // And the transition is confined near the true edge rather than smeared
    // across the whole eight-pixel low-res block it came from.
    int transition = 0;
    for (int x = 0; x < w; ++x)
        if (row[x] > 40 && row[x] < 215) ++transition;
    CHECK(transition <= 8);
}

void test_guided_upsample_handles_degenerate_input() {
    TEST("guided upsampling refuses degenerate input")
    std::vector<uint8_t> buf(16, 0);
    // Must not crash or write out of bounds; the render thread cannot afford it.
    guided_upsample(nullptr, 4, 4, buf.data(), 4, 4, buf.data(), 0.1f);
    guided_upsample(buf.data(), 0, 0, buf.data(), 4, 4, buf.data(), 0.1f);
    CHECK(true);
}

}  // namespace

int main() {
    std::printf("apex::matte host tests\n");

    test_chroma_ignores_brightness();
    test_screen_keys_out();
    test_subject_stays_opaque();
    test_falloff_is_monotonic_and_soft();
    test_dark_pixels_are_protected();
    test_spill_suppression_neutralises_without_greying();
    test_spill_leaves_genuinely_green_objects_alone();
    test_spill_skips_transparent_pixels();
    test_key_image_reports_coverage();
    test_key_image_rejects_bad_input();
    test_choker_erodes_and_dilates();
    test_feather_softens_without_shifting_the_edge();
    test_guided_upsample_snaps_to_the_luma_edge();
    test_guided_upsample_handles_degenerate_input();

    std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}

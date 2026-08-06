/**
 * The grading and compositing shader.
 *
 * This is the reference implementation of ApexEdit's colour pipeline. The Metal
 * and GLSL ES versions on iOS and Android execute the same operations in the
 * same order against the same `ResolvedGrade` struct, which is what makes a
 * project look identical everywhere it opens.
 *
 * Order matters and is fixed:
 *
 *   crop → chroma key → exposure → white balance → lift/gamma/gain/offset →
 *   contrast → tone regions → curves → HSL → saturation/vibrance → fade →
 *   vignette → grain → mask → opacity
 *
 * Grading happens in linear light (exposure, white balance, wheels), while the
 * curves and tone regions operate on the display-encoded signal, because that
 * is where their control points are meaningful to a user dragging them.
 */

export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

// Row-major affine [a, b, c, d, tx, ty] from the engine's render graph.
uniform vec2 u_matA;
uniform vec2 u_matB;
uniform vec2 u_translate;
uniform float u_aspect;      // frame aspect, to keep rotation circular
uniform vec4 u_crop;         // top, right, bottom, left as normalised insets
uniform vec2 u_sourceScale;  // aspect-fit of the source inside the frame

void main() {
  // a_position is a unit quad in -0.5..0.5.
  vec2 p = a_position;

  // Crop reshapes the quad before any transform, so cropping does not move the
  // clip's centre the way scaling the texture coordinates would.
  vec2 cropOffset = vec2(
    (u_crop.w - u_crop.y) * 0.5,
    (u_crop.z - u_crop.x) * 0.5
  );
  vec2 cropScale = vec2(
    1.0 - u_crop.y - u_crop.w,
    1.0 - u_crop.x - u_crop.z
  );
  p = p * cropScale + cropOffset;
  p *= u_sourceScale;

  // Apply the affine in aspect-corrected space so rotation is not sheared.
  vec2 q = vec2(p.x * u_aspect, p.y);
  vec2 transformed = vec2(
    u_matA.x * q.x + u_matB.x * q.y,
    u_matA.y * q.x + u_matB.y * q.y
  );
  transformed.x /= u_aspect;
  transformed += u_translate;

  v_uv = a_position + 0.5;
  // Flip Y: texture space is top-down, clip space is bottom-up.
  gl_Position = vec4(transformed.x * 2.0, -transformed.y * 2.0, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform sampler2D u_curveLut;   // 256x4: luma, r, g, b
uniform bool u_hasCurves;

uniform float u_opacity;
uniform vec4 u_crop;
uniform float u_cornerRadius;

// Grade — mirrors ResolvedGrade field for field.
uniform bool  u_hasGrade;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;
uniform float u_temperature;
uniform float u_tint;
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_vignette;
uniform float u_grain;
uniform float u_fade;
uniform vec4  u_lift;    // rgb + master
uniform vec4  u_gamma;
uniform vec4  u_gain;
uniform vec4  u_offset;

// Chroma key.
uniform bool  u_hasKey;
uniform vec3  u_keyColor;
uniform float u_keySimilarity;
uniform float u_keySmoothness;
uniform float u_keySpill;

// Elliptical mask.
uniform bool  u_hasMask;
uniform vec4  u_maskRect;   // cx, cy, rx, ry in uv space
uniform float u_maskFeather;
uniform bool  u_maskInvert;

uniform float u_time;       // seconds, drives grain

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// Rec.709 transfer functions. Grading in linear light is the whole point of
// doing this in a shader rather than with CSS filters.
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 toDisplay(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 applyWheels(vec3 c) {
  // Lift raises the floor, gain scales the ceiling, gamma bends the middle —
  // the standard three-way relationship, with offset as a flat add.
  vec3 lift = u_lift.rgb + u_lift.a;
  vec3 gain = u_gain.rgb + u_gain.a;
  vec3 gamma = u_gamma.rgb + u_gamma.a;
  vec3 offset = u_offset.rgb + u_offset.a;

  c = c * (1.0 + gain) + lift * (1.0 - c) + offset;
  c = max(c, 0.0);
  vec3 g = clamp(1.0 - gamma, 0.2, 5.0);
  return pow(c, g);
}

vec3 applyToneRegions(vec3 c) {
  float l = dot(c, LUMA);

  // Smooth region weights so adjustments blend instead of banding at the seams.
  float shadowW = 1.0 - smoothstep(0.0, 0.5, l);
  float highlightW = smoothstep(0.5, 1.0, l);
  float blackW = 1.0 - smoothstep(0.0, 0.25, l);
  float whiteW = smoothstep(0.75, 1.0, l);

  c += u_shadows * 0.5 * shadowW;
  c += u_highlights * 0.5 * highlightW;
  c += u_blacks * 0.3 * blackW;
  c += u_whites * 0.3 * whiteW;
  return c;
}

vec3 applyWhiteBalance(vec3 c) {
  // A cheap but well-behaved approximation: push red against blue for
  // temperature, green against magenta for tint.
  float t = u_temperature * 0.35;
  float g = u_tint * 0.35;
  c.r *= 1.0 + t;
  c.b *= 1.0 - t;
  c.g *= 1.0 + g;
  return c;
}

vec3 applySaturation(vec3 c) {
  float l = dot(c, LUMA);
  c = mix(vec3(l), c, 1.0 + u_saturation);

  if (abs(u_vibrance) > 0.001) {
    // Vibrance weights the adjustment towards pixels that are not already
    // saturated, which is what keeps skin tones from going first.
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float sat = mx - mn;
    float weight = 1.0 - smoothstep(0.0, 0.8, sat);
    c = mix(vec3(dot(c, LUMA)), c, 1.0 + u_vibrance * weight);
  }
  return c;
}

vec3 applyCurves(vec3 c) {
  if (!u_hasCurves) return c;
  // Luma curve first, then per-channel, matching how the UI stacks them.
  float lr = texture(u_curveLut, vec2(clamp(c.r, 0.0, 1.0), 0.125)).r;
  float lg = texture(u_curveLut, vec2(clamp(c.g, 0.0, 1.0), 0.125)).r;
  float lb = texture(u_curveLut, vec2(clamp(c.b, 0.0, 1.0), 0.125)).r;
  c = vec3(lr, lg, lb);

  c.r = texture(u_curveLut, vec2(clamp(c.r, 0.0, 1.0), 0.375)).r;
  c.g = texture(u_curveLut, vec2(clamp(c.g, 0.0, 1.0), 0.625)).r;
  c.b = texture(u_curveLut, vec2(clamp(c.b, 0.0, 1.0), 0.875)).r;
  return c;
}

float chromaAlpha(vec3 c) {
  // Key in chroma distance rather than RGB distance, so brightness variation
  // across a poorly lit screen does not punch holes in the subject.
  vec2 cbcr = vec2(c.b - dot(c, LUMA), c.r - dot(c, LUMA));
  vec2 keyCbCr = vec2(
    u_keyColor.b - dot(u_keyColor, LUMA),
    u_keyColor.r - dot(u_keyColor, LUMA)
  );
  float d = distance(cbcr, keyCbCr);
  return smoothstep(u_keySimilarity, u_keySimilarity + u_keySmoothness + 0.001, d);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec4 texel = texture(u_texture, v_uv);
  vec3 c = texel.rgb;
  float alpha = texel.a * u_opacity;

  if (u_hasKey) {
    float keyA = chromaAlpha(c);
    alpha *= keyA;
    if (u_keySpill > 0.001) {
      // Pull the keyed channel back towards the other two to kill green spill.
      float l = dot(c, LUMA);
      c = mix(c, vec3(l), u_keySpill * (1.0 - keyA) * 0.9);
    }
  }

  if (u_hasGrade) {
    vec3 lin = toLinear(c);
    lin *= pow(2.0, u_exposure);
    lin = applyWhiteBalance(lin);
    lin = applyWheels(lin);
    c = toDisplay(lin);

    // Contrast pivots on middle grey so it does not also shift exposure.
    c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
    c = applyToneRegions(c);
    c = applyCurves(c);
    c = applySaturation(c);

    // Fade lifts the black point for the washed film look.
    c = mix(c, c * (1.0 - u_fade) + u_fade * 0.35, step(0.001, u_fade));

    if (u_vignette > 0.001) {
      float d = distance(v_uv, vec2(0.5)) * 1.41421;
      c *= 1.0 - u_vignette * smoothstep(0.35, 1.0, d);
    }

    if (u_grain > 0.001) {
      float n = hash(v_uv * 1024.0 + u_time * 60.0) - 0.5;
      c += n * u_grain * 0.25;
    }
  }

  if (u_hasMask) {
    vec2 d = (v_uv - u_maskRect.xy) / max(u_maskRect.zw, vec2(0.0001));
    float dist = length(d);
    float feather = max(u_maskFeather, 0.001);
    float inside = 1.0 - smoothstep(1.0 - feather, 1.0 + feather, dist);
    alpha *= u_maskInvert ? 1.0 - inside : inside;
  }

  if (u_cornerRadius > 0.001) {
    vec2 p = abs(v_uv - 0.5) - (0.5 - u_cornerRadius);
    float d = length(max(p, 0.0)) - u_cornerRadius;
    alpha *= 1.0 - smoothstep(-0.002, 0.002, d);
  }

  fragColor = vec4(clamp(c, 0.0, 1.0) * alpha, alpha);
}
`;

import {
  curveToLut,
  isIdentityCurves,
  type BlendMode,
  type RenderFrame,
  type RenderLayer,
  type ResolvedGrade,
} from '@apex/edit-engine';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders.js';

/**
 * WebGL2 compositor.
 *
 * Executes a `RenderFrame` from the engine. It knows nothing about the
 * document, the timeline or the UI — it is handed a fully resolved description
 * and draws it, which is exactly the contract the native renderers implement.
 *
 * Layers are drawn back to front with premultiplied alpha. Separable blend
 * modes go through fixed-function blending; the non-separable ones (hue,
 * saturation, colour, luminosity) would need a second pass against a copy of
 * the framebuffer and fall back to normal here, which is called out rather than
 * silently wrong.
 */

export interface TextureSource {
  /** Anything `texImage2D` accepts. */
  readonly source: TexImageSource;
  readonly width: number;
  readonly height: number;
}

/** Resolves a layer to something drawable. Returns null to skip the layer. */
export type SourceResolver = (layer: RenderLayer) => TextureSource | null;

const SEPARABLE_BLEND: Partial<Record<BlendMode, [number, number]>> = {
  // [srcFactor, dstFactor] against premultiplied alpha.
  normal: [1, 0x0303], // ONE, ONE_MINUS_SRC_ALPHA
  add: [1, 1],
  screen: [1, 0x0301], // ONE, ONE_MINUS_SRC_COLOR
  multiply: [0x0306, 0x0303], // DST_COLOR, ONE_MINUS_SRC_ALPHA
};

export class Compositor {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private textures = new WeakMap<object, WebGLTexture>();
  private curveTexture: WebGLTexture;
  private fallbackTexture: WebGLTexture;
  /** Blend modes requested that this renderer cannot do in one pass. */
  readonly unsupportedBlendModes = new Set<BlendMode>();

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: true,
    });
    if (!gl) throw new Error('WebGL2 is required for the preview.');
    this.gl = gl;

    this.program = this.link(VERTEX_SHADER, FRAGMENT_SHADER);
    this.vao = this.buildQuad();
    this.curveTexture = this.createCurveTexture();
    this.fallbackTexture = this.createSolidTexture([0, 0, 0, 0]);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Draw a frame. `resolve` supplies the pixels for each media layer. */
  render(frame: RenderFrame, resolve: SourceResolver, timeSeconds: number): void {
    const gl = this.gl;
    const { width, height } = frame.resolution;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);

    const bg = hexToRgb(frame.backgroundColor);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    const frameAspect = width / height;

    for (let i = 0; i < frame.layers.length; i++) {
      const layer = frame.layers[i];
      const texture = this.resolveTexture(layer, resolve);
      if (!texture) continue;

      // A transition scales the two sides' opacity against each other. Only
      // cross-dissolve is a pure opacity blend; the wipes need geometry the
      // reference renderer does not implement, so they dissolve instead.
      let opacity = layer.opacity;
      for (const t of frame.transitions) {
        if (t.fromLayer === i) opacity *= 1 - t.progress;
        if (t.toLayer === i) opacity *= t.progress;
      }
      if (opacity <= 0.001) continue;

      this.applyBlendMode(layer.blendMode);
      this.setLayerUniforms(layer, texture, opacity, frameAspect, timeSeconds);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.bindVertexArray(null);
  }

  private resolveTexture(
    layer: RenderLayer,
    resolve: SourceResolver,
  ): { texture: WebGLTexture; aspect: number } | null {
    const gl = this.gl;

    if (layer.source.kind === 'color' || layer.source.kind === 'shape') {
      const rgb = hexToRgb(layer.source.color);
      return { texture: this.createSolidTexture([...rgb, 1]), aspect: 0 };
    }
    if (layer.source.kind === 'adjustment') return null;

    const resolved = resolve(layer);
    if (!resolved) return null;

    let texture = this.textures.get(resolved.source as object);
    if (!texture) {
      texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.textures.set(resolved.source as object, texture);
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Video frames change every tick, so the upload is unconditional; a native
    // renderer would import the decoder's buffer instead of copying.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, resolved.source);

    return {
      texture,
      aspect: resolved.height > 0 ? resolved.width / resolved.height : 0,
    };
  }

  private setLayerUniforms(
    layer: RenderLayer,
    resolved: { texture: WebGLTexture; aspect: number },
    opacity: number,
    frameAspect: number,
    timeSeconds: number,
  ): void {
    const gl = this.gl;
    const m = layer.matrix;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resolved.texture);
    gl.uniform1i(this.uniform('u_texture'), 0);

    gl.uniform2f(this.uniform('u_matA'), m[0], m[1]);
    gl.uniform2f(this.uniform('u_matB'), m[2], m[3]);
    gl.uniform2f(this.uniform('u_translate'), m[4], m[5]);
    gl.uniform1f(this.uniform('u_aspect'), frameAspect);
    gl.uniform1f(this.uniform('u_opacity'), opacity);
    gl.uniform1f(this.uniform('u_time'), timeSeconds);
    gl.uniform1f(this.uniform('u_cornerRadius'), Math.min(0.5, layer.cornerRadius));

    const { top, right, bottom, left } = layer.crop;
    gl.uniform4f(this.uniform('u_crop'), top, right, bottom, left);

    // Aspect-fit the source inside the frame, so a 16:9 clip on a 9:16 timeline
    // letterboxes rather than stretching.
    const sourceAspect = resolved.aspect || frameAspect;
    const scale =
      sourceAspect > frameAspect
        ? [1, frameAspect / sourceAspect]
        : [sourceAspect / frameAspect, 1];
    gl.uniform2f(this.uniform('u_sourceScale'), scale[0], scale[1]);

    this.setGradeUniforms(layer.grade, timeSeconds);
    this.setKeyUniforms(layer);
    this.setMaskUniforms(layer);
  }

  private setGradeUniforms(grade: ResolvedGrade | null, _time: number): void {
    const gl = this.gl;
    gl.uniform1i(this.uniform('u_hasGrade'), grade ? 1 : 0);
    if (!grade) {
      gl.uniform1i(this.uniform('u_hasCurves'), 0);
      return;
    }

    const f = (name: string, value: number) => gl.uniform1f(this.uniform(name), value);
    f('u_exposure', grade.exposure);
    f('u_contrast', grade.contrast);
    f('u_highlights', grade.highlights);
    f('u_shadows', grade.shadows);
    f('u_whites', grade.whites);
    f('u_blacks', grade.blacks);
    f('u_temperature', grade.temperature);
    f('u_tint', grade.tint);
    f('u_saturation', grade.saturation);
    f('u_vibrance', grade.vibrance);
    f('u_vignette', grade.vignette);
    f('u_grain', grade.grain);
    f('u_fade', grade.fade);

    const wheel = (name: string, w: ResolvedGrade['lift']) =>
      gl.uniform4f(this.uniform(name), w.r, w.g, w.b, w.master);
    wheel('u_lift', grade.lift);
    wheel('u_gamma', grade.gamma);
    wheel('u_gain', grade.gain);
    wheel('u_offset', grade.offset);

    const hasCurves = !isIdentityCurves(grade.curves);
    gl.uniform1i(this.uniform('u_hasCurves'), hasCurves ? 1 : 0);
    if (hasCurves) {
      this.uploadCurves(grade);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
      gl.uniform1i(this.uniform('u_curveLut'), 1);
    }
  }

  private setKeyUniforms(layer: RenderLayer): void {
    const gl = this.gl;
    const key = layer.chromaKey;
    gl.uniform1i(this.uniform('u_hasKey'), key ? 1 : 0);
    if (!key) return;
    const rgb = hexToRgb(key.keyColor);
    gl.uniform3f(this.uniform('u_keyColor'), rgb[0], rgb[1], rgb[2]);
    gl.uniform1f(this.uniform('u_keySimilarity'), key.similarity * 0.5);
    gl.uniform1f(this.uniform('u_keySmoothness'), key.smoothness * 0.5);
    gl.uniform1f(this.uniform('u_keySpill'), key.spillSuppression);
  }

  private setMaskUniforms(layer: RenderLayer): void {
    const gl = this.gl;
    // The reference renderer supports one elliptical mask; polygon and freehand
    // masks need a stencil pass the native renderers provide.
    const mask = layer.masks.find((m) => m.shape === 'ellipse' || m.shape === 'rectangle');
    gl.uniform1i(this.uniform('u_hasMask'), mask ? 1 : 0);
    if (!mask || mask.points.length < 2) {
      gl.uniform1i(this.uniform('u_hasMask'), 0);
      return;
    }
    const [a, b] = mask.points;
    const cx = (a.x + b.x) / 2 + 0.5;
    const cy = (a.y + b.y) / 2 + 0.5;
    const rx = Math.abs(b.x - a.x) / 2 + mask.expansion;
    const ry = Math.abs(b.y - a.y) / 2 + mask.expansion;
    gl.uniform4f(this.uniform('u_maskRect'), cx, cy, Math.max(rx, 0.001), Math.max(ry, 0.001));
    gl.uniform1f(this.uniform('u_maskFeather'), Math.max(mask.feather, 0.001));
    gl.uniform1i(this.uniform('u_maskInvert'), mask.inverted ? 1 : 0);
  }

  private applyBlendMode(mode: BlendMode): void {
    const gl = this.gl;
    const factors = SEPARABLE_BLEND[mode];
    if (!factors) {
      // Record it so the UI can tell the user this mode previews approximately
      // rather than pretending the preview is accurate.
      if (mode !== 'normal') this.unsupportedBlendModes.add(mode);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      return;
    }
    gl.blendFunc(factors[0], factors[1]);
  }

  private uploadCurves(grade: ResolvedGrade): void {
    const gl = this.gl;
    const size = 256;
    const data = new Uint8Array(size * 4);
    const rows = [grade.curves.luma, grade.curves.red, grade.curves.green, grade.curves.blue];
    for (let row = 0; row < 4; row++) {
      const lut = curveToLut(rows[row], size);
      for (let i = 0; i < size; i++) {
        data[row * size + i] = Math.round(lut[i] * 255);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, 4, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  }

  private createCurveTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  private solidCache = new Map<string, WebGLTexture>();

  private createSolidTexture(rgba: number[]): WebGLTexture {
    const key = rgba.join(',');
    const cached = this.solidCache.get(key);
    if (cached) return cached;

    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(rgba.map((v) => Math.round(v * 255))),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.solidCache.set(key, texture);
    return texture;
  }

  private uniform(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.uniforms.get(name) ?? null;
  }

  private buildQuad(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // Triangle strip over a unit quad centred on the origin.
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
      gl.STATIC_DRAW,
    );

    const location = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  private link(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, this.compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, this.compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

/**
 * WindGL — GPU-accelerated wind particle visualization.
 *
 * TypeScript adaptation of mapbox/webgl-wind with all GLSL shaders and
 * utility helpers inlined so the module is fully self-contained (no GLSL
 * imports, no external dependencies).
 *
 * Original: https://github.com/mapbox/webgl-wind
 * License: ISC
 */

// ---------------------------------------------------------------------------
// GLSL shaders (inlined as template literals)
// ---------------------------------------------------------------------------

const drawVert = `\
precision mediump float;

attribute float a_index;

uniform sampler2D u_particles;
uniform float u_particles_res;
uniform vec4 u_bounds; // x=west(lon), y=mercSouth, z=east(lon), w=mercNorth

varying vec2 v_particle_pos;

const float PI = 3.14159265;

void main() {
    vec4 color = texture2D(u_particles, vec2(
        fract(a_index / u_particles_res),
        floor(a_index / u_particles_res) / u_particles_res));

    v_particle_pos = vec2(
        color.r / 255.0 + color.b,
        color.g / 255.0 + color.a);

    // Equirectangular pos [0,1] -> lon/lat degrees
    float lon = v_particle_pos.x * 360.0 - 180.0;
    float lat_deg = 90.0 - v_particle_pos.y * 180.0;

    // Lat -> Mercator Y
    float lat_rad = radians(clamp(lat_deg, -85.0, 85.0));
    float merc_y = log(tan(PI / 4.0 + lat_rad / 2.0));

    // Map to clip space [-1,1] using visible bounds
    float clip_x = (lon - u_bounds.x) / (u_bounds.z - u_bounds.x) * 2.0 - 1.0;
    float clip_y = (merc_y - u_bounds.y) / (u_bounds.w - u_bounds.y) * 2.0 - 1.0;

    gl_PointSize = 1.0;
    gl_Position = vec4(clip_x, clip_y, 0.0, 1.0);
}
`;

const drawFrag = `\
precision mediump float;

uniform sampler2D u_wind;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform sampler2D u_color_ramp;

varying vec2 v_particle_pos;

void main() {
    vec2 velocity = mix(u_wind_min, u_wind_max, texture2D(u_wind, v_particle_pos).rg);
    float speed_t = length(velocity) / length(u_wind_max);

    // color ramp is encoded in a 16x16 texture
    vec2 ramp_pos = vec2(
        fract(16.0 * speed_t),
        floor(16.0 * speed_t) / 16.0);

    gl_FragColor = texture2D(u_color_ramp, ramp_pos);
}
`;

const quadVert = `\
precision mediump float;

attribute vec2 a_pos;

varying vec2 v_tex_pos;

void main() {
    v_tex_pos = a_pos;
    gl_Position = vec4(1.0 - 2.0 * a_pos, 0, 1);
}
`;

const screenFrag = `\
precision mediump float;

uniform sampler2D u_screen;
uniform float u_opacity;

varying vec2 v_tex_pos;

void main() {
    vec4 color = texture2D(u_screen, 1.0 - v_tex_pos);
    gl_FragColor = vec4(floor(255.0 * color * u_opacity) / 255.0);
}
`;

const updateFrag = `\
precision highp float;

uniform sampler2D u_particles;
uniform sampler2D u_wind;
uniform vec2 u_wind_res;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform float u_rand_seed;
uniform float u_speed_factor;
uniform float u_drop_rate;
uniform float u_drop_rate_bump;

varying vec2 v_tex_pos;

// pseudo-random generator
const vec3 rand_constants = vec3(12.9898, 78.233, 4375.85453);
float rand(const vec2 co) {
    float t = dot(rand_constants.xy, co);
    return fract(sin(t) * (rand_constants.z + t));
}

// wind speed lookup; use manual bilinear filtering based on 4 adjacent pixels for smooth interpolation
vec2 lookup_wind(const vec2 uv) {
    vec2 px = 1.0 / u_wind_res;
    vec2 vc = (floor(uv * u_wind_res)) * px;
    vec2 f = fract(uv * u_wind_res);
    vec2 tl = texture2D(u_wind, vc).rg;
    vec2 tr = texture2D(u_wind, vc + vec2(px.x, 0)).rg;
    vec2 bl = texture2D(u_wind, vc + vec2(0, px.y)).rg;
    vec2 br = texture2D(u_wind, vc + px).rg;
    return mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y);
}

void main() {
    vec4 color = texture2D(u_particles, v_tex_pos);
    vec2 pos = vec2(
        color.r / 255.0 + color.b,
        color.g / 255.0 + color.a); // decode particle position from pixel RGBA

    vec2 velocity = mix(u_wind_min, u_wind_max, lookup_wind(pos));
    float speed_t = length(velocity) / length(u_wind_max);

    // take EPSG:4326 distortion into account for calculating where the particle moved
    float distortion = cos(radians(pos.y * 180.0 - 90.0));
    vec2 offset = vec2(velocity.x / distortion, -velocity.y) * 0.0001 * u_speed_factor;

    // update particle position, wrapping around the date line
    pos = fract(1.0 + pos + offset);

    // a random seed to use for the particle drop
    vec2 seed = (pos + v_tex_pos) * u_rand_seed;

    // drop rate is a chance a particle will restart at random position, to avoid degeneration
    float drop_rate = u_drop_rate + speed_t * u_drop_rate_bump;
    float drop = step(1.0 - drop_rate, rand(seed));

    vec2 random_pos = vec2(
        rand(seed + 1.3),
        rand(seed + 2.1));
    pos = mix(pos, random_pos, drop);

    // encode the new particle position back into RGBA
    gl_FragColor = vec4(
        fract(pos * 255.0),
        floor(pos * 255.0) / 255.0);
}
`;

// ---------------------------------------------------------------------------
// WebGL utility helpers
// ---------------------------------------------------------------------------

/** Dynamic property bag returned by createProgram — holds .program plus attribute/uniform locations. */
interface ProgramInfo {
  program: WebGLProgram;
  [key: string]: WebGLProgram | number | WebGLUniformLocation | null;
}

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed');
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string): ProgramInfo {
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Program link failed');
  }

  const wrapper: ProgramInfo = { program };

  const numAttributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) as number;
  for (let i = 0; i < numAttributes; i++) {
    const attribute = gl.getActiveAttrib(program, i);
    if (attribute) {
      wrapper[attribute.name] = gl.getAttribLocation(program, attribute.name);
    }
  }
  const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < numUniforms; i++) {
    const uniform = gl.getActiveUniform(program, i);
    if (uniform) {
      wrapper[uniform.name] = gl.getUniformLocation(program, uniform.name);
    }
  }

  return wrapper;
}

function createTexture(
  gl: WebGLRenderingContext,
  filter: number,
  data: Uint8Array | HTMLImageElement,
  width?: number,
  height?: number,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  if (data instanceof Uint8Array) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width!, height!, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

function bindTexture(gl: WebGLRenderingContext, texture: WebGLTexture, unit: number): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
}

function createBuffer(gl: WebGLRenderingContext, data: Float32Array): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('Failed to create buffer');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

function bindAttribute(gl: WebGLRenderingContext, buffer: WebGLBuffer, attribute: number, numComponents: number): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, numComponents, gl.FLOAT, false, 0, 0);
}

function bindFramebuffer(gl: WebGLRenderingContext, framebuffer: WebGLFramebuffer | null, texture?: WebGLTexture): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  if (texture) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  }
}

// ---------------------------------------------------------------------------
// Color ramp helper
// ---------------------------------------------------------------------------

const defaultRampColors: Record<number, string> = {
  0.0: '#3c8cc8',  // calm — soft blue
  0.15: '#50bea8', // light — teal
  0.3: '#6cd28a',  // moderate — green
  0.45: '#82d264', // fresh — yellow-green
  0.6: '#dcc846',  // strong — yellow
  0.75: '#dc9628', // very strong — orange
  0.9: '#c06020',  // gale — dark orange
  1.0: '#c83828',  // storm — red
};

function getColorRamp(colors: Record<number, string>): Uint8Array {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2d context for color ramp');

  canvas.width = 256;
  canvas.height = 1;

  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  for (const stop in colors) {
    gradient.addColorStop(+stop, colors[+stop]!);
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1);

  return new Uint8Array(ctx.getImageData(0, 0, 256, 1).data);
}

// ---------------------------------------------------------------------------
// WindData interface
// ---------------------------------------------------------------------------

export interface WindData {
  width: number;
  height: number;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  image: HTMLImageElement;
}

// ---------------------------------------------------------------------------
// WindGL class
// ---------------------------------------------------------------------------

export class WindGL {
  private gl: WebGLRenderingContext;

  fadeOpacity = 0.993;   // moderate trails
  speedFactor = 0.03;    // very slow drift like VR/Canvas 2D
  dropRate = 0.01;       // higher respawn = more visible particles in viewport
  dropRateBump = 0.005;  // slight speed-dependent respawn

  private drawProgram: ProgramInfo;
  private screenProgram: ProgramInfo;
  private updateProgram: ProgramInfo;

  private quadBuffer: WebGLBuffer;
  private framebuffer: WebGLFramebuffer;

  private backgroundTexture!: WebGLTexture;
  private screenTexture!: WebGLTexture;
  private colorRampTexture!: WebGLTexture;

  private particleStateResolution!: number;
  private _numParticles!: number;
  private particleStateTexture0!: WebGLTexture;
  private particleStateTexture1!: WebGLTexture;
  private particleIndexBuffer!: WebGLBuffer;

  windData: WindData | null = null;
  private windTexture!: WebGLTexture;

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;

    this.drawProgram = createProgram(gl, drawVert, drawFrag);
    this.screenProgram = createProgram(gl, quadVert, screenFrag);
    this.updateProgram = createProgram(gl, quadVert, updateFrag);

    this.quadBuffer = createBuffer(gl, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));

    const fb = gl.createFramebuffer();
    if (!fb) throw new Error('Failed to create framebuffer');
    this.framebuffer = fb;

    this.setColorRamp(defaultRampColors);
    this.resize();
  }

  resize(): void {
    const gl = this.gl;
    const emptyPixels = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    this.backgroundTexture = createTexture(gl, gl.NEAREST, emptyPixels, gl.canvas.width, gl.canvas.height);
    this.screenTexture = createTexture(gl, gl.NEAREST, emptyPixels, gl.canvas.width, gl.canvas.height);
  }

  setColorRamp(colors: Record<number, string>): void {
    this.colorRampTexture = createTexture(this.gl, this.gl.LINEAR, getColorRamp(colors), 16, 16);
  }

  set numParticles(numParticles: number) {
    const gl = this.gl;

    const particleRes = (this.particleStateResolution = Math.ceil(Math.sqrt(numParticles)));
    this._numParticles = particleRes * particleRes;

    const particleState = new Uint8Array(this._numParticles * 4);
    for (let i = 0; i < particleState.length; i++) {
      particleState[i] = Math.floor(Math.random() * 256);
    }
    this.particleStateTexture0 = createTexture(gl, gl.NEAREST, particleState, particleRes, particleRes);
    this.particleStateTexture1 = createTexture(gl, gl.NEAREST, particleState, particleRes, particleRes);

    const particleIndices = new Float32Array(this._numParticles);
    for (let i = 0; i < this._numParticles; i++) particleIndices[i] = i;
    this.particleIndexBuffer = createBuffer(gl, particleIndices);
  }

  get numParticles(): number {
    return this._numParticles;
  }

  setWind(windData: WindData): void {
    this.windData = windData;
    this.windTexture = createTexture(this.gl, this.gl.LINEAR, windData.image);
  }

  draw(bounds: { west: number; south: number; east: number; north: number }): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);

    bindTexture(gl, this.windTexture, 0);
    bindTexture(gl, this.particleStateTexture0, 1);

    this.drawScreen(bounds);
    this.updateParticles();
  }

  private drawScreen(bounds: { west: number; south: number; east: number; north: number }): void {
    const gl = this.gl;
    bindFramebuffer(gl, this.framebuffer, this.screenTexture);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    this.drawTexture(this.backgroundTexture, this.fadeOpacity);
    this.drawParticles(bounds);

    bindFramebuffer(gl, null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.drawTexture(this.screenTexture, 1.0);
    gl.disable(gl.BLEND);

    const temp = this.backgroundTexture;
    this.backgroundTexture = this.screenTexture;
    this.screenTexture = temp;
  }

  private drawTexture(texture: WebGLTexture, opacity: number): void {
    const gl = this.gl;
    const program = this.screenProgram;
    gl.useProgram(program.program as WebGLProgram);

    bindAttribute(gl, this.quadBuffer, program.a_pos as number, 2);
    bindTexture(gl, texture, 2);
    gl.uniform1i(program.u_screen as WebGLUniformLocation, 2);
    gl.uniform1f(program.u_opacity as WebGLUniformLocation, opacity);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private drawParticles(bounds: { west: number; south: number; east: number; north: number }): void {
    const gl = this.gl;
    const program = this.drawProgram;
    gl.useProgram(program.program as WebGLProgram);

    bindAttribute(gl, this.particleIndexBuffer, program.a_index as number, 1);
    bindTexture(gl, this.colorRampTexture, 2);

    gl.uniform1i(program.u_wind as WebGLUniformLocation, 0);
    gl.uniform1i(program.u_particles as WebGLUniformLocation, 1);
    gl.uniform1i(program.u_color_ramp as WebGLUniformLocation, 2);

    gl.uniform1f(program.u_particles_res as WebGLUniformLocation, this.particleStateResolution);
    gl.uniform2f(program.u_wind_min as WebGLUniformLocation, this.windData!.uMin, this.windData!.vMin);
    gl.uniform2f(program.u_wind_max as WebGLUniformLocation, this.windData!.uMax, this.windData!.vMax);

    // Convert lat bounds to Mercator Y
    const toRad = Math.PI / 180;
    const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * toRad) / 2));
    gl.uniform4f(
      program.u_bounds as WebGLUniformLocation,
      bounds.west, mercY(bounds.south), bounds.east, mercY(bounds.north),
    );

    gl.drawArrays(gl.POINTS, 0, this._numParticles);
  }

  private updateParticles(): void {
    const gl = this.gl;
    bindFramebuffer(gl, this.framebuffer, this.particleStateTexture1);
    gl.viewport(0, 0, this.particleStateResolution, this.particleStateResolution);

    const program = this.updateProgram;
    gl.useProgram(program.program as WebGLProgram);

    bindAttribute(gl, this.quadBuffer, program.a_pos as number, 2);

    gl.uniform1i(program.u_wind as WebGLUniformLocation, 0);
    gl.uniform1i(program.u_particles as WebGLUniformLocation, 1);

    gl.uniform1f(program.u_rand_seed as WebGLUniformLocation, Math.random());
    gl.uniform2f(program.u_wind_res as WebGLUniformLocation, this.windData!.width, this.windData!.height);
    gl.uniform2f(program.u_wind_min as WebGLUniformLocation, this.windData!.uMin, this.windData!.vMin);
    gl.uniform2f(program.u_wind_max as WebGLUniformLocation, this.windData!.uMax, this.windData!.vMax);
    gl.uniform1f(program.u_speed_factor as WebGLUniformLocation, this.speedFactor);
    gl.uniform1f(program.u_drop_rate as WebGLUniformLocation, this.dropRate);
    gl.uniform1f(program.u_drop_rate_bump as WebGLUniformLocation, this.dropRateBump);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // swap the particle state textures so the new one becomes the current one
    const temp = this.particleStateTexture0;
    this.particleStateTexture0 = this.particleStateTexture1;
    this.particleStateTexture1 = temp;
  }
}

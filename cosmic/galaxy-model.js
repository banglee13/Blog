import * as THREE from './vendor/three.module.min.js'
import { articlePosition } from './galaxy-catalog.js'

const TAU = Math.PI * 2
const lerp = (a, b, t) => a + (b - a) * t

// Repeatable 3-D stellar populations. The arm density, interstellar extinction
// and stellar temperatures are sampled once; interaction only moves the camera.
function makeRandom(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
}
const randomField = makeRandom(80142)
const noiseGrid = Float32Array.from({ length: 128 * 128 }, randomField)
function noise(x, y) {
  const i = Math.floor(x),
    j = Math.floor(y)
  let u = x - i,
    v = y - j
  u = u * u * (3 - 2 * u)
  v = v * v * (3 - 2 * v)
  const a = (j & 127) * 128,
    b = ((j + 1) & 127) * 128,
    x0 = i & 127,
    x1 = (i + 1) & 127
  return lerp(
    lerp(noiseGrid[a + x0], noiseGrid[a + x1], u),
    lerp(noiseGrid[b + x0], noiseGrid[b + x1], u),
    v,
  )
}

const POINT_VERTEX = /* glsl */ `
  attribute vec4 pigment;
  attribute float diameter;
  uniform float scale;
  uniform float pixelRatio;
  uniform float shimmerTime;
  uniform float shimmerWeight;
  varying vec4 tint;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(diameter * scale / -mv.z, .75 * pixelRatio, 108.0 * pixelRatio);
    tint = pigment;
    if (shimmerWeight > 0.0) {
      // Nearby points have unrelated phases, so whole layers never flash in sync.
      float phase = dot(position, vec3(127.1, 311.7, 74.7));
      float rate = 0.9 + 1.4 * fract(phase);
      tint.a *= 1.0 + shimmerWeight * sin(shimmerTime * rate + phase);
    }
  }`
const POINT_FRAGMENT = /* glsl */ `
  varying vec4 tint;
  void main() {
    vec2 xy = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(xy, xy);
    if (r2 > 1.) discard;
    float alpha = exp(-r2 * 5.3) * (1.0-r2);
    gl_FragColor = vec4(tint.rgb, tint.a * alpha);
  }`
const BEACON_FRAGMENT = /* glsl */ `
  varying vec4 tint;
  void main() {
    vec2 p = abs(gl_PointCoord*2.-1.);
    float r = length(p);
    if (r>1.) discard;
    float glow = exp(-r*6.)*.63 + exp(-r*r*260.)*.85;
    float rays = (.12*exp(-p.x*96.-p.y*4.3)+.15*exp(-p.y*105.-p.x*3.7))*(1.-r);
    gl_FragColor=vec4(mix(tint.rgb,vec3(1.),exp(-r*r*140.)),(glow+rays)*tint.a);
  }`

function population(count, sample, radiant = false) {
  const coordinates = new Float32Array(count * 3)
  const colors = new Uint8Array(count * 4)
  const diameters = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const p = sample(i)
    coordinates.set(p.slice(0, 3), i * 3)
    for (let k = 0; k < 4; k++)
      colors[i * 4 + k] = Math.max(0, Math.min(255, Math.round(p[3 + k] * 255)))
    diameters[i] = p[7]
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(coordinates, 3))
  geometry.setAttribute('pigment', new THREE.BufferAttribute(colors, 4, true))
  geometry.setAttribute('diameter', new THREE.BufferAttribute(diameters, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: {
      scale: { value: 2000 },
      pixelRatio: { value: 1 },
      shimmerTime: { value: 0 },
      shimmerWeight: { value: 0 },
    },
    vertexShader: POINT_VERTEX,
    fragmentShader: radiant ? BEACON_FRAGMENT : POINT_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  })
  const batch = new THREE.Points(geometry, material)
  batch.frustumCulled = false
  return batch
}

export function makeGalaxyModel(articles) {
  const random = makeRandom(197904)
  const bell = () => random() + random() + random() + random() - 2
  const clip = (x) => Math.max(0, Math.min(1, x))
  const golden = [1, 0.4, 0.09],
    pearl = [1, 0.85, 0.59]
  // Three major streams and a shorter spur. Most light is in the ridges;
  // the intervening disc stays dark enough to see their silhouette.
  const armPhase = (r) => 4.1 * Math.log(1 + r / 0.27) - 2.2
  const branches = [0, 2.34, 4.3, 0.46]
  const starts = [0.074, 0.1, 0.19, 0.49]
  const ends = [1.14, 1.04, 0.96, 1.12]
  const nebulae = [
    [
      [1, 0.33, 0.05],
      [0.91, 0.08, 0.29],
      [0.35, 0.088, 0.98],
      [0.08, 0.63, 0.94],
    ],
    [
      [1, 0.57, 0.1],
      [0.18, 0.67, 0.72],
      [0.035, 0.65, 0.88],
      [0.13, 0.26, 1],
    ],
    [
      [1, 0.31, 0.13],
      [0.59, 0.115, 0.78],
      [0.3, 0.21, 0.97],
      [0.23, 0.64, 0.92],
    ],
    [
      [0.98, 0.19, 0.29],
      [0.72, 0.14, 0.61],
      [0.37, 0.22, 0.84],
      [0.08, 0.61, 0.82],
    ],
  ]
  function gasColour(branch, r, lane) {
    const t = clip((r - 0.09) / 0.98 + lane * 0.11) * 2.999
    const seg = Math.floor(t),
      f = t - seg,
      smooth = f * f * (3 - 2 * f)
    return nebulae[branch][seg].map((a, k) =>
      lerp(a, nebulae[branch][seg + 1][k], smooth),
    )
  }
  const body = new THREE.Group()

  // A thin exponential disk of old stars makes the interior continuous. Spiral
  // arms are overdensities in that disk, not separate isolated ropes of gas.
  function diskPos() {
    const r = Math.min(
      1.28,
      -Math.log(Math.max(1e-6, random() * random())) * 0.242,
    )
    const t = random() * TAU,
      z = bell() * (0.025 + 0.023 * r)
    return [r * Math.cos(t), r * Math.sin(t), z, r]
  }
  function oldDisk(cloud) {
    const [x, y, z, r] = diskPos(),
      warm = Math.exp(-r * 2.75)
    const a = clip((1.22 - r) * 4) * (cloud ? 0.011 : 0.2)
    return [
      x,
      y,
      z,
      0.27 + 0.58 * warm,
      0.31 + 0.19 * warm,
      0.72 - 0.5 * warm,
      a,
      cloud ? 0.025 + random() * 0.078 : 0.0012 + random() * 0.0041,
    ]
  }

  function path(branch, r) {
    // Major arms open out after leaving the bulge and bifurcate halfway
    // through the disk. The two outer spurs have different lengths and pitch.
    const side = branch % 2
    let phi = armPhase(r) + branches[branch]
    phi += 0.13 * Math.sin(5.7 * r + side * 0.8) + 0.19 * side * r * r
    if (branch === 3) phi += (r - 0.5) * 0.56
    return phi
  }
  function armPos(phase) {
    const f = random(),
      branch = f < 0.36 ? 0 : f < 0.68 ? 1 : f < 0.91 ? 2 : 3
    const lo = starts[branch],
      hi = ends[branch]
    const r = lo + (hi - lo) * random() ** 0.74
    const t = path(branch, r),
      n = bell()
    // Coherent strands braid, separate and rejoin along each arm.
    const lane = Math.floor(random() * 8)
    const braid =
      (lane - 3.5) * (0.0025 + 0.008 * r) +
      (0.004 + 0.014 * r) * Math.sin(13 * r + lane * 1.66 + branch)
    const spray = random() < 0.26 ? 1.9 + 2.3 * r : 1
    const offset =
      braid +
      n * (0.015 + 0.041 * r) * spray +
      (noise(r * 10, branch * 7) - 0.5) * 0.045
    const radial = r + offset + phase
    const x = radial * Math.cos(t),
      y = radial * Math.sin(t)
    const z = 0.016 * r * Math.sin(t * 2 - 0.3) + bell() * (0.016 + 0.013 * r)
    const taper =
      clip((hi - r) / (0.18 + 0.03 * branch)) * clip((r - 0.047) / 0.16)
    return [x, y, z, r, taper, branch, offset]
  }
  const emission = (x, y) => {
    const coarse = noise(6 * x + 25, 6 * y - 11),
      mid = noise(21 * x + 80, 21 * y + 45),
      fine = noise(73 * x, 73 * y)
    return 0.11 + 1.6 * (0.51 * coarse + 0.33 * mid + 0.16 * fine) ** 2.2
  }
  function arm(cloud) {
    const [x, y, z, r, taper, branch, offset] = armPos(cloud ? 0 : -0.006)
    const lit = emission(x, y)
    const hue = gasColour(branch, r, offset * 12 + lit * 0.4)
    const pearlMix = cloud ? 0.085 : 0.1 + random() ** 3 * 0.72
    const temp = hue.map((c) => lerp(c, 1, pearlMix))
    return [
      x,
      y,
      z,
      ...temp,
      taper * (0.11 + lit * 0.82) * (cloud ? 0.105 : 0.46 + random() * 0.39),
      cloud ? 0.018 + random() * 0.058 : 0.0014 + random() * 0.0042,
    ]
  }

  // Compact spheroidal bar and a more diffuse, vertically extended stellar
  // bulge. Their shared central density peak remains recognizable edge-on.
  function bulge(cloud) {
    const r = Math.sqrt(-Math.log(Math.max(0.00001, random()))),
      t = random() * TAU
    const x = 0.1 * r * Math.cos(t),
      y = 0.078 * r * Math.sin(t),
      z = bell() * 0.036
    const heat = Math.exp(-r * 1.8)
    return [
      x,
      y,
      z,
      lerp(golden[0], pearl[0], heat),
      lerp(golden[1], pearl[1], heat),
      lerp(golden[2], pearl[2], heat),
      cloud ? 0.055 : 0.35 + random() * 0.26,
      cloud ? 0.023 + random() * 0.043 : 0.0016 + random() * 0.0043,
    ]
  }
  const batches = [
    population(6500, () => oldDisk(true)),
    population(24500, () => arm(true)),
    population(2900, () => bulge(true)),
    population(22000, () => oldDisk(false)),
    population(66000, () => arm(false)),
    population(8200, () => bulge(false)),
  ]

  // Leading-edge dust lanes are narrow warped volumes, not black outlines.
  // Core-side lanes are strongest; gaps and feathered ends leave starlight
  // visible between them. Foreground stars render after the absorbing dust.
  const dust = population(9000, () => {
    const f = random(),
      branch = f < 0.45 ? 0 : f < 0.84 ? 1 : f < 0.92 ? 2 : 3
    const r =
      starts[branch] + (ends[branch] - starts[branch]) * random() ** 0.85
    const t = path(branch, r)
    const width = 0.007 + 0.016 * r,
      rr =
        r -
        0.035 -
        r * 0.019 +
        bell() * width +
        (noise(r * 21, branch * 4) - 0.5) * 0.062
    const x = rr * Math.cos(t),
      y = rr * Math.sin(t),
      z = 0.023 + 0.016 * r * Math.sin(t * 2 - 0.3) + bell() * 0.008
    const gap = noise(11 * x + 32, 11 * y + 17) ** 1.6
    return [
      x,
      y,
      z,
      0.07,
      0.053,
      0.044,
      (0.026 + random() * 0.064) *
        gap *
        clip((0.99 - r) / 0.24) *
        clip((r - 0.062) / 0.09),
      0.009 + random() * 0.023,
    ]
  })
  dust.material.blending = THREE.NormalBlending
  dust.renderOrder = 2
  for (const batch of batches.slice(3)) batch.renderOrder = 3
  batches.push(dust)
  // H II regions are sparse, correlated with the knots of the outer arms and
  // surrounded by young blue stars rather than coloring the entire galaxy.
  const knots = []
  for (let i = 0; i < 350; i++) knots.push(armPos(-0.014))
  const knotsCloud = population(6400, (i) => {
    const p = knots[i % knots.length],
      red = (i % knots.length) % 13 < 3 && p[3] > 0.31,
      spread = 0.008 + random() * 0.013
    return [
      p[0] + bell() * spread,
      p[1] + bell() * spread,
      p[2] + bell() * 0.009,
      red ? 1 : 0.16,
      red ? 0.18 : 0.64,
      red ? 0.48 : 1,
      (red ? 0.112 : 0.068) * p[4],
      (red ? 0.019 : 0.012) + random() * 0.027,
    ]
  })
  const knotsStars = population(10300, (i) => {
    const p = knots[i % knots.length],
      spread = 0.007 + random() * 0.011
    return [
      p[0] + bell() * spread,
      p[1] + bell() * spread,
      p[2] + bell() * 0.009,
      0.65,
      0.79,
      1,
      (0.34 + random() * 0.45) * p[4],
      0.0013 + random() * 0.0044,
    ]
  })
  knotsStars.renderOrder = 4
  batches.push(knotsCloud, knotsStars)
  // The small luminous nucleus and a sparse spherical stellar halo make the
  // galaxy visibly thicker than its outer disk in low-angle views.
  batches.push(
    population(1650, () => {
      const r = -Math.log(Math.max(0.0002, random())) * 0.028,
        t = random() * TAU,
        z = random() * 2 - 1,
        xy = Math.sqrt(1 - z * z)
      return [
        r * xy * Math.cos(t),
        r * xy * Math.sin(t),
        r * z * 0.66,
        1,
        0.84,
        0.6,
        0.11,
        0.005 + random() * 0.015,
      ]
    }),
  )
  batches.push(
    population(7000, () => {
      const [x, y, z, r] = diskPos()
      return [
        x,
        y,
        z * 4,
        0.79,
        0.78,
        0.82,
        0.21 + random() * 0.24,
        0.0016 + random() * 0.004,
      ]
    }),
  )
  body.add(...batches)
  const field = population(3700, () => {
    const t = random() * TAU,
      z = lerp(-4.9, 1.9, random()),
      r = 4.1 * Math.sqrt(random())
    const shine = random() ** 3,
      blue = random()
    return [
      r * Math.cos(t),
      r * Math.sin(t),
      z,
      0.63 + 0.27 * blue,
      0.73 + 0.17 * blue,
      0.8 + 0.17 * random(),
      0.3 + 0.63 * shine,
      0.0026 + shine * 0.0085,
    ]
  })
  const anchors = articles.map((article, i) => ({
    article,
    point: new THREE.Vector3(...articlePosition(article.slug || article.id)),
    id: i,
  }))
  const beacons = population(
    anchors.length,
    (i) => {
      const p = anchors[i].point
      return [p.x, p.y, p.z, 0.82, 0.9, 1, 1, 0.067]
    },
    true,
  )
  beacons.renderOrder = 5
  body.add(beacons)
  const center = population(1, () => [0, 0, 0, 1, 0.84, 0.52, 1, 0.13], true)
  body.add(center)
  // Nearby stars drift across the distant arms much faster when the eye moves.
  const foreground = population(
    155,
    () => {
      const z = lerp(0.38, 2.72, random()),
        r = 2.8 * Math.sqrt(random()),
        t = random() * TAU
      const warm = random() < 0.25,
        size = 0.012 + random() ** 3 * 0.043
      return [
        r * Math.cos(t),
        r * Math.sin(t),
        z,
        warm ? 1 : 0.44,
        warm ? 0.52 : 0.67,
        warm ? 0.25 : 1,
        0.61 + 0.38 * random(),
        size,
      ]
    },
    true,
  )
  foreground.renderOrder = 6
  const all = [...batches, beacons, center, field, foreground]
  const shimmering = [[field, 0.32], [foreground, 0.42], [knotsStars, 0.22]]
  return {
    body,
    field,
    foreground,
    anchors,
    setScale(scale, ratio) {
      for (const batch of all) {
        batch.material.uniforms.scale.value = scale
        batch.material.uniforms.pixelRatio.value = ratio
      }
    },
    setShimmer(time, weight) {
      for (const [batch, strength] of shimmering) {
        batch.material.uniforms.shimmerTime.value = time
        batch.material.uniforms.shimmerWeight.value = weight * strength
      }
    },
    dispose() {
      for (const batch of all) {
        batch.geometry.dispose()
        batch.material.dispose()
      }
    },
  }
}

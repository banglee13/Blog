import * as THREE from './vendor/three.module.min.js'

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
  varying vec4 tint;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(diameter * scale / -mv.z, .75 * pixelRatio, 108.0 * pixelRatio);
    tint = pigment;
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
    uniforms: { scale: { value: 2000 }, pixelRatio: { value: 1 } },
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
  const random = makeRandom(983094)
  const normal = () => random() + random() + random() - 1.5
  const branches = [0, 0.32, 2.92, 3.21, 1.39, 4.72]
  // Dust structure is coherent among nearby stars, clouds and star clusters.
  // Warped logarithmic arms break into spurs well outside the compact bulge.
  function armSample(cloud) {
    const branch = Math.floor(random() * branches.length)
    const r = 0.024 + 0.98 * Math.pow(random(), 0.66)
    const arm = branches[branch]
    const randomOffset = normal()
    const pitch = 3.08 * Math.log(r + 0.18) + 3.48
    const spread = (0.17 + Math.pow(r, 1.4) * 0.24) * (branch > 3 ? 1.5 : 1)
    let a = arm + pitch + 0.1 * Math.sin(r * 12 + arm) + randomOffset * spread
    if (random() < 0.19) a += normal() * 1.95
    const bend = (noise(r * 8, arm * 4) - 0.5) * 0.18
    a += bend
    let x = r * Math.cos(a),
      y = r * Math.sin(a)
    const turbulent =
      noise(x * 7 + 23, y * 7 + 13) * 0.49 +
      noise(x * 21 - 8, y * 21) * 0.3 +
      noise(x * 53, y * 53 + 92) * 0.16 +
      noise(x * 131, y * 131) * 0.05
    const fine = noise(x * 49 + turbulent * 5, y * 49)
    const lane =
      0.25 +
      0.75 *
        Math.min(
          1,
          Math.abs(randomOffset + 0.21 + (turbulent - 0.5) * 2.3) * 3.4,
        )
    const taper = Math.min(1, (1.04 - r) / 0.22)
    const dust =
      (0.29 + 0.96 * Math.max(0.01, (turbulent - 0.23) * 2.67) ** 1.55) *
      (0.3 + 0.7 * lane) *
      taper
    const warm = Math.exp((-r * r) / 0.12)
    const rose = Math.max(0, (noise(x * 15 + 87, y * 15 + 43) - 0.65) * 2.6)
    const color = [
      0.48 + 0.5 * warm + 0.28 * rose,
      0.63 + 0.12 * warm - 0.1 * rose,
      0.88 - 0.44 * warm - 0.04 * rose,
    ]
    const stray = random()
    let z = normal() * (0.024 + 0.018 * r) + 0.014 * Math.sin(a * 2 + r * 6) * r
    z += 0.03 * r * (noise(x * 7 + 3, y * 7 - 1) - 0.5)
    if (cloud) {
      return [
        x,
        y,
        z,
        ...color,
        (0.068 + fine * 0.052) * dust * (1 - 0.36 * r),
        0.014 + random() * 0.057,
      ]
    }
    const giant = stray > 0.989
    const size = giant ? 0.004 + random() * 0.006 : 0.001 + random() * 0.0035
    const sparkle = 0.74 + random() * 0.26
    return [
      x,
      y,
      z,
      ...color.map((c) => c * sparkle),
      (0.32 + random() * 0.63) * dust,
      size,
    ]
  }
  function bulge(cloud) {
    const radius = Math.min(
      0.64,
      Math.sqrt(-Math.log(Math.max(0.0001, random()))) *
        (cloud ? 0.125 : 0.166),
    )
    const t = random() * TAU,
      z = random() * 2 - 1,
      xy = Math.sqrt(1 - z * z)
    const extinction = 0.77 + 0.23 * noise(radius * 60 + Math.cos(t) * 2, z * 3)
    const heat = Math.exp(-radius / 0.13),
      cream = Math.exp(-radius / 0.046)
    const color = [
      0.92 + 0.08 * heat,
      0.66 + 0.22 * cream,
      0.4 + 0.31 * cream + 0.1 * (1 - heat),
    ]
    return [
      radius * xy * Math.cos(t),
      radius * xy * Math.sin(t),
      radius * z * 0.34,
      ...color,
      (cloud ? 0.06 : 0.2 + random() * 0.39) * extinction,
      cloud ? 0.017 + random() * 0.046 : 0.0014 + random() * 0.0043,
    ]
  }
  const body = new THREE.Group()
  const batches = [
    population(27400, () => armSample(true)),
    population(5200, () => bulge(true)),
    population(104000, () => armSample(false)),
    population(14500, () => bulge(false)),
  ]
  // Ribbons of interstellar dust sit just above the mid-plane. Their narrow
  // spurs extinguish part of the rear emission, while foreground stars shine
  // through. All of the knots retain depth as the observer circles the galaxy.
  const dust = population(16000, () => {
    const arm = branches[Math.floor(random() * branches.length)]
    const r = 0.045 + 0.91 * random() ** 0.83
    const bend = (noise(r * 8, arm * 4) - 0.5) * 0.18
    let t =
      arm +
      3.08 * Math.log(r + 0.18) +
      3.48 +
      0.1 * Math.sin(r * 12 + arm) +
      bend
    t += 0.09 + 0.045 * Math.sin(18 * r + arm) + normal() * 0.069
    if (random() < 0.28) t -= 0.12
    const x = r * Math.cos(t),
      y = r * Math.sin(t),
      density = noise(x * 14 + 18, y * 14)
    return [
      x,
      y,
      0.023 + normal() * 0.009,
      0.023,
      0.021,
      0.026,
      (0.09 + density * 0.23) * Math.min(1, (1 - r) / 0.31),
      0.005 + 0.03 * random(),
    ]
  })
  dust.material.blending = THREE.NormalBlending
  batches[2].renderOrder = batches[3].renderOrder = 3
  dust.renderOrder = 2
  batches.push(dust)
  // A compact, ellipsoidal, warmer inner bulge picks out the clickable centre.
  batches.push(
    population(1750, () => {
      const r = -Math.log(Math.max(0.002, random())) * 0.023,
        t = random() * TAU,
        z = random() * 2 - 1
      const xy = Math.sqrt(1 - z * z)
      return [
        r * xy * Math.cos(t),
        r * xy * Math.sin(t),
        r * z * 0.48,
        1,
        0.811,
        0.541,
        0.1,
        0.007 + 0.013 * random(),
      ]
    }),
  )
  // Star-forming knots occupy local volumes along the arms instead of sitting
  // on the surface of the disk. Each has its own substructure and temperature.
  const clusters = []
  for (let i = 0; i < 410; i++) clusters.push(armSample(false))
  batches.push(
    population(11000, (i) => {
      const host = clusters[i % clusters.length],
        dx = normal() * 0.011,
        dy = normal() * 0.011,
        dz = normal() * 0.006
      return [
        host[0] + dx,
        host[1] + dy,
        host[2] + dz,
        0.63,
        0.76,
        1,
        0.34 + random() * 0.39,
        0.001 + random() * 0.004,
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
  const anchors = articles.map((article, i) => {
    const t = i * 2.39996 + 0.44
    const radius = 0.36 + 0.63 * (0.3 + (0.7 * ((i * 7 + 3) % 17)) / 16)
    return {
      article,
      point: new THREE.Vector3(
        Math.cos(t) * radius,
        Math.sin(t) * radius,
        0.021 + 0.09 * Math.sin(i * 3.4),
      ),
      id: i,
    }
  })
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
  const all = [...batches, beacons, center, field]
  return {
    body,
    field,
    anchors,
    setScale(scale, ratio) {
      for (const batch of all) {
        batch.material.uniforms.scale.value = scale
        batch.material.uniforms.pixelRatio.value = ratio
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

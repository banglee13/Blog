import * as THREE from './vendor/three.module.min.js'
import { makeGalaxyModel } from './galaxy-model.js'
import { getLabelOrder } from './galaxy-catalog.js'

const RAD = Math.PI / 180
const CORE = -1
const NONE = -2
const MIN_ZOOM = 0.55
const MAX_ZOOM = 2.65
const DISTANCE = 4
const LABEL_FONT = '13px "Segoe UI","Microsoft YaHei",sans-serif'
// Once per document, including remounts due to route changes and StrictMode.
let introduced = false
const clamp = THREE.MathUtils.clamp

function makeTitle(text) {
  const surface = document.createElement('canvas')
  const context = surface.getContext('2d')
  context.font = LABEL_FONT
  const maxWidth = Math.min(238, Math.ceil(context.measureText(text).width))
  const words = Array.from(text)
  if (context.measureText(text).width > maxWidth) {
    while (
      words.length &&
      context.measureText(words.join('') + '…').width > maxWidth
    )
      words.pop()
    text = words.join('') + '…'
  }
  const width = maxWidth + 8,
    height = 26
  surface.width = width * 2
  surface.height = height * 2
  context.scale(2, 2)
  context.font = LABEL_FONT
  context.textBaseline = 'middle'
  context.fillStyle = '#c6c8cd'
  context.shadowColor = '#030508'
  context.shadowBlur = 4
  context.fillText(text, 4, height / 2 + 0.3)
  const texture = new THREE.CanvasTexture(surface)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.center.set(0, 0.5)
  sprite.scale.set(width, height, 1)
  return { sprite, width, height, rect: null }
}

function accessibility(root, articles, onSelect, onFocus) {
  const group = document.createElement('nav')
  group.className = 'gx-access'
  group.setAttribute('aria-label', '星图导航')
  const add = (id, title) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = title
    b.dataset.star = String(id)
    b.onclick = () => onSelect(id)
    b.onfocus = () => onFocus(id)
    b.onblur = () => onFocus(NONE)
    group.append(b)
  }
  add(CORE, '打开星核导航')
  articles.forEach((a, i) => add(i, '阅读：' + a.title))
  root.append(group)
}

export function mountGalaxy(
  container,
  {
    articles = [],
    onArticle,
    onCore,
    onRotate,
    initialAngle = 0,
    initialView,
  } = {},
) {
  const root = document.createElement('div')
  root.className = 'gx-world'
  container.append(root)
  const controller = new AbortController()
  const listen = (node, event, handler, options = {}) =>
    node.addEventListener(event, handler, {
      ...options,
      signal: controller.signal,
    })
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let renderer,
    warning,
    model,
    frame = 0,
    disposed = false,
    active = true,
    lastFrame = 0
  let angle = Number(initialView?.angle ?? initialAngle) || 0,
    target = angle,
    width = 0,
    height = 0,
    hover = NONE,
    focus = NONE
  let orbitTilt = clamp(Number(initialView?.tilt) || 40, 8, 156),
    tiltTarget = orbitTilt
  let zoom = clamp(Number(initialView?.zoom) || 1, MIN_ZOOM, MAX_ZOOM)
  let zoomTarget = zoom,
    focalScale = 1,
    renderRatio = 1
  let pointerX = 0,
    pointerY = 0,
    wantedX = 0,
    wantedY = 0,
    drag = null,
    suppressClick = false
  let introStart = null,
    entryWeight = 0
  let flight = null,
    arrival = 0,
    flightTarget = null,
    meteorTimer = 0,
    meteorStart = 0,
    meteorNumber = 0
  let renderState = 'webgl',
    labels = [],
    projected = [],
    order = []
  function choose(id) {
    if (!active) return
    if (id === CORE) onCore?.()
    else if (id >= 0) onArticle?.(articles[id])
  }
  function displayUnsupported() {
    renderState = 'unavailable'
    root.dataset.renderer = renderState
    if (warning) return
    warning = document.createElement('div')
    warning.className = 'gx-unavailable'
    const message = document.createElement('p')
    message.textContent = '当前浏览器无法显示三维星图。'
    const button = document.createElement('button')
    button.textContent = '打开导航'
    button.type = 'button'
    button.onclick = () => choose(CORE)
    warning.append(message, button)
    root.append(warning)
  }
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: false,
      powerPreference: 'low-power',
      stencil: false,
      depth: false,
    })
  } catch {
    displayUnsupported()
  }
  if (!renderer) {
    return {
      destroy() {
        disposed = true
        controller.abort()
        root.remove()
      },
      rotate() {},
      magnify() {},
      reset() {},
      approach: async () => true,
      returnFrom: async () => true,
      cancelTransition() {},
      getView: () => ({ angle, tilt: orbitTilt, zoom }),
      getAngle: () => angle,
      setActive: (v) => {
        active = v
      },
    }
  }
  root.dataset.renderer = renderState
  const canvas = renderer.domElement
  canvas.className = 'gx-canvas'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', '三维文章星系，拖动环视，滚轮缩放')
  root.append(canvas)
  renderer.setClearColor(0x04060b)
  renderer.autoClear = false
  const scene = new THREE.Scene(),
    overlay = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20)
  // Preserve the nucleus and knots in floating point before compressing high
  // radiance into the display range. The fullscreen pass contains no imagery.
  const hdr = renderer.extensions.has('EXT_color_buffer_float')
    ? new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
      })
    : null
  const exposureScene = new THREE.Scene(),
    screenCamera = new THREE.Camera()
  const screenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { field: { value: hdr?.texture } },
      vertexShader:
        'varying vec2 coords; void main(){coords=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `varying vec2 coords; uniform sampler2D field; void main(){
      vec3 c=texture2D(field,coords).rgb;
      c=1.-exp(-c*1.25);
      gl_FragColor=vec4(c,1.);
    }`,
      depthTest: false,
      depthWrite: false,
    }),
  )
  exposureScene.add(screenMesh)
  const textCamera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 4)
  textCamera.position.z = 1
  camera.position.set(0, 0, DISTANCE)
  const bank = new THREE.Group(),
    tilt = new THREE.Group()
  model = makeGalaxyModel(articles)
  scene.add(bank, model.field, model.foreground, model.companion)
  bank.add(tilt)
  tilt.add(model.body)
  bank.rotation.z = 11 * RAD
  labels = articles.map((a) => makeTitle(a.title))
  for (const label of labels) overlay.add(label.sprite)
  projected = model.anchors.map(() => ({ x: 0, y: 0 }))
  order = getLabelOrder(articles)
  const vector = new THREE.Vector3()
  const aim = new THREE.Vector3(),
    focusPoint = new THREE.Vector3()
  const meteorGeometry = new THREE.BufferGeometry()
  const streak = new Float32Array(6)
  const streakPosition = new THREE.BufferAttribute(streak, 3)
  meteorGeometry.setAttribute('position', streakPosition)
  meteorGeometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute([0.013, 0.035, 0.059, 0.88, 0.89, 1], 3),
  )
  const meteorMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  })
  const meteor = new THREE.Line(meteorGeometry, meteorMaterial)
  meteor.visible = false
  meteor.frustumCulled = false
  meteor.renderOrder = 7
  scene.add(meteor)
  const coreScreen = { x: 0, y: 0 }
  function screenPoint(pos, out) {
    vector.copy(pos).applyMatrix4(model.body.matrixWorld).project(camera)
    out.x = (vector.x + 1) * 0.5 * width
    out.y = (1 - vector.y) * 0.5 * height
  }
  const origin = new THREE.Vector3()
  function positionTitles() {
    scene.updateMatrixWorld()
    camera.updateMatrixWorld()
    screenPoint(origin, coreScreen)
    for (const a of model.anchors) screenPoint(a.point, projected[a.id])
    const chosen = [],
      id = focus !== NONE ? focus : hover
    const priority = id >= 0 ? [id, ...order.filter((i) => i !== id)] : order
    let count = 0
    for (const i of priority) {
      const label = labels[i],
        sprite = label.sprite,
        p = projected[i],
        emphasis = i === id
      label.rect = null
      sprite.visible = false
      if (count >= 8 && !emphasis) continue
      if (p.x < 5 || p.y < 4 || p.x > width - 5 || p.y > height - 4) continue
      const left =
        p.x + label.width + 18 > width ? p.x - label.width - 9 : p.x + 9
      const top = p.y - 20
      const rect = { left, top, right: left + label.width, bottom: top + 25 }
      if (
        !emphasis &&
        (Math.hypot(p.x - coreScreen.x, p.y - coreScreen.y) < 58 ||
          chosen.some(
            (r) =>
              rect.left < r.right + 5 &&
              rect.right > r.left - 5 &&
              rect.top < r.bottom + 4 &&
              rect.bottom > r.top - 4,
          ))
      )
        continue
      chosen.push(rect)
      count++
      label.rect = rect
      sprite.position.set(left, height - top - label.height / 2, 0)
      sprite.material.opacity =
        (emphasis ? 1 : 0.83) * (1 - arrival * 0.95) * (1 - entryWeight)
      sprite.visible = true
    }
  }
  function render() {
    if (disposed || !width || !height || renderState !== 'webgl') return
    if (camera.zoom !== zoom) {
      camera.zoom = zoom
      camera.updateProjectionMatrix()
      model.setScale(focalScale * zoom, renderRatio)
    }
    model.body.rotation.z = (angle + 42) * RAD
    tilt.rotation.x = (orbitTilt + 6 * Math.sin(angle * RAD * 0.5)) * RAD
    const bearing = angle * RAD
    camera.position.set(
      0.47 * pointerX + 0.13 * Math.sin(bearing),
      -0.32 * pointerY + 0.08 * Math.sin(bearing * 0.67),
      DISTANCE - 0.16 * Math.sin(bearing),
    )
    aim.set(pointerX * 0.054, -pointerY * 0.039, 0)
    // The observer sweeps past nearby stars while the distant companion moves
    // only slightly. All perspective, parallax and occlusion remain in camera.
    if (entryWeight > 0) {
      camera.position.x -= entryWeight * (0.92 + 0.28 * (1 - entryWeight))
      camera.position.y += entryWeight * 0.34
      camera.position.z -= entryWeight * 2.65
      aim.x -= entryWeight * 0.45
      aim.y += entryWeight * 0.08
    }
    if (arrival && flightTarget) {
      bank.updateMatrixWorld()
      focusPoint.copy(flightTarget).applyMatrix4(model.body.matrixWorld)
      aim.lerp(focusPoint, arrival * 0.86)
      camera.position.x += arrival * (focusPoint.x * 0.64 + 0.06)
      camera.position.y += arrival * focusPoint.y * 0.64
      camera.position.z -= arrival * 1.36
    }
    camera.lookAt(aim)
    positionTitles()
    renderer.setRenderTarget(hdr)
    renderer.clear()
    renderer.render(scene, camera)
    if (hdr) {
      renderer.setRenderTarget(null)
      renderer.render(exposureScene, screenCamera)
    }
    renderer.render(overlay, textCamera)
    onRotate?.(angle)
  }
  function tick(time) {
    frame = 0
    if (disposed || !active || document.hidden || renderState !== 'webgl')
      return
    const dt = lastFrame ? Math.min(64, time - lastFrame) : 16.7
    lastFrame = time
    const easing = 1 - Math.exp(-dt / 78)
    zoom += (zoomTarget - zoom) * easing
    if (Math.abs(zoomTarget - zoom) < 0.0007 || motion.matches)
      zoom = zoomTarget
    if (introStart !== null) {
      const t = clamp((time - introStart) / 1880, 0, 1)
      entryWeight = (1 - t) ** 2.4
      if (t === 1 || motion.matches) stopIntroduction()
    }
    angle += (target - angle) * easing
    if (Math.abs(target - angle) < 0.035 || motion.matches) angle = target
    tiltTarget = clamp(tiltTarget, 8, 156)
    orbitTilt += (tiltTarget - orbitTilt) * easing
    if (Math.abs(tiltTarget - orbitTilt) < 0.02 || motion.matches)
      orbitTilt = tiltTarget
    pointerX += (wantedX - pointerX) * easing
    pointerY += (wantedY - pointerY) * easing
    if (Math.abs(wantedX - pointerX) < 0.002 || motion.matches)
      pointerX = wantedX
    if (Math.abs(wantedY - pointerY) < 0.002 || motion.matches)
      pointerY = wantedY
    if (flight) {
      const t = motion.matches
        ? 1
        : clamp((time - flight.start) / flight.duration, 0, 1)
      arrival = THREE.MathUtils.lerp(
        flight.from,
        flight.to,
        t * t * (3 - 2 * t),
      )
      if (t === 1) {
        const finished = flight
        flight = null
        finished.done(true)
      }
    }
    animateMeteor(time)
    render()
    if (
      target !== angle ||
      orbitTilt !== tiltTarget ||
      zoom !== zoomTarget ||
      pointerX !== wantedX ||
      pointerY !== wantedY ||
      introStart !== null ||
      flight ||
      meteorStart
    )
      frame = requestAnimationFrame(tick)
    else lastFrame = 0
  }
  function invalidate() {
    if (!disposed && active && !document.hidden && !frame)
      frame = requestAnimationFrame(tick)
  }
  function resize() {
    width = container.clientWidth
    height = container.clientHeight
    if (!width || !height) return
    const ratio = Math.min(
      devicePixelRatio || 1,
      1.3,
      Math.sqrt(2250000 / (width * height)),
    )
    renderer.setPixelRatio(ratio)
    renderer.setSize(width, height, false)
    hdr?.setSize(Math.round(width * ratio), Math.round(height * ratio))
    const radius = Math.min(width * 0.365, height * 0.54)
    camera.aspect = width / height
    camera.fov = (2 * Math.atan(height / (2 * radius * DISTANCE))) / RAD
    camera.updateProjectionMatrix()
    textCamera.right = width
    textCamera.top = height
    textCamera.updateProjectionMatrix()
    renderRatio = ratio
    focalScale = radius * DISTANCE * ratio
    model.setScale(focalScale * zoom, ratio)
    invalidate()
  }
  function hit(e) {
    const bounds = canvas.getBoundingClientRect(),
      x = e.clientX - bounds.left,
      y = e.clientY - bounds.top
    if (Math.hypot(x - coreScreen.x, y - coreScreen.y) < 24) return CORE
    let item = NONE,
      distance = 16
    for (let i = 0; i < projected.length; i++) {
      const p = projected[i],
        r = Math.hypot(x - p.x, y - p.y)
      if (r < distance) {
        distance = r
        item = i
      }
    }
    if (item !== NONE) return item
    for (let i = 0; i < labels.length; i++) {
      const r = labels[i].rect
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
        return i
    }
    return NONE
  }
  function rotate(delta) {
    if (!active || !Number.isFinite(delta)) return
    stopIntroduction()
    if (flight) cancelTransition()
    target += delta
    invalidate()
  }
  function cancelTransition() {
    stopIntroduction()
    if (flight) {
      const current = flight
      flight = null
      current.done(false)
    }
    arrival = 0
    flightTarget = null
    invalidate()
  }
  function travel(id, reverse, options = {}) {
    if (disposed || !active || options.signal?.aborted)
      return Promise.resolve(false)
    if (renderState !== 'webgl') return Promise.resolve(true)
    cancelTransition()
    const anchor =
      id === 'core'
        ? origin
        : model.anchors.find(
            (a) => a.article.id === id || a.article.slug === id,
          )?.point
    if (!anchor) return Promise.resolve(false)
    flightTarget = anchor
    arrival = reverse ? 1 : 0
    const to = reverse ? 0 : 1
    if (document.hidden || motion.matches) {
      arrival = to
      invalidate()
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      const abort = () => cancelTransition()
      const done = (value) => {
        options.signal?.removeEventListener('abort', abort)
        resolve(value)
      }
      flight = {
        from: arrival,
        to,
        start: performance.now(),
        duration: reverse ? 440 : 380,
        done,
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      invalidate()
    })
  }
  function stopIntroduction() {
    if (introStart === null) return
    introStart = null
    entryWeight = 0
    invalidate()
  }
  function scheduleMeteor() {
    clearTimeout(meteorTimer)
    meteorTimer = 0
    if (!active || document.hidden || motion.matches || disposed) return
    meteorTimer = setTimeout(
      () => {
        if (!active || document.hidden || motion.matches || disposed) return
        meteorStart = performance.now()
        meteorNumber++
        invalidate()
      },
      13500 + 3700 * (meteorNumber % 3),
    )
  }
  function animateMeteor(time) {
    if (!meteorStart) return
    const t = (time - meteorStart) / 640
    if (t >= 1 || motion.matches) {
      meteor.visible = false
      meteorStart = 0
      scheduleMeteor()
      return
    }
    const direction = meteorNumber % 2 ? 1 : -1
    const x = direction * (0.76 - 0.62 * t),
      y = 0.41 - 0.34 * t,
      z = 1.3
    const tail = 0.124 * Math.sin(Math.PI * Math.max(0, t))
    streak.set([x + direction * tail, y + tail * 0.55, z - 0.024, x, y, z])
    streakPosition.needsUpdate = true
    meteorMaterial.opacity = Math.sin(Math.PI * clamp(t, 0, 1)) * 0.83
    meteor.visible = true
  }
  function magnify(factor) {
    if (!active || !Number.isFinite(factor) || factor <= 0) return
    stopIntroduction()
    if (flight) cancelTransition()
    zoomTarget = clamp(zoomTarget * factor, MIN_ZOOM, MAX_ZOOM)
    invalidate()
  }
  listen(
    canvas,
    'wheel',
    (e) => {
      if (!active || e.ctrlKey) return
      e.preventDefault()
      const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1
      magnify(Math.exp(-clamp(e.deltaY * factor, -320, 320) * 0.00155))
    },
    { passive: false },
  )
  listen(canvas, 'pointermove', (e) => {
    if (!active || flight) return
    if (e.isTrusted) stopIntroduction()
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y
      if (Math.hypot(dx, dy) > 4 || drag.moved) {
        drag.moved = true
        suppressClick = true
        target = drag.angle + dx * 0.25
        tiltTarget = clamp(drag.tilt + dy * 0.24, 8, 156)
        canvas.style.cursor = 'grabbing'
        invalidate()
      }
      return
    }
    if (!motion.matches) {
      const bounds = canvas.getBoundingClientRect()
      wantedX = clamp((2 * (e.clientX - bounds.left)) / width - 1, -1, 1)
      wantedY = clamp((2 * (e.clientY - bounds.top)) / height - 1, -1, 1)
      invalidate()
    }
    const next = hit(e)
    if (next !== hover) {
      hover = next
      canvas.style.cursor = next !== NONE ? 'pointer' : 'grab'
      invalidate()
    }
  })
  listen(canvas, 'pointerleave', () => {
    if (drag) return
    wantedX = wantedY = 0
    invalidate()
    if (hover !== NONE) {
      hover = NONE
      invalidate()
    }
  })
  listen(canvas, 'pointerdown', (e) => {
    if (!active || e.button !== 0) return
    stopIntroduction()
    if (flight) cancelTransition()
    suppressClick = false
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      angle: target,
      tilt: tiltTarget,
      moved: false,
    }
    canvas.setPointerCapture(e.pointerId)
  })
  const release = (e) => {
    if (!drag || drag.id !== e.pointerId) return
    drag = null
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId)
    canvas.style.cursor = 'grab'
  }
  listen(canvas, 'pointerup', release)
  listen(canvas, 'pointercancel', release)
  listen(canvas, 'lostpointercapture', (e) => {
    if (drag?.id === e.pointerId) {
      drag = null
      canvas.style.cursor = 'grab'
    }
  })
  listen(canvas, 'click', (e) => {
    if (!suppressClick) choose(hit(e))
    suppressClick = false
  })
  accessibility(root, articles, choose, (id) => {
    focus = id
    invalidate()
  })
  listen(window, 'keydown', () => stopIntroduction(), { capture: true })
  listen(document, 'visibilitychange', () => {
    if (document.hidden) {
      stopIntroduction()
      if (flight) cancelTransition()
      clearTimeout(meteorTimer)
      meteorStart = 0
      meteor.visible = false
      cancelAnimationFrame(frame)
      frame = lastFrame = 0
    } else {
      scheduleMeteor()
      invalidate()
    }
  })
  listen(motion, 'change', () => {
    if (motion.matches) stopIntroduction()
    wantedX = wantedY = 0
    scheduleMeteor()
    invalidate()
  })
  listen(canvas, 'webglcontextlost', (e) => {
    e.preventDefault()
    displayUnsupported()
  })
  listen(canvas, 'webglcontextrestored', () => {
    renderState = root.dataset.renderer = 'webgl'
    warning?.remove()
    warning = null
    invalidate()
  })
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  if (!introduced && !initialView && !document.hidden && !motion.matches) {
    entryWeight = 1
    introStart = performance.now()
  }
  introduced = true
  resize()
  render()
  scheduleMeteor()
  return {
    rotate,
    magnify,
    getAngle: () => angle,
    getView: () => ({ angle, tilt: orbitTilt, zoom }),
    approach: (id, options) => travel(id, false, options),
    returnFrom: (id, options) => travel(id, true, options),
    cancelTransition,
    reset() {
      target = Math.round(angle / 360) * 360
      tiltTarget = 40
      zoomTarget = 1
      wantedX = wantedY = 0
      invalidate()
    },
    setActive(v) {
      active = Boolean(v)
      if (!active) stopIntroduction()
      if (active) {
        scheduleMeteor()
        invalidate()
      } else {
        if (flight) cancelTransition()
        clearTimeout(meteorTimer)
        meteorStart = 0
        meteor.visible = false
        drag = null
        cancelAnimationFrame(frame)
        frame = lastFrame = 0
        target = angle
      }
    },
    destroy() {
      disposed = true
      cancelTransition()
      clearTimeout(meteorTimer)
      controller.abort()
      observer.disconnect()
      cancelAnimationFrame(frame)
      for (const label of labels) {
        label.sprite.material.map.dispose()
        label.sprite.material.dispose()
      }
      model.dispose()
      meteorGeometry.dispose()
      meteorMaterial.dispose()
      hdr?.dispose()
      screenMesh.geometry.dispose()
      screenMesh.material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      root.remove()
    },
  }
}

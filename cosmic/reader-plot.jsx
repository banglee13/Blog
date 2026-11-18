import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Scan } from 'lucide-react'
import {
  parseUiCcs,
  computeInitialUiCcsViewport,
  clampUnitsPerPx,
  renderStaticUiCcsSvg,
  UI_CCS_VIEW_WIDTH as W,
  UI_CCS_VIEW_HEIGHT as H,
} from '../src/lib/uiCcs'
import {
  parseUiGraph,
  computeInitialUiGraphViewport,
  renderStaticUiGraphSvg,
} from '../src/lib/uiGraph'

export default function Plot({ block }) {
  const graph = block.kind === 'graph'
  const initial = useMemo(
    () =>
      graph
        ? computeInitialUiGraphViewport(
            parseUiGraph(block.header, block.text).nodes,
            W,
            H,
          )
        : computeInitialUiCcsViewport(parseUiCcs(block.text).items, W, H),
    [graph, block],
  )
  const [camera, setCamera] = useState(initial)
  const img = useRef(null),
    drag = useRef(null)
  const title = graph ? '关系图' : '直角坐标图'
  useEffect(() => setCamera(initial), [initial])
  const image = useMemo(() => {
    const svg = graph
      ? renderStaticUiGraphSvg(block.header, block.text, camera)
      : renderStaticUiCcsSvg(block.text, camera)
    return (
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        svg.replace(
          '<svg ',
          '<svg xmlns="http://www.w3.org/2000/svg" color="#838f9b" ',
        ),
      )
    )
  }, [graph, block, camera])
  function zoom(factor, x = 0, y = 0) {
    setCamera((prev) => {
      const units = clampUnitsPerPx(
        Math.min(
          initial.unitsPerPx * 32,
          Math.max(initial.unitsPerPx / 64, prev.unitsPerPx * factor),
        ),
      )
      return {
        unitsPerPx: units,
        centerX: prev.centerX + x * (prev.unitsPerPx - units),
        centerY: prev.centerY - y * (prev.unitsPerPx - units),
      }
    })
  }
  useEffect(() => {
    const el = img.current
    const wheel = (e) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      zoom(
        Math.exp(
          Math.max(
            -1,
            Math.min(1, e.deltaY * (e.deltaMode === 1 ? 0.04 : 0.0018)),
          ),
        ),
        ((e.clientX - box.left) / box.width - 0.5) * W,
        ((e.clientY - box.top) / box.height - 0.5) * H,
      )
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [initial])
  function pan(e) {
    const from = drag.current
    if (!from || from.pointerId !== e.pointerId) return
    const rect = e.currentTarget.getBoundingClientRect()
    setCamera({
      ...from.camera,
      centerX:
        from.camera.centerX -
        (((e.clientX - from.x) * W) / rect.width) * from.camera.unitsPerPx,
      centerY:
        from.camera.centerY +
        (((e.clientY - from.y) * H) / rect.height) * from.camera.unitsPerPx,
    })
  }
  return (
    <figure className="cr-plot">
      <img
        ref={img}
        src={image}
        alt={'文章中的' + title}
        draggable={false}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          drag.current = {
            pointerId: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            camera,
          }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={pan}
        onLostPointerCapture={() => {
          drag.current = null
        }}
      />
      <figcaption>
        <span>{title} · 拖动平移，滚轮缩放</span>
        <button
          type="button"
          aria-label={'缩小' + title}
          onClick={() => zoom(1.25)}
        >
          <ZoomOut size={15} />
        </button>
        <button
          type="button"
          aria-label={'放大' + title}
          onClick={() => zoom(0.8)}
        >
          <ZoomIn size={15} />
        </button>
        <button
          type="button"
          aria-label={'复位' + title}
          onClick={() => setCamera(initial)}
        >
          <Scan size={15} />
        </button>
      </figcaption>
    </figure>
  )
}

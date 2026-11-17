import { useEffect, useRef } from 'react'
import { backgroundImageSrc, resolveBackgroundImage, useBackgroundImage } from '../lib/backgroundImage'

/**
 * 固定背景图层（issue #126）。
 *
 * 挂在 Layout 的 `fixed inset-0 z-0` 装饰层里，因此在正文、卡片与页头之下、
 * 在配色主题的渐变底色之上——不会挡住任何内容，也不会被 z-index 抬到正文前面。
 *
 * 两种滚动行为：
 *   · 「固定在视口」（默认）：这一层本身就是视口大小的 fixed 层，页面滚动时图片不动；
 *   · 「随页面滚动」：给整层套一个与文档等高的内层，按 scrollY 反向平移，
 *     于是长文往下滚时背景也跟着走（比 background-attachment: scroll 更可靠：
 *     父层是 fixed 定位，attachment 在这里不起作用）。
 * 平移只在外部 effect 里直接改 style，不经过 React state，滚动时不会引起重渲染。
 */
export function BackgroundImageLayer() {
  const pref = resolveBackgroundImage(useBackgroundImage())
  const innerRef = useRef<HTMLDivElement>(null)

  // 离线版把远程地址一律解析为空（不联网），于是整层不渲染，也不会留一张破图
  const resolved = { ...pref, url: backgroundImageSrc(pref) }
  const url = resolved.enabled && resolved.url ? resolved.url : ''
  const followScroll = resolved.enabled && !resolved.fixed

  // index.html 的首屏脚本会临时把同一张图铺在 body 上（避免刷新时闪一下底色）。
  // React 图层接管后把它撤掉 —— 无论这次有没有图，都必须撤，否则会留一层过期的背景。
  useEffect(() => {
    document.getElementById('starlog-boot-bg')?.remove()
  }, [url])

  useEffect(() => {
    if (!followScroll) {
      const el = innerRef.current
      if (el) el.style.transform = ''
      return
    }
    let frame = 0
    const apply = () => {
      frame = 0
      const el = innerRef.current
      if (!el) return
      const doc = document.documentElement
      el.style.height = `${Math.max(doc.scrollHeight, window.innerHeight)}px`
      el.style.transform = `translate3d(0, ${-window.scrollY}px, 0)`
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(apply)
    }
    apply()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [followScroll, url])

  if (!url) return null

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        ref={innerRef}
        className="absolute inset-x-0 top-0 h-full bg-no-repeat"
        style={{
          backgroundImage: `url("${url.replace(/["\\\n\r]/g, '\\$&')}")`,
          backgroundSize: pref.fit,
          backgroundPosition: 'center top',
        }}
      />
      {pref.dim > 0 && (
        <div
          className="absolute inset-0"
          style={{ backgroundColor: `rgba(13, 16, 23, ${(pref.dim / 100).toFixed(3)})` }}
        />
      )}
    </div>
  )
}

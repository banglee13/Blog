/**
 * 弹层 / 全屏态的「锁住页面滚动」（issue #128）。
 *
 * 以前每个弹层各自 `document.body.style.overflow = 'hidden'`，卸载时又无条件写回 ''：
 *   · 两层同时锁（例如全屏编辑器里再开 LaTeX 面板）时，先关的那层会把还在用的锁解掉；
 *   · 关掉弹层的一瞬间视口滚动条回来 / 消失，整页左右跳一下。
 * 这里改成引用计数 + 保存 / 恢复原值：只有最后一个解锁者负责把样式还原。
 *
 * 用 overflow:hidden 而不是 position:fixed，是因为前者不会丢失滚动位置，
 * 配合 index.css 里 `scrollbar-gutter: stable`（html 与 body 都声明）也不会产生宽度跳动。
 */

let lockCount = 0
let saved: { html: string; body: string } | null = null

function rootElements(): { html: HTMLElement; body: HTMLElement } | null {
  if (typeof document === 'undefined') return null
  return { html: document.documentElement, body: document.body }
}

/** 上锁，返回解锁函数（重复调用解锁函数只生效一次）。 */
export function lockPageScroll(): () => void {
  const els = rootElements()
  if (!els) return () => {}
  lockCount += 1
  if (lockCount === 1) {
    saved = { html: els.html.style.overflow, body: els.body.style.overflow }
    els.html.style.overflow = 'hidden'
    els.body.style.overflow = 'hidden'
  }
  let released = false
  return () => {
    if (released) return
    released = true
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount === 0 && saved) {
      els.html.style.overflow = saved.html
      els.body.style.overflow = saved.body
      saved = null
    }
  }
}

/** 当前是否有弹层锁着滚动（测试与调试用）。 */
export function isPageScrollLocked(): boolean {
  return lockCount > 0
}

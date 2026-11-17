/**
 * 路由级代码分割与预取（issue #128：界面跳转和加载速度）。
 *
 * - 首页、归档、标签、百宝箱、404 这几个页面每个只有一两 KB，直接进主包：
 *   在它们之间跳转不需要再等一次分包请求，也不会先闪一下加载圈。
 * - 文章页、帮助页、编辑器、内容管理、设置等较重的页面仍然按需加载，
 *   但会被提前取回来：鼠标移到链接上 / 手指按下 / 键盘聚焦时立刻取（`prefetchPath`），
 *   首屏空闲后再把最常用的文章页（连同 Markdown 渲染包）取好（`scheduleIdlePrefetch`）。
 *
 * `App.tsx` 用这里的 loader 创建 lazy 组件，预取用的是同一批函数：
 * 浏览器对同一个动态 import 只会请求、执行一次，提前调用就是「预取」。
 * 路径判断等纯函数在 src/lib/routePaths.ts。
 */
import { OFFLINE } from './lib/runtime'
import {
  lazyRouteForPath,
  shouldIdlePrefetch,
  type LazyRouteKey,
  type NetworkInformationLike,
} from './lib/routePaths'

export const routeLoaders = {
  post: () => import('./pages/PostPage'),
  about: () => import('./pages/About'),
  echo: () => import('./pages/EchoCave'),
  genshin: () => import('./pages/GenshinData'),
  login: () => import('./pages/Login'),
  admin: () => import('./pages/Admin'),
  editor: () => import('./pages/Editor'),
  settings: () => import('./pages/SettingsPage'),
} satisfies Record<LazyRouteKey, () => Promise<unknown>>

const requested = new Set<LazyRouteKey>()

/** 提前取回某个页面的分包；重复调用没有额外开销，失败（断网等）时静默，真正跳转时会再试。 */
export function prefetchRoute(key: LazyRouteKey): void {
  if (OFFLINE || requested.has(key)) return
  requested.add(key)
  routeLoaders[key]().catch(() => requested.delete(key))
}

export function prefetchPath(pathname: string): void {
  const key = lazyRouteForPath(pathname)
  if (key) prefetchRoute(key)
}

/**
 * 首屏渲染完、浏览器空闲之后，预取读者最可能点进去的文章页。
 * 返回取消函数（组件卸载时调用）。
 */
export function scheduleIdlePrefetch(keys: LazyRouteKey[] = ['post']): () => void {
  if (OFFLINE || typeof window === 'undefined') return () => {}
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
  if (!shouldIdlePrefetch(connection)) return () => {}

  let cancelled = false
  const run = () => {
    if (cancelled) return
    for (const key of keys) prefetchRoute(key)
  }
  const idle = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  // 先让首屏把自己的请求（头像、账号校验等）发完，再排到空闲时段。
  let idleId = 0
  const timer = window.setTimeout(() => {
    if (idle.requestIdleCallback) idleId = idle.requestIdleCallback(run, { timeout: 4000 })
    else run()
  }, 1200)
  return () => {
    cancelled = true
    window.clearTimeout(timer)
    if (idleId && idle.cancelIdleCallback) idle.cancelIdleCallback(idleId)
  }
}

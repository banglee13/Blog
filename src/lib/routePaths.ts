/**
 * 路由预取用到的纯函数（issue #128）：站内路径 → 按需加载的页面、链接地址 → 站内路径、
 * 以及「现在适不适合做空闲预取」的判断。刻意不引用任何页面模块，便于单独测试。
 * 真正的分包 loader 与预取调度在 src/routes.ts。
 */

/** 仍然按需加载的页面；首页、归档、标签、百宝箱、404 很小，直接在主包里。 */
export type LazyRouteKey = 'post' | 'about' | 'echo' | 'genshin' | 'login' | 'admin' | 'editor' | 'settings'

/** 站内路径（不含部署前缀）对应哪个按需加载的页面；已经在主包里的页面返回 null。 */
export function lazyRouteForPath(pathname: string): LazyRouteKey | null {
  const path = `/${pathname.replace(/^\/+|\/+$/g, '')}`
  if (path.startsWith('/posts/')) return 'post'
  if (path === '/about') return 'about'
  if (path === '/toolbox/echo') return 'echo'
  if (path === '/toolbox/genshin' || path.startsWith('/toolbox/genshin/')) return 'genshin'
  if (path === '/login') return 'login'
  if (path === '/settings' || path === '/admin/settings') return 'settings'
  if (path === '/admin/new' || path.startsWith('/admin/edit/') || path === '/editor' || path.startsWith('/editor/')) {
    return 'editor'
  }
  if (path === '/admin') return 'admin'
  return null
}

/**
 * 把链接地址换算成站内路径：只认同源、落在部署前缀之内的链接，其余返回 null。
 * `base` 是 Vite 的 `import.meta.env.BASE_URL`（如 `/Blog/` 或 `/`）。
 */
export function internalPathFromHref(href: string, base: string, origin: string): string | null {
  let url: URL
  try {
    url = new URL(href, origin)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  const prefix = base.endsWith('/') ? base : `${base}/`
  if (prefix !== '/' && !`${url.pathname}/`.startsWith(prefix)) return null
  return `/${url.pathname.slice(prefix.length)}`
}

/**
 * 站点的部署前缀（`/Blog/` 或 `/`）。只有 Vite 构建会注入 `import.meta.env`；
 * 在测试用的 esbuild 包里它不存在，按根路径处理。
 */
export function siteBasePath(): string {
  try {
    return import.meta.env.BASE_URL || '/'
  } catch {
    return '/'
  }
}

export interface NetworkInformationLike {
  saveData?: boolean
  effectiveType?: string
}

/** 省流量模式或 2G / 3G 网络下不做「猜测式」的空闲预取（按下链接时的预取不受影响）。 */
export function shouldIdlePrefetch(connection: NetworkInformationLike | undefined | null): boolean {
  if (!connection) return true
  if (connection.saveData) return false
  return !/(^|-)(2g|3g)$/.test(connection.effectiveType ?? '')
}

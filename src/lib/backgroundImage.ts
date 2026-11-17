import { useEffect, useState } from 'react'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'
import { OFFLINE } from './runtime'

/**
 * 固定背景图片（issue #126）的数据层：可选图片的来源、偏好的读写与校验、本机图片的保存。
 * 渲染在 components/Layout.tsx，界面在 components/BackgroundImageSettings.tsx。
 *
 * 图片有两个来源：
 *   - 仓库 `user_upload/background_image/` 下的任意图片（构建时收集，随站点一起部署）；
 *   - 访客从自己设备上选的一张图片。它只保存在这台设备的浏览器里（IndexedDB），不会上传到任何地方。
 *
 * 偏好本身（选了哪张、遮罩与模糊）走个人偏好存储，登录后会随其他设置一起同步到账号；
 * 本机图片的文件内容无法同步——换一台设备登录时，那台设备只会知道「这里用的是一张本地图片」。
 */

export type BackgroundImageSource = 'none' | 'repo' | 'local'

export interface BackgroundImagePreference {
  source: BackgroundImageSource
  /** source 为 repo 时：`user_upload/background_image/` 下的文件名 */
  file: string
  /** source 为 local 时：所选本机图片的文件名（只用于显示） */
  localName: string
  /** 遮罩浓度 0–90（%）：在图片上叠一层页面底色，数值越大图片越淡、文字越清楚 */
  dim: number
  /** 模糊半径 0–24（px） */
  blur: number
  updatedAt: number
}

export const BACKGROUND_IMAGE_DIM_MAX = 90
export const BACKGROUND_IMAGE_BLUR_MAX = 24
export const DEFAULT_BACKGROUND_IMAGE: BackgroundImagePreference = {
  source: 'none',
  file: '',
  localName: '',
  dim: 45,
  blur: 0,
  updatedAt: 0,
}

const SETTING_NAME = 'backgroundImage'
/** 本机图片被替换 / 移除后通知各处重新读取。 */
const LOCAL_IMAGE_EVENT = 'starlog:background-image-changed'

/* -------------------------------------------------------------------------- */
/*                          仓库里可选的背景图片                                 */
/* -------------------------------------------------------------------------- */

export interface RepoBackgroundImage {
  /** 文件名（含扩展名），也是偏好里保存的标识 */
  file: string
  /** 去掉扩展名的显示名称 */
  name: string
  url: string
}

/**
 * 构建时收集 `user_upload/background_image/` 下的图片：Vite 会把它们作为静态资源发出，
 * 这里拿到的是各自的访问地址。往这个目录里新增图片并推送后，下一次部署就会出现在设置里。
 *
 * 离线单文件版不内置这些图片：离线文件会把资源全部内联，一张背景就是一两 MB，
 * 目录里放得越多文件越大；离线版仍然可以选择本机图片。
 * 非 Vite 环境（测试用的 esbuild 包）没有 `import.meta.glob`，调用会抛错，此时视为没有图片。
 */
function readRepoBackgroundImages(): Record<string, string> {
  if (OFFLINE) return {}
  try {
    return import.meta.glob(
      '/user_upload/background_image/*.{jpg,jpeg,png,webp,avif,gif,JPG,JPEG,PNG,WEBP,AVIF,GIF}',
      { query: '?url', import: 'default', eager: true },
    ) as Record<string, string>
  } catch {
    return {}
  }
}

export function listRepoBackgroundImages(modules: Record<string, string>): RepoBackgroundImage[] {
  return Object.entries(modules)
    .map(([path, url]) => {
      const file = path.split('/').pop() ?? path
      return { file, name: file.replace(/\.[^.]+$/, ''), url }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
}

export const REPO_BACKGROUND_IMAGES: RepoBackgroundImage[] = listRepoBackgroundImages(readRepoBackgroundImages())

/* -------------------------------------------------------------------------- */
/*                               偏好读写与校验                                  */
/* -------------------------------------------------------------------------- */

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.round(Math.min(max, Math.max(min, parsed)))
}

/** 只保留文件名本身：去掉路径、控制字符，限制长度。 */
function cleanFileName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const base = value.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
}

/** 把任意输入（本地旧数据、账号同步下来的数据）规范成完整、合法的偏好。 */
export function normalizeBackgroundImage(raw: unknown): BackgroundImagePreference {
  if (!raw || typeof raw !== 'object') return DEFAULT_BACKGROUND_IMAGE
  const data = raw as Record<string, unknown>
  const file = cleanFileName(data.file)
  let source: BackgroundImageSource = data.source === 'repo' || data.source === 'local' ? data.source : 'none'
  if (source === 'repo' && !file) source = 'none'
  return {
    source,
    file,
    localName: cleanFileName(data.localName),
    dim: clampInteger(data.dim, 0, BACKGROUND_IMAGE_DIM_MAX, DEFAULT_BACKGROUND_IMAGE.dim),
    blur: clampInteger(data.blur, 0, BACKGROUND_IMAGE_BLUR_MAX, DEFAULT_BACKGROUND_IMAGE.blur),
    updatedAt: typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt) ? data.updatedAt : 0,
  }
}

export function readBackgroundImage(): BackgroundImagePreference {
  try {
    return normalizeBackgroundImage(readPersonalSetting<unknown>(SETTING_NAME))
  } catch {
    return DEFAULT_BACKGROUND_IMAGE
  }
}

/** 修改固定背景偏好（只传要改的字段），立即通知所有打开的视图。 */
export function updateBackgroundImage(patch: Partial<BackgroundImagePreference>): BackgroundImagePreference {
  const next = normalizeBackgroundImage({ ...readBackgroundImage(), ...patch, updatedAt: Date.now() })
  writePersonalSetting(SETTING_NAME, next)
  return next
}

/** 偏好对应的仓库图片；没有选仓库图片或图片已不在仓库里时返回 null。 */
export function findRepoBackgroundImage(
  pref: BackgroundImagePreference,
  images: RepoBackgroundImage[] = REPO_BACKGROUND_IMAGES,
): RepoBackgroundImage | null {
  if (pref.source !== 'repo') return null
  return images.find((image) => image.file === pref.file) ?? null
}

/**
 * 页面的两种「整屏」背景——固定背景图片与动态背景——同一时刻只显示一种。这里决定显示哪一种：
 *
 * - 文章开头的 `::set-background[<id>]` 在阅读该文章期间说了算：指定了场景就显示那个场景，
 *   指定「无」（`'none'`）就两者都不显示；`articleScene` 为 null 表示文章没有指定。
 * - 文章没有指定时：读者启用了固定背景图片就显示图片，动态背景让位
 *   （它是不透明的整屏画面，叠在一起只会把图片盖住，还白白耗电）。
 * - 否则显示读者选择的动态背景（默认「无」）。
 */
export function resolvePageBackground<Scene extends string>(input: {
  /** 文章强制的场景；没有强制时为 null */
  articleScene: Scene | null
  /** 读者自己选择的动态背景场景 */
  userScene: Scene
  /** 固定背景图片的地址；没有启用或取不到时为 null */
  imageUrl: string | null
}): { imageUrl: string | null; scene: Scene | 'none' } {
  if (input.articleScene !== null) return { imageUrl: null, scene: input.articleScene }
  if (input.imageUrl) return { imageUrl: input.imageUrl, scene: 'none' }
  return { imageUrl: null, scene: input.userScene }
}

/* -------------------------------------------------------------------------- */
/*                         本机图片：只存在这台设备上                             */
/* -------------------------------------------------------------------------- */

const DB_NAME = 'starlog-background'
const DB_STORE = 'images'
const LOCAL_KEY = 'local'

/** 允许选择的原图上限；更大的照片先请读者自己压一压，避免浏览器在解码时卡住。 */
export const LOCAL_IMAGE_MAX_BYTES = 30 * 1024 * 1024
/** 长边超过这个像素数、或文件超过 LOCAL_IMAGE_RECOMPRESS_BYTES 时，保存前先缩小重新编码。 */
const LOCAL_IMAGE_MAX_EDGE = 2880
const LOCAL_IMAGE_RECOMPRESS_BYTES = 3 * 1024 * 1024

interface StoredLocalImage {
  blob: Blob
  name: string
  savedAt: number
}

export interface LocalBackgroundImage {
  url: string
  name: string
  /** 是否已写入浏览器存储；false 表示只在本次打开期间有效（浏览器禁用了 IndexedDB 等） */
  persisted: boolean
}

/** 当前这张本机图片对应的对象地址；undefined 表示还没从存储里读过。 */
let localCache: LocalBackgroundImage | null | undefined

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = typeof indexedDB === 'undefined' ? null : indexedDB
    if (!factory) {
      reject(new Error('当前浏览器不支持 IndexedDB'))
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DB_NAME, 1)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开浏览器存储'))
    request.onblocked = () => reject(new Error('浏览器存储被其他标签页占用'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, mode)
      const request = run(transaction.objectStore(DB_STORE))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error('浏览器存储读写失败'))
      transaction.onabort = () => reject(transaction.error ?? new Error('浏览器存储读写被中止'))
    })
  } finally {
    db.close()
  }
}

function setLocalCache(next: LocalBackgroundImage | null) {
  if (localCache?.url && localCache.url !== next?.url) URL.revokeObjectURL(localCache.url)
  localCache = next
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LOCAL_IMAGE_EVENT))
}

/** 读取这台设备上保存的本机背景图片（没有则为 null）。结果会被缓存，重复调用不会重复读库。 */
export async function loadLocalBackgroundImage(): Promise<LocalBackgroundImage | null> {
  if (localCache !== undefined) return localCache
  try {
    const stored = await withStore<StoredLocalImage | undefined>('readonly', (store) => store.get(LOCAL_KEY))
    if (localCache !== undefined) return localCache
    localCache = stored?.blob
      ? { url: URL.createObjectURL(stored.blob), name: stored.name || '本地图片', persisted: true }
      : null
  } catch {
    // 存储不可用（无痕模式、被禁用）：当作没有保存过图片，页面照常显示默认背景。
    if (localCache === undefined) localCache = null
  }
  return localCache
}

/** 保存一张本机图片作为背景。存储不可用时退回为「只在本次打开期间有效」，不会因此失败。 */
export async function saveLocalBackgroundImage(blob: Blob, name: string): Promise<LocalBackgroundImage> {
  let persisted = true
  try {
    const record: StoredLocalImage = { blob, name, savedAt: Date.now() }
    await withStore('readwrite', (store) => store.put(record, LOCAL_KEY))
  } catch {
    persisted = false
  }
  const next = { url: URL.createObjectURL(blob), name, persisted }
  setLocalCache(next)
  return next
}

export async function removeLocalBackgroundImage(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(LOCAL_KEY))
  } catch {
    // 本来就没存进去（或存储不可用），清掉内存里的即可。
  }
  setLocalCache(null)
}

/** 等比缩小后的尺寸：长边不超过 maxEdge，不放大。 */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (!(longest > 0) || longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) }
  const ratio = maxEdge / longest
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
}

/**
 * 校验读者选的文件，并在需要时缩小：手机拍的照片常有上千万像素、五六 MB，
 * 原样当全屏背景既占存储，每次打开页面解码也慢；长边缩到 2880px 以内足够铺满 4K 屏幕。
 * GIF / SVG 不重新编码（会丢动画或矢量信息），其余格式缩小后存成 JPEG。
 */
export async function prepareLocalBackgroundImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件（JPG、PNG、WebP、AVIF、GIF 等）')
  if (file.size > LOCAL_IMAGE_MAX_BYTES) {
    throw new Error(`图片太大（${(file.size / 1024 / 1024).toFixed(1)} MB），请选择 30 MB 以内的图片`)
  }
  if (/^image\/(gif|svg\+xml)$/.test(file.type) || typeof createImageBitmap !== 'function') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('无法读取这张图片，文件可能已损坏或格式不受当前浏览器支持')
  }
  try {
    const target = fitWithin(bitmap.width, bitmap.height, LOCAL_IMAGE_MAX_EDGE)
    const needsResize = target.width !== bitmap.width || target.height !== bitmap.height
    if (!needsResize && file.size <= LOCAL_IMAGE_RECOMPRESS_BYTES) return file
    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, target.width, target.height)
    const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    // 重新编码后反而更大（本来就压得很好的小图）时保留原文件。
    return encoded && (needsResize || encoded.size < file.size) ? encoded : file
  } finally {
    bitmap.close()
  }
}

/* -------------------------------------------------------------------------- */
/*                                  React 订阅                                  */
/* -------------------------------------------------------------------------- */

export interface BackgroundImageState {
  pref: BackgroundImagePreference
  /** 实际要显示的图片地址；没有启用、或图片在这台设备上取不到时为 null */
  url: string | null
  /** 这台设备上保存的本机图片（无论当前是否选用） */
  localImage: LocalBackgroundImage | null
  /** 偏好要求显示图片，但这台设备上取不到（仓库里删掉了，或本机图片在另一台设备上） */
  missing: boolean
}

/** 订阅固定背景偏好与本机图片（设置页、其他标签页的修改都会立即生效）。 */
export function useBackgroundImage(): BackgroundImageState {
  const [pref, setPref] = useState(readBackgroundImage)
  const [localImage, setLocalImage] = useState<LocalBackgroundImage | null>(localCache ?? null)
  // 本机图片要异步从浏览器存储里读：读完之前不能断定「取不到」。
  const [localReady, setLocalReady] = useState(localCache !== undefined)

  useEffect(() => {
    const sync = (event?: Event) => {
      const name = (event as CustomEvent<{ name?: string }> | undefined)?.detail?.name
      if (!name || name === SETTING_NAME) setPref(readBackgroundImage())
    }
    window.addEventListener('starlog:settings-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('starlog:settings-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    let active = true
    const refresh = () => {
      void loadLocalBackgroundImage().then((image) => {
        if (!active) return
        setLocalImage(image)
        setLocalReady(true)
      })
    }
    refresh()
    window.addEventListener(LOCAL_IMAGE_EVENT, refresh)
    return () => {
      active = false
      window.removeEventListener(LOCAL_IMAGE_EVENT, refresh)
    }
  }, [])

  const url =
    pref.source === 'repo'
      ? (findRepoBackgroundImage(pref)?.url ?? null)
      : pref.source === 'local'
        ? (localImage?.url ?? null)
        : null

  const missing = !url && (pref.source === 'repo' || (pref.source === 'local' && localReady))
  return { pref, url, localImage, missing }
}

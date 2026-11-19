/**
 * 固定背景图（issue #126）。
 *
 * 需求原文：「可以切换为 `/user_upload/background_image` 下的任意背景，也可以选择本地的图片」。
 * 所以有两条来源：
 *   · 仓库图片：站长把图丢进 `user_upload/background_image/`，读者在设置页里挑一张；
 *     站点部署在 GitHub Pages 时 `user_upload/` 不属于发布目录，因此按 raw 地址取原图。
 *   · 本机图片：读者选本地文件，压到合理尺寸后转成 data URI 只存在浏览器里
 *     （不上传仓库，也不会有任何网络请求）。
 *
 * 背景图与「背景颜色 + 渐变强度」是两套独立偏好：颜色仍然有效，图在颜色之上、内容之下；
 * 「压暗」用来保证压在有对比度的图片上时正文仍然可读。
 *
 * 离线单文件版：不联网，所以列表为空、仓库图片不加载；本机图片（data URI）照常可用。
 */
import { useEffect, useState } from 'react'
import { githubConfig, STORAGE_KEYS } from './config'
import { getRepoTarget, listRepoDirectory } from './github'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'
import { OFFLINE, resolveOfflineImageSrc } from './runtime'

/** 站长放背景图的仓库目录（issue #126 里点名的路径） */
export const BACKGROUND_IMAGE_DIR = 'user_upload/background_image'

/** raw.githubusercontent.com 只在构建线上版时存在；离线产物里连这个域名都不该出现。 */
const RAW_BASE = OFFLINE ? '' : 'https://raw.githubusercontent.com'

/** 本机图片允许的最大 data URI 长度（约 1.3MB）。localStorage 通常只有 5MB，要给文章留地方。 */
export const LOCAL_BACKGROUND_IMAGE_LIMIT = 1_300_000
/** 压图时保留的最长边 */
export const BACKGROUND_IMAGE_MAX_EDGE = 1920

export type BackgroundImageSource = 'repo' | 'local' | 'url'
export type BackgroundImageFit = 'cover' | 'contain'

export interface BackgroundImagePreference {
  enabled: boolean
  /** 图片地址：仓库图片是 raw 绝对地址，本机图片是 data URI */
  url: string
  /** 展示名（本机图片用文件名，仓库图片用文件名去掉扩展名） */
  label: string
  source: BackgroundImageSource
  fit: BackgroundImageFit
  /** 0–80：图片上叠一层深色遮罩的浓度，保证正文可读 */
  dim: number
  /** 是否固定不随页面滚动（issue #126 标题里的「固定背景」） */
  fixed: boolean
  updatedAt: number
}

export const DEFAULT_BACKGROUND_IMAGE: BackgroundImagePreference = {
  enabled: false,
  url: '',
  label: '',
  source: 'repo',
  fit: 'cover',
  dim: 20,
  fixed: true,
  updatedAt: 0,
}

/** 只接受 http(s) 与 data URI，挡掉 `javascript:` / `url(...)` 之类会被塞进 CSS 的写法。 */
export function normalizeBackgroundImageUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  if (!url) return ''
  // 上限与 readLocalBackgroundImage() 一致：能存进来的地址就必须能被接受，反之直接拒绝
  if (url.length > LOCAL_BACKGROUND_IMAGE_LIMIT) return ''
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(url)) return url
  if (/^https?:\/\/[^\s"'<>\\]+$/i.test(url)) return url
  return ''
}

/** 手写 / 旧版数据里 false 可能是 0 或 'false'；只认这三种写法，其余按默认（固定）处理。 */
function isExplicitlyFalse(value: unknown): boolean {
  return value === false || value === 0 || value === 'false'
}

function normalizeDim(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_BACKGROUND_IMAGE.dim
  return Math.round(Math.min(80, Math.max(0, number)))
}

/** 把任意来源（本机旧数据 / 账号快照）规范成一份完整可用的偏好。 */
export function normalizeBackgroundImage(raw: unknown): BackgroundImagePreference {
  if (!raw || typeof raw !== 'object') return DEFAULT_BACKGROUND_IMAGE
  const data = raw as Partial<BackgroundImagePreference> & Record<string, unknown>
  const url = normalizeBackgroundImageUrl(data.url)
  const sources: BackgroundImageSource[] = ['repo', 'local', 'url']
  return {
    enabled: data.enabled === true && url !== '',
    url,
    label: typeof data.label === 'string' ? data.label.slice(0, 80) : '',
    source: sources.includes(data.source as BackgroundImageSource) ? (data.source as BackgroundImageSource) : 'repo',
    fit: data.fit === 'contain' ? 'contain' : 'cover',
    dim: normalizeDim(data.dim),
    /** 只有明确写了 false（含 0 / 'false' 这类手写值）才算「随页面滚动」 */
    fixed: !isExplicitlyFalse(data.fixed),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  }
}

/** 仓库目录里一个文件对应的 raw 地址。 */
export function repoImageUrl(fileName: string, target = getRepoTarget()): string {
  const safe = fileName.trim().replace(/^\/+/, '').replace(/[\\]/g, '')
  if (!safe) return ''
  // 已经写成完整 URL 的原样返回（README 里贴链接也能用）
  if (/^(https?:)?\/\//i.test(safe)) return safe.replace(/^\/\//, 'https://')
  if (OFFLINE) return ''
  return `${RAW_BASE}/${target.owner}/${target.repo}/${target.branch}/${BACKGROUND_IMAGE_DIR}/${safe
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
}

/** 从 raw / contents 地址里取出用于展示的文件名。 */
export function fileNameFromUrl(url: string): string {
  const tail = url.split('/').pop() ?? ''
  try {
    return decodeURIComponent(tail)
  } catch {
    return tail
  }
}

export interface BackgroundImageChoice {
  /** 文件名（相对 BACKGROUND_IMAGE_DIR） */
  name: string
  label: string
  url: string
  size: number
}

/**
 * 列出仓库 `user_upload/background_image` 下的图片。
 *
 * 用 contents API（公开仓库不需要登录；已登录时用 token，能顺便读到私有仓库）。
 * 离线版直接返回空数组——这个文件不联网，也不会去猜某个地址。
 */
export async function listRepoBackgroundImages(): Promise<BackgroundImageChoice[]> {
  if (OFFLINE) return []
  return buildBackgroundImageChoices(
    await listRepoDirectory(BACKGROUND_IMAGE_DIR).catch((err) => {
      throw new Error(
        err instanceof Error ? `读取仓库背景图列表失败：${err.message}` : '读取仓库背景图列表失败',
      )
    }),
  )
}

/** 与网络层解耦的过滤逻辑（便于单测）。 */
export function pickImageEntries(
  entries: { name: string; type?: string; size?: number }[],
): string[] {
  return entries
    .filter((entry) => (entry.type ? entry.type === 'file' : true))
    .map((entry) => entry.name)
    .filter((name) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

/** 把 contents API 返回的目录条目转成可选背景图列表（纯函数，可单测）。 */
export function buildBackgroundImageChoices(
  entries: { name: string; type?: string; size?: number }[],
): BackgroundImageChoice[] {
  return pickImageEntries(entries).map((name) => ({
    name,
    label: name.replace(/\.[a-z0-9]+$/i, ''),
    url: repoImageUrl(name),
    size: 0,
  }))
}

/* ---------------------------------- 本机图片 ---------------------------------- */

/** 读文件并压成合适的 data URI：过长边缩放、按质量重编码，最后校验总量。 */
export async function readLocalBackgroundImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
  if (dataUrl.length <= LOCAL_BACKGROUND_IMAGE_LIMIT) {
    // 已经足够小：GIF 之类还要保留动图 / 透明，不再重编码
    return dataUrl
  }
  const shrunk = await downscaleImage(dataUrl, file.type)
  if (shrunk.length <= LOCAL_BACKGROUND_IMAGE_LIMIT) return shrunk
  throw new Error(
    `这张图太大（压缩后仍有 ${(shrunk.length / 1024 / 1024).toFixed(1)}MB），` +
      `上限 ${(LOCAL_BACKGROUND_IMAGE_LIMIT / 1024 / 1024).toFixed(1)}MB。` +
      '请改用更小的图，或把它放进仓库的 ' + BACKGROUND_IMAGE_DIR + ' 目录后从列表里选。',
  )
}

async function downscaleImage(dataUrl: string, mime: string): Promise<string> {
  if (typeof document === 'undefined') return dataUrl
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('无法解析这张图片'))
    el.src = dataUrl
  })
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) return dataUrl
  const scale = Math.min(1, BACKGROUND_IMAGE_MAX_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) return dataUrl
  // 透明 PNG 压成 JPEG 会把透明填成黑底，所以带透明通道时退回 PNG 缩放
  const keepPng = /png/i.test(mime)
  if (keepPng) {
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  }
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  let quality = 0.82
  let out = canvas.toDataURL('image/jpeg', quality)
  while (out.length > LOCAL_BACKGROUND_IMAGE_LIMIT && quality > 0.4) {
    quality -= 0.12
    out = canvas.toDataURL('image/jpeg', quality)
  }
  return out
}

/* ------------------------------- 读写与订阅 ------------------------------- */

export function readBackgroundImage(): BackgroundImagePreference {
  if (typeof window === 'undefined') return DEFAULT_BACKGROUND_IMAGE
  try {
    return normalizeBackgroundImage(readPersonalSetting<unknown>('backgroundImage', STORAGE_KEYS.backgroundImage))
  } catch {
    return DEFAULT_BACKGROUND_IMAGE
  }
}

export function writeBackgroundImage(next: BackgroundImagePreference): BackgroundImagePreference {
  writePersonalSetting('backgroundImage', next)
  return next
}

export function clearBackgroundImage(): BackgroundImagePreference {
  return writeBackgroundImage({ ...DEFAULT_BACKGROUND_IMAGE, updatedAt: Date.now() })
}

/** 订阅背景图偏好（同一页面的其他视图与其他标签页改动都会立即生效）。 */
export function useBackgroundImage(): BackgroundImagePreference {
  const [pref, setPref] = useState<BackgroundImagePreference>(readBackgroundImage)
  useEffect(() => {
    const sync = (event?: Event) => {
      const name = (event as CustomEvent<{ name?: string }> | undefined)?.detail?.name
      if (!name || name === 'backgroundImage') setPref(readBackgroundImage())
    }
    window.addEventListener('starlog:settings-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('starlog:settings-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return pref
}

/**
 * 背景图层真正用的地址。
 *
 * 离线版里远程地址一律解析为空（不联网），此时整层不渲染，也不会留下一张破图。
 */
export function backgroundImageSrc(pref: BackgroundImagePreference): string {
  if (!pref.enabled || !pref.url) return ''
  return resolveOfflineImageSrc(pref.url)
}

/**
 * 图层真正该显示的那张图：读者没选过时，退回站长在 `githubConfig.defaultBackgroundImage`
 * 里指定的站点默认背景（issue #126）。读者一旦自己选过，就永远以读者的为准。
 */
export function resolveBackgroundImage(
  pref: BackgroundImagePreference,
): BackgroundImagePreference {
  if (pref.enabled && pref.url) return pref
  const fallback = defaultBackgroundImageUrl()
  if (!fallback) return pref
  return {
    ...DEFAULT_BACKGROUND_IMAGE,
    enabled: true,
    url: fallback,
    label: '站点默认背景',
    source: 'repo',
    dim: 25,
  }
}

/** 关掉站点时站长不需要写代码：把文件名放进 config 就能给所有访客铺一张默认背景。 */
export function defaultBackgroundImageUrl(): string {
  const name = githubConfig.defaultBackgroundImage?.trim()
  return name ? repoImageUrl(name) : ''
}

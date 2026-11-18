/**
 * 账号设置快照（issue #129 / #130）。
 *
 * 两条要求：
 *   1. #129：所有个人设置（颜色、字号、背景、动态背景、编辑器偏好……）都要跟着 GitHub
 *      账号走，登录即自动保存 / 自动恢复，不需要用户逐个点「保存」。
 *   2. #130：这些设置**不该写进仓库**。仓库里躺着一堆 `<login>.json` 既污染提交历史，
 *      又要求每个读者都有 Contents 写权限。改成每人一条 GitHub Discussion（正文里放
 *      JSON 代码块），读写走 Discussions API，仓库文件不再变化。
 *
 * 本模块只做纯计算：快照的序列化 / 解析 / 合并 / 白名单与校验。不碰 React、不碰网络，
 * 因此 `scripts/test-features.mjs` 可以直接跑它。真正的读写在 `github.ts`，
 * 「什么时候自动保存」的编排在 `settingsSync.ts`。
 */

/** 快照格式版本：字段含义变化时递增，解析旧快照时按版本兼容。 */
export const SETTINGS_SNAPSHOT_VERSION = 2

/** GitHub 的评论 / 讨论正文上限是 65536 字符，留出外壳与提示文案的余量。 */
export const SETTINGS_BODY_LIMIT = 60_000
/** 单项偏好的序列化上限：背景图 data URL 这类大块头不进快照。 */
export const SETTINGS_VALUE_LIMIT = 8_000

import type { PersonalSettings } from './settingsStore'

export type { PersonalSettings }

export interface SyncedSettingSpec {
  /** settingsStore 里的键名 */
  name: string
  /** 设置页展示用的名字 */
  label: string
  /** 校验快照里的值是否可信；不合法就丢弃这一项，其余照常恢复 */
  valid: (value: unknown) => boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const isObject = isRecord

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/**
 * 参与云端同步的偏好白名单。
 *
 * 只有列在这里的键会被上传，其余本机状态（登录令牌、本地草稿、离线文章库、
 * 待更新队列、跨设备无意义的缓存）永远留在浏览器里 —— 这是「不泄露凭据」的硬保证。
 */
export const SYNCED_SETTINGS: SyncedSettingSpec[] = [
  {
    name: 'font',
    label: '字体与字号',
    valid: (value) => {
      if (!isObject(value)) return false
      const font = value as { families?: unknown; monoFamilies?: unknown; sizePercent?: unknown }
      const familiesOk =
        font.families === undefined ||
        (Array.isArray(font.families) && font.families.every((f) => typeof f === 'string'))
      const monoOk =
        font.monoFamilies === undefined ||
        (Array.isArray(font.monoFamilies) && font.monoFamilies.every((f) => typeof f === 'string'))
      const sizeOk =
        font.sizePercent === undefined ||
        (typeof font.sizePercent === 'number' &&
          Number.isFinite(font.sizePercent) &&
          font.sizePercent >= 50 &&
          font.sizePercent <= 200)
      return familiesOk && monoOk && sizeOk
    },
  },
  {
    name: 'background',
    label: '背景颜色与渐变强度',
    valid: (value) => {
      if (!isObject(value)) return false
      const data = value as { color?: unknown; intensity?: unknown }
      return (
        typeof data.color === 'string' &&
        (data.color === '' || /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(data.color))
      )
    },
  },
  {
    name: 'backgroundImage',
    label: '固定背景图',
    valid: (value) => {
      if (!isObject(value)) return false
      const data = value as { enabled?: unknown; url?: unknown }
      // 本机图片（data: URL）体积远超快照上限，由 collect 阶段按大小过滤；
      // 这里只保证结构合法，恢复时 src 为 local 的图片会因为读不到而自动回退到仓库地址。
      return isBoolean(data.enabled) && typeof data.url === 'string'
    },
  },
  {
    name: 'colorTheme',
    label: '配色主题',
    valid: (value) => typeof value === 'string' && value.length <= 40,
  },
  {
    name: 'siteLayout',
    label: '站点外观',
    valid: (value) => value === 'classic' || value === 'galaxy',
  },
  {
    name: 'themeMode',
    label: '浅色 / 深色模式',
    valid: (value) => value === 'light' || value === 'dark' || value === 'system',
  },
  {
    name: 'animatedBackground',
    label: '动态背景',
    valid: (value) => isObject(value) && typeof (value as { scene?: unknown }).scene === 'string',
  },
  {
    name: 'editorScrollSync',
    label: '编辑器双栏同步滚动',
    valid: isBoolean,
  },
  {
    name: 'editorScrollPastEnd',
    label: '编辑区末尾留白',
    valid: isBoolean,
  },
  {
    name: 'repository',
    label: '目标仓库',
    valid: (value) => {
      if (!isObject(value)) return false
      const data = value as { owner?: unknown; repo?: unknown }
      return typeof data.owner === 'string' && typeof data.repo === 'string'
    },
  },
]

const SPEC_BY_NAME = new Map(SYNCED_SETTINGS.map((spec) => [spec.name, spec]))

export function isSyncedSetting(name: string): boolean {
  return SPEC_BY_NAME.has(name)
}

export function syncedSettingLabel(name: string): string {
  return SPEC_BY_NAME.get(name)?.label ?? name
}

export interface CollectedSettings {
  values: PersonalSettings
  /** 未进入快照的偏好名 → 原因，界面要如实说明，不能假装已经同步了 */
  skipped: Record<string, string>
}

/**
 * 从本机偏好里挑出「可上传」的项。
 *
 * 过大的值（本机图片的 data URL、超长自定义字体列表）会被跳过而不是截断——
 * 截断后的 JSON 解析失败会连累整份快照。
 */
export function collectSyncedSettings(all: PersonalSettings): CollectedSettings {
  const values: PersonalSettings = {}
  const skipped: Record<string, string> = {}
  for (const spec of SYNCED_SETTINGS) {
    if (!(spec.name in all)) continue
    const value = all[spec.name]
    if (value === undefined || value === null) continue
    if (!spec.valid(value)) {
      skipped[spec.name] = '格式不合法，已跳过'
      continue
    }
    const size = measureChars(value)
    if (size > SETTINGS_VALUE_LIMIT) {
      skipped[spec.name] = `内容过大（${size} 字符，上限 ${SETTINGS_VALUE_LIMIT}），仅保存在本机`
      continue
    }
    values[spec.name] = value
  }
  return { values, skipped }
}

/** UTF-16 字符数（与 GitHub 对正文长度的计数口径一致，不是字节数）。 */
export function measureChars(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export interface SettingsSnapshot {
  version: number
  login: string
  /** 快照写入时间，仅用于显示和兼容旧版。 */
  updatedAt: number
  values: PersonalSettings
  stamps?: Record<string, number>
  skipped?: Record<string, string>
}

export function settingStamp(snapshot: SettingsSnapshot, name: string): number {
  return snapshot.stamps?.[name] ?? (snapshot.version === 1 ? snapshot.updatedAt : 0)
}

/** Compare each value with the latest remote value before replacing the discussion. */
export function mergeSettingsForSave(local: SettingsSnapshot, remote: SettingsSnapshot | null): SettingsSnapshot {
  const values = { ...remote?.values }
  const stamps = Object.fromEntries(Object.keys(values).map((name) => [name, settingStamp(remote!, name)]))
  for (const [name, value] of Object.entries(local.values)) {
    const stamp = settingStamp(local, name)
    if (!(name in values) || stamp > stamps[name]) {
      values[name] = value
      stamps[name] = stamp
    }
  }
  return { ...local, values, stamps }
}

export function settingsDiscussionMarker(login: string): string {
  return `<!-- starlog:settings ${login} -->`
}

export function settingsDiscussionTitle(login: string): string {
  return `⚙️ @${login} 的博客设置`
}

/**
 * 生成讨论正文：标记 + 说明 + JSON 代码块。
 *
 * 代码块的语言写成 `starlog-settings`，人类仍然能读懂，脚本用固定标记定位；
 * 超出行长上限时按体积从大到小丢项（优先保住字号 / 主题这类小而有用的偏好）。
 */
export function renderSettingsDiscussionBody(login: string, snapshot: SettingsSnapshot): string {
  const values = { ...snapshot.values }
  const skipped = { ...(snapshot.skipped ?? {}) }
  let json = serializeSnapshot({ ...snapshot, values, skipped })
  while (json.length > SETTINGS_BODY_LIMIT && Object.keys(values).length > 0) {
    const largest = Object.entries(values)
      .sort((a, b) => measureChars(b[1]) - measureChars(a[1]))[0]
    if (!largest) break
    delete values[largest[0]]
    skipped[largest[0]] = '超出讨论正文长度上限，仅保存在本机'
    json = serializeSnapshot({ ...snapshot, values, skipped })
  }
  return [
    settingsDiscussionMarker(login),
    '',
    `这一条讨论由 **博客站点自动维护**，用于保存 @${login} 的个人设置（配色主题、明暗模式、字体与字号、背景、编辑器偏好等），`,
    '换设备登录后会自动恢复。请勿手动编辑下面的 JSON —— 改动会在下一次自动保存时被覆盖。',
    '',
    '设置不会写进仓库文件，因此不会污染提交历史，也不需要仓库写入权限。',
    '不想让设置跨设备同步时，在站点「设置 → 账号设置同步」里关掉自动保存即可。',
    '',
    '```json',
    json,
    '```',
    '',
  ].join('\n')
}

function serializeSnapshot(snapshot: SettingsSnapshot): string {
  return JSON.stringify({
    version: snapshot.version || SETTINGS_SNAPSHOT_VERSION,
    login: snapshot.login,
    updatedAt: snapshot.updatedAt,
    values: snapshot.values,
    ...(snapshot.stamps && {
      stamps: Object.fromEntries(Object.keys(snapshot.values).map((name) => [name, settingStamp(snapshot, name)])),
    }),
    ...(snapshot.skipped && Object.keys(snapshot.skipped).length > 0 ? { skipped: snapshot.skipped } : {}),
  })
}

/**
 * 从讨论正文里取回快照。取不到（被人为改坏 / 版本不认 / JSON 非法）时返回 null，
 * 调用方按「远端还没有设置」处理，绝不半途恢复出半个状态。
 */
export function parseSettingsDiscussionBody(body: string, expectedLogin?: string): SettingsSnapshot | null {
  if (typeof body !== 'string' || !body) return null
  const block = body.match(/```(?:json|starlog-settings)?\s*\n([\s\S]*?)\n\s*```/)
  if (!block) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(block[1])
  } catch {
    return null
  }
  if (!isObject(parsed)) return null
  const data = parsed as {
    version?: unknown
    login?: unknown
    updatedAt?: unknown
    values?: unknown
    stamps?: unknown
    skipped?: unknown
  }
  if (typeof data.version === 'number' && data.version > SETTINGS_SNAPSHOT_VERSION) return null
  if (!isObject(data.values)) return null
  const login = typeof data.login === 'string' ? data.login : ''
  if (expectedLogin && login && login !== expectedLogin) return null
  const values: PersonalSettings = {}
  const stamps: Record<string, number> = {}
  const skipped: Record<string, string> = {}
  for (const [name, value] of Object.entries(data.values)) {
    const spec = SPEC_BY_NAME.get(name)
    // 未知键（别的版本写进来的）与不合法的值都直接丢掉，避免把坏数据灌回本地存储
    if (!spec || !spec.valid(value)) continue
    values[name] = value
    const stamp = isObject(data.stamps) ? data.stamps[name] : undefined
    if (typeof stamp === 'number' && Number.isFinite(stamp) && stamp >= 0) stamps[name] = stamp
  }
  if (isObject(data.skipped)) {
    for (const [name, reason] of Object.entries(data.skipped)) {
      if (typeof reason === 'string') skipped[name] = reason
    }
  }
  return {
    version: typeof data.version === 'number' ? data.version : 1,
    login,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    values,
    stamps,
    skipped: Object.keys(skipped).length > 0 ? skipped : undefined,
  }
}

export interface MergeInput {
  /** 远端快照里的值 */
  remote: PersonalSettings
  /** 远端快照的写入时间 */
  remoteUpdatedAt: number
  remoteStamps?: Record<string, number>
  /** 本机各偏好最后一次被改动的时间（由 settingsSync 记录） */
  localStamps: Record<string, number>
}

export interface MergeResult {
  /** 应当从远端写回本机的偏好 */
  apply: PersonalSettings
  /** 本机更新、保留不动（下一次自动保存会把它们推上去）的偏好 */
  keepLocal: string[]
  /** 本机根本没有、直接采用远端值的偏好 */
  fresh: string[]
}

/**
 * 逐条比较「本机最后改动时间」与「远端快照时间」：
 * 本机在那之后改过的项目保留本机值，其余采用远端值。
 * 这样多设备切换时不会因为某一台的旧快照而整体回退。
 */
export function mergeRemoteSettings({ remote, remoteUpdatedAt, remoteStamps, localStamps }: MergeInput): MergeResult {
  const apply: PersonalSettings = {}
  const keepLocal: string[] = []
  const fresh: string[] = []
  for (const [name, value] of Object.entries(remote)) {
    const stamp = localStamps[name]
    if (typeof stamp === 'number' && stamp > (remoteStamps?.[name] ?? remoteUpdatedAt)) {
      keepLocal.push(name)
      continue
    }
    apply[name] = value
    if (typeof stamp !== 'number') fresh.push(name)
  }
  return { apply, keepLocal, fresh }
}

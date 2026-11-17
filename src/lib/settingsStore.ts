import { STORAGE_KEYS } from './config'

type PersonalSettings = Record<string, unknown>

/**
 * 写入来源：
 * - `local`（默认）：读者在这台设备上改的设置，会记录修改时间，登录后由设置同步推送到账号；
 * - `sync`：设置同步从账号取回来的值，按它在账号里的修改时间入账，不会被当成新的本机改动再推回去。
 */
export type SettingSource = 'local' | 'sync'

export interface SettingWriteOptions {
  source?: SettingSource
  /** 这次修改发生的时间（毫秒）；省略时取当前时间 */
  at?: number
}

export interface SettingChangeDetail {
  name: string
  source: SettingSource
}

/** 「明暗模式」不在统一的偏好对象里（首屏脚本要在 React 启动前读它），同步时用这个名字指代它。 */
export const THEME_MODE_SETTING = 'themeMode'

function readAll(): PersonalSettings {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.personalSettings)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as PersonalSettings : {}
  } catch {
    return {}
  }
}

/** 读取完整偏好对象（离线档案导出 / 导入整份偏好、设置同步时使用） */
export function readPersonalSettings(): PersonalSettings {
  return readAll()
}

/**
 * Personal preferences use a browser-local
 * JSON store and a custom event so every open view can refresh immediately.
 * `legacyKey` keeps installations made before the consolidated store working.
 */
export function readPersonalSetting<T>(name: string, legacyKey?: string): T | null {
  const all = readAll()
  if (name in all) return all[name] as T
  if (!legacyKey || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(legacyKey)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/*                      每项设置最后一次修改的时间（同步用）                       */
/* -------------------------------------------------------------------------- */

/**
 * 设置同步按「每一项设置谁改得晚听谁的」合并各设备的改动，所以每次写入都记下时间。
 * 不管有没有登录都记：先在本机调好再登录时，这些刚改过的设置应当算作最新的。
 * 没有记录的项（这个机制上线之前留下的设置）视为时间 0。
 */
export function readSettingTimes(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.settingTimes) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const times: Record<string, number> = {}
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) times[name] = value
    }
    return times
  } catch {
    return {}
  }
}

export function writeSettingTimes(times: Record<string, number>) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEYS.settingTimes, JSON.stringify(times))
  } catch {
    // 时间戳写不进去不影响设置本身生效，只是这一项在同步时会被当成「旧的」。
  }
}

function recordSettingTime(name: string, at: number, source: SettingSource) {
  const times = readSettingTimes()
  // 本机的新改动一定要比这一项已知的时间更晚：别的设备时钟偏快时，取回来的时间可能在「未来」，
  // 若直接记当前时间，这台设备之后的修改会一直被判成「更旧」而在下次同步时被改回去。
  times[name] = source === 'sync' ? at : Math.max(at, (times[name] ?? 0) + 1)
  writeSettingTimes(times)
}

function announce(name: string, source: SettingSource) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<SettingChangeDetail>('starlog:settings-changed', { detail: { name, source } }),
  )
}

export function writePersonalSetting<T>(name: string, value: T, options: SettingWriteOptions = {}) {
  if (typeof localStorage === 'undefined') return
  const all = readAll()
  all[name] = value
  localStorage.setItem(STORAGE_KEYS.personalSettings, JSON.stringify(all))
  const source = options.source ?? 'local'
  recordSettingTime(name, options.at ?? Date.now(), source)
  announce(name, source)
}

/* -------------------------------------------------------------------------- */
/*                                  明暗模式                                    */
/* -------------------------------------------------------------------------- */

export type StoredThemeMode = 'light' | 'dark' | 'system'

export function isThemeMode(value: unknown): value is StoredThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** 读取保存的明暗模式；没有保存过（或值非法）时返回 null，由调用方决定跟随系统。 */
export function readStoredThemeMode(): StoredThemeMode | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.theme)
    return isThemeMode(stored) ? stored : null
  } catch {
    return null
  }
}

/**
 * 保存明暗模式并通知各处。只在读者主动切换（或同步取回新值）时调用——
 * 首次访问时「按系统明暗定一个初始值」不算一次修改，不应该盖过账号里已有的选择。
 */
export function writeThemeMode(mode: StoredThemeMode, options: SettingWriteOptions = {}) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEYS.theme, mode)
  } catch {
    // 无痕模式等存不进去：本次会话内仍然生效。
  }
  const source = options.source ?? 'local'
  recordSettingTime(THEME_MODE_SETTING, options.at ?? Date.now(), source)
  announce(THEME_MODE_SETTING, source)
}

/**
 * 账号设置自动同步的编排层（issue #129 / #130）。
 *
 * 职责：
 *   · 登录状态变化时自动恢复：拉取该账号的设置讨论，逐条合并后写回本机；
 *   · 本机任何偏好被改动时，去抖若干秒后自动保存（写回同一条讨论）。用户不用再点
 *     「保存到 GitHub 账号」，也不用再过「待更新队列」——设置不是仓库内容，不该产生提交；
 *   · 记录每个偏好的本机最后改动时间，用来判断「远端快照与本机谁更新」；
 *   · 把旧版写在仓库 `.starlog/settings/**` 里的偏好迁移到 Discussions，并提供清理入口。
 *
 * 快照格式、合并规则与白名单校验在 `settingsSnapshot.ts`（纯函数，可单测）；
 * 与 GitHub 的实际读写在 `github.ts`。这里只负责「什么时候同步、状态怎么显示」。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { readPersonalSettings, writePersonalSetting, type PersonalSettings } from './settingsStore'
import {
  clearSettingsRefCache,
  deleteLegacySettingsFiles,
  legacySettingsPaths,
  loadGithubSettingsSnapshot,
  loadLegacySettingsValues,
  saveGithubSettingsSnapshot,
} from './github'
import {
  collectSyncedSettings,
  isSyncedSetting,
  mergeRemoteSettings,
  settingStamp,
  SETTINGS_SNAPSHOT_VERSION,
  syncedSettingLabel,
  type SettingsSnapshot,
} from './settingsSnapshot'
import { settingsSyncConfig, STORAGE_KEYS } from './config'
import { useAuth } from './auth'
import { OFFLINE } from './runtime'
import { useToast } from '../components/Toast'

export type SettingsSyncStatus =
  /** 离线单文件版：没有账号体系，也完全不联网 */
  | 'off'
  /** 未登录：设置只留在本机浏览器 */
  | 'local'
  /** 正在从账号读取 */
  | 'restoring'
  /** 正在写回账号 */
  | 'saving'
  /** 与账号一致 */
  | 'synced'
  /** 本机有改动等着上传（去抖窗口内） */
  | 'pending'
  | 'error'

export interface SettingsSyncState {
  status: SettingsSyncStatus
  /** 自动保存开关（本机设置，故意不参与同步：否则一台设备关掉就全体都关了） */
  enabled: boolean
  /** 已登录且仓库可写，能做云端同步 */
  canSync: boolean
  lastSyncedAt: number
  lastError: string
  /** 设置讨论在 GitHub 上的地址 */
  remoteUrl: string | null
  /** 实际使用的 Discussions 分类名（配置里没有 Settings 分类时会退回评论分类） */
  categoryName: string
  /** 已改动、还没上传的偏好（界面标签） */
  pending: string[]
  /** 因体积或格式没有进入快照的偏好：键 → 原因 */
  skipped: Record<string, string>
  /** 仓库里残留的旧版设置文件路径 */
  legacyFiles: string[]
}

interface SettingsSyncCtxValue extends SettingsSyncState {
  /** 立即把本机偏好写回账号（设置页的「立即保存」） */
  saveNow: () => Promise<void>
  /** 立即从账号重新拉取并合并（设置页的「重新载入」） */
  restoreNow: () => Promise<void>
  setEnabled: (enabled: boolean) => void
  /** 删除仓库里的旧版设置文件（站长主动清理，不会自动发生） */
  cleanLegacyFiles: () => Promise<void>
}

const Ctx = createContext<SettingsSyncCtxValue>({
  status: OFFLINE ? 'off' : 'local',
  enabled: true,
  canSync: false,
  lastSyncedAt: 0,
  lastError: '',
  remoteUrl: null,
  categoryName: '',
  pending: [],
  skipped: {},
  legacyFiles: [],
  saveNow: async () => {},
  restoreNow: async () => {},
  setEnabled: () => {},
  cleanLegacyFiles: async () => {},
})

/** 时间戳表最多留这么多条，避免这个键无限增长 */
const STAMP_LIMIT = 40

interface SyncMeta {
  enabled: boolean
  lastSyncedAt: number
  /** 上次成功上传的快照指纹：避免多个标签页把同一份内容反复上传 */
  lastPushedFingerprint: string
  stamps: Record<string, number>
}

const DEFAULT_META: SyncMeta = {
  enabled: true,
  lastSyncedAt: 0,
  lastPushedFingerprint: '',
  stamps: {},
}

function readMeta(): SyncMeta {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_META }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settingsSync)
    if (!raw) return { ...DEFAULT_META }
    const parsed = JSON.parse(raw) as Partial<SyncMeta>
    const stamps: Record<string, number> = {}
    if (parsed.stamps && typeof parsed.stamps === 'object' && !Array.isArray(parsed.stamps)) {
      for (const [name, value] of Object.entries(parsed.stamps as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) stamps[name] = value
      }
    }
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      lastSyncedAt: typeof parsed.lastSyncedAt === 'number' ? parsed.lastSyncedAt : 0,
      lastPushedFingerprint:
        typeof parsed.lastPushedFingerprint === 'string' ? parsed.lastPushedFingerprint : '',
      stamps: trimStamps(stamps),
    }
  } catch {
    return { ...DEFAULT_META }
  }
}

function writeMeta(meta: SyncMeta) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEYS.settingsSync, JSON.stringify({ ...meta, stamps: trimStamps(meta.stamps) }))
  } catch {
    // 无痕模式 / 配额写满：状态显示会退化，同步本身照常进行
  }
}

function trimStamps(stamps: Record<string, number>): Record<string, number> {
  const entries = Object.entries(stamps).sort((a, b) => b[1] - a[1])
  if (entries.length <= STAMP_LIMIT) return stamps
  return Object.fromEntries(entries.slice(0, STAMP_LIMIT))
}

/** 廉价指纹（FNV-1a），只用于判断「内容与上次上传的是否一致」，不承担安全职责。 */
export function snapshotFingerprint(values: PersonalSettings): string {
  const text = JSON.stringify(values)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`
}

export function SettingsSyncProvider({ children }: { children: ReactNode }) {
  const { ghUser, canPublish, loading: authLoading } = useAuth()
  const toast = useToast()

  const metaRef = useRef<SyncMeta>(readMeta())
  const applyingRemoteRef = useRef(false)
  const pushTimerRef = useRef<number | null>(null)
  const loginRef = useRef('')
  const restoredForRef = useRef('')

  const [state, setState] = useState<SettingsSyncState>(() => ({
    status: OFFLINE ? 'off' : metaRef.current.enabled ? 'local' : 'local',
    enabled: metaRef.current.enabled,
    canSync: false,
    lastSyncedAt: metaRef.current.lastSyncedAt,
    lastError: '',
    remoteUrl: null,
    categoryName: '',
    pending: [],
    skipped: {},
    legacyFiles: [],
  }))

  const update = useCallback((patch: Partial<SettingsSyncState>) => {
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const collect = useCallback(() => collectSyncedSettings(readPersonalSettings()), [])

  /** 把一组远端值写回本机，期间不打时间戳、不排上传，避免恢复动作触发新一轮同步。 */
  const applyLocally = useCallback((values: PersonalSettings) => {
    applyingRemoteRef.current = true
    try {
      for (const [name, value] of Object.entries(values)) {
        if (isSyncedSetting(name)) writePersonalSetting(name, value)
      }
    } finally {
      applyingRemoteRef.current = false
    }
  }, [])

  /** 上传当前本机偏好。内容自上次上传以来没变过时直接跳过（多标签页不互相刷屏）。 */
  const push = useCallback(
    async (reason: 'auto' | 'manual'): Promise<boolean> => {
      const login = loginRef.current
      if (OFFLINE || !login) {
        if (reason === 'manual') throw new Error(OFFLINE ? '离线版不会发起任何网络请求' : '请先登录 GitHub 账号')
        return false
      }
      const { values, skipped } = collect()
      const hash = snapshotFingerprint({ login, values })
      if (hash === metaRef.current.lastPushedFingerprint) {
        update({ status: 'synced', pending: [], skipped, lastError: '' })
        return false
      }
      update({ status: 'saving', skipped })
      const snapshot: SettingsSnapshot = {
        version: SETTINGS_SNAPSHOT_VERSION,
        login,
        updatedAt: Date.now(),
        values,
        stamps: metaRef.current.stamps,
        skipped,
      }
      try {
        const result = await saveGithubSettingsSnapshot(login, snapshot)
        if (loginRef.current !== login) return false
        const meta: SyncMeta = {
          ...metaRef.current,
          lastSyncedAt: snapshot.updatedAt,
          lastPushedFingerprint: hash,
        }
        metaRef.current = meta
        writeMeta(meta)
        update({
          status: 'synced',
          lastSyncedAt: snapshot.updatedAt,
          lastError: '',
          remoteUrl: result.url,
          pending: [],
          skipped,
        })
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : '设置保存失败'
        update({ status: 'error', lastError: message, skipped })
        if (reason === 'manual') throw new Error(message)
        console.warn('[settings] 自动保存设置失败：', message)
        return false
      }
    },
    [collect, update],
  )

  const schedulePush = useCallback(() => {
    if (OFFLINE || !metaRef.current.enabled || !loginRef.current || applyingRemoteRef.current) return
    if (pushTimerRef.current !== null) window.clearTimeout(pushTimerRef.current)
    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null
      void push('auto')
    }, settingsSyncConfig.debounceMs)
  }, [push])

  /** 读取账号设置并合并到本机。 */
  const restore = useCallback(
    async (options: { force?: boolean } = {}) => {
      const login = loginRef.current
      if (OFFLINE || !login) {
        if (options.force) throw new Error(OFFLINE ? '离线版不会发起任何网络请求' : '请先登录 GitHub 账号')
        return
      }
      update({ status: 'restoring', lastError: '' })
      try {
        const result = await loadGithubSettingsSnapshot(login)
        if (loginRef.current !== login) return
        const snapshot = result.snapshot
        let keepLocal: string[] = []
        let migratedFromRepo = false

        if (snapshot) {
          const merged = mergeRemoteSettings({
            remote: snapshot.values,
            remoteUpdatedAt: snapshot.version === 1 ? snapshot.updatedAt : 0,
            remoteStamps: snapshot.stamps,
            localStamps: metaRef.current.stamps,
          })
          for (const name of Object.keys(collect().skipped)) delete merged.apply[name]
          applyLocally(merged.apply)
          const stamps = { ...metaRef.current.stamps }
          for (const name of Object.keys(merged.apply)) stamps[name] = settingStamp(snapshot, name)
          metaRef.current = { ...metaRef.current, stamps }
          keepLocal = merged.keepLocal
        } else {
          // 远端还是空的：旧版本把偏好写在仓库里，先把它搬过来，从此不再依赖仓库文件
          const legacy = await loadLegacySettingsValues(login).catch(() => ({}) as PersonalSettings)
          if (loginRef.current !== login) return
          if (Object.keys(legacy).length > 0) {
            applyLocally(legacy)
            migratedFromRepo = true
            toast('已从仓库里的旧版设置文件迁移到 GitHub Discussions，可在「账号设置同步」里删除仓库中的旧文件', 'info')
          }
        }

        const meta: SyncMeta = {
          ...metaRef.current,
          lastSyncedAt: Math.max(metaRef.current.lastSyncedAt, snapshot?.updatedAt ?? 0),
        }
        metaRef.current = meta
        writeMeta(meta)
        update({
          status: 'synced',
          categoryName: result.categoryName,
          remoteUrl: result.url,
          lastSyncedAt: meta.lastSyncedAt,
          pending: keepLocal.map(syncedSettingLabel),
          skipped: snapshot?.skipped ?? {},
        })

        // 三类情况要回推：本机有更新的项、刚从仓库文件迁移过来、远端还没有任何快照
        if (keepLocal.length > 0 || migratedFromRepo || !snapshot || options.force) await push('auto')
      } catch (err) {
        update({ status: 'error', lastError: err instanceof Error ? err.message : '读取账号设置失败' })
      }
    },
    [applyLocally, collect, push, toast, update],
  )

  // 登录 / 换账号：先恢复，之后才开始监听本机改动
  useEffect(() => {
    if (authLoading) return
    if (OFFLINE || !canPublish || !ghUser) {
      loginRef.current = ''
      restoredForRef.current = ''
      update({ canSync: false, status: OFFLINE ? 'off' : 'local', pending: [] })
      return
    }
    const login = ghUser.login
    loginRef.current = login
    if (restoredForRef.current === login) return
    restoredForRef.current = login
    update({ canSync: true })
    void restore()
  }, [authLoading, canPublish, ghUser, restore, update])

  // 本机偏好变化：打时间戳 + 排一次去抖上传（其他标签页通过 storage 事件同理）
  useEffect(() => {
    if (OFFLINE) return
    const onSettingsChanged = (event: Event) => {
      const name = (event as CustomEvent<{ name?: string }> | undefined)?.detail?.name
      if (name && !isSyncedSetting(name)) return
      if (applyingRemoteRef.current) return
      if (name) {
        const meta: SyncMeta = {
          ...metaRef.current,
          stamps: trimStamps({ ...metaRef.current.stamps, [name]: Date.now() }),
        }
        metaRef.current = meta
        writeMeta(meta)
      }
      const { skipped } = collect()
      const cloud = !!loginRef.current && metaRef.current.enabled
      update({
        status: cloud ? 'pending' : 'local',
        pending: name ? [syncedSettingLabel(name)] : [],
        skipped,
      })
      schedulePush()
    }
    window.addEventListener('starlog:settings-changed', onSettingsChanged)
    return () => window.removeEventListener('starlog:settings-changed', onSettingsChanged)
  }, [collect, schedulePush, update])

  // 其他标签页保存成功后不要再传一遍同样的内容
  useEffect(() => {
    if (OFFLINE) return
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.settingsSync) {
        metaRef.current = readMeta()
        return
      }
      if (event.key && event.key !== STORAGE_KEYS.personalSettings) return
      const { values } = collect()
      if (snapshotFingerprint({ login: loginRef.current, values }) === metaRef.current.lastPushedFingerprint) {
        update({ pending: [], status: loginRef.current ? 'synced' : 'local' })
        return
      }
      update({ pending: ['来自其他标签页的改动'] })
      schedulePush()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [collect, schedulePush, update])

  useEffect(
    () => () => {
      if (pushTimerRef.current !== null) window.clearTimeout(pushTimerRef.current)
    },
    [],
  )

  // 退出登录后清掉「第几号讨论」的缓存，换账号时不必先拿旧编号试一次
  useEffect(() => {
    if (!ghUser && !authLoading) clearSettingsRefCache()
  }, [authLoading, ghUser])

  // 登录后提示：仓库里是否还留着旧版设置文件（用已有的权限直接查，不做额外轮询）
  useEffect(() => {
    if (OFFLINE || !canPublish || !ghUser) {
      update({ legacyFiles: [] })
      return
    }
    update({ legacyFiles: legacySettingsPaths(ghUser.login) })
  }, [canPublish, ghUser, update])

  const saveNow = useCallback(async () => {
    await push('manual')
    toast('设置已保存到 GitHub 账号的 Discussions', 'success')
  }, [push, toast])

  const restoreNow = useCallback(async () => {
    await restore({ force: true })
  }, [restore])

  const setEnabled = useCallback(
    (enabled: boolean) => {
      const meta: SyncMeta = { ...metaRef.current, enabled }
      metaRef.current = meta
      writeMeta(meta)
      update({ enabled, status: enabled && loginRef.current ? 'pending' : 'local' })
      if (enabled) schedulePush()
    },
    [schedulePush, update],
  )

  const cleanLegacyFiles = useCallback(async () => {
    const login = loginRef.current
    if (!login) throw new Error('请先登录 GitHub 账号')
    const removed = await deleteLegacySettingsFiles(login)
    update({ legacyFiles: [] })
    if (removed.length === 0) throw new Error('仓库里没有属于这个账号的旧设置文件')
    toast(`已从仓库删除 ${removed.length} 个旧设置文件`, 'success')
  }, [toast, update])

  const value = useMemo<SettingsSyncCtxValue>(
    () => ({
      ...state,
      canSync: !OFFLINE && !!ghUser && canPublish,
      saveNow,
      restoreNow,
      setEnabled,
      cleanLegacyFiles,
    }),
    [canPublish, cleanLegacyFiles, ghUser, restoreNow, saveNow, setEnabled, state],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSettingsSync = () => useContext(Ctx)

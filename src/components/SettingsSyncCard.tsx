import { useState } from 'react'
import {
  CircleDollarSign,
  Cloud,
  CloudOff,
  ExternalLink,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react'
import { useSettingsSync } from '../lib/settingsSync'
import { relativeTime } from '../lib/posts'
import { SYNCED_SETTINGS, syncedSettingLabel } from '../lib/settingsSnapshot'
import { settingsSyncConfig } from '../lib/config'
import { OFFLINE } from '../lib/runtime'
import type { ReactNode } from 'react'

/**
 * 「账号设置同步」卡片（issue #129 / #130）。
 *
 * 这是设置页里唯一一处讲同步的地方：以前每个分区（字体、背景、动态背景）都挂一个
 * 「保存到 GitHub 账号」按钮，点了还要再去「待更新队列」里统一更新一次才能落盘，
 * 而且写进去的是仓库文件。现在所有偏好都会自动同步到账号的一条 Discussion 里，
 * 所以按钮也不需要了——这里只显示状态，外加三个兜底操作（立即保存 / 重新载入 / 清理旧文件）。
 */
const STATUS_TEXT: Record<string, string> = {
  off: '离线版不联网，设置只保存在这台设备上。',
  local: '未登录：设置保存在本浏览器。登录 GitHub 后会自动同步到你的账号。',
  restoring: '正在读取账号里的设置…',
  saving: '正在保存设置到 GitHub Discussions…',
  synced: '设置已与账号同步。',
  pending: '有改动等待自动保存…',
  error: '同步失败，稍后会再试一次。',
}

export function SettingsSyncCard({
  onCleanLegacyError,
}: {
  /** 清理旧文件失败时的兜底提示（卡片自己只负责按钮状态） */
  onCleanLegacyError?: (message: string) => void
}) {
  const sync = useSettingsSync()
  const [busy, setBusy] = useState<'save' | 'restore' | 'clean' | ''>('')

  const statusLine = sync.lastError
    ? sync.lastError
    : sync.status === 'synced' && sync.lastSyncedAt
      ? `上次保存：${relativeTime(sync.lastSyncedAt)}${sync.categoryName ? ` · Discussions 分类「${sync.categoryName}」` : ''}`
      : STATUS_TEXT[sync.status] ?? STATUS_TEXT.local

  const act = async (kind: 'save' | 'restore' | 'clean', run: () => Promise<void>) => {
    setBusy(kind)
    try {
      await run()
    } catch (err) {
      const message = err instanceof Error ? err.message : '操作失败'
      onCleanLegacyError?.(message)
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="card animate-fade-up p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <Cloud size={17} />
        </span>
        <div>
          <h2 className="font-serif text-lg font-semibold tracking-tight text-ink-900 dark:text-white">
            账号设置同步
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-500">
            所有个人设置改完就自动保存到 GitHub 账号下的一条 Discussion，换设备登录同一账号自动恢复；
            <strong className="font-semibold text-ink-700 dark:text-ink-200">不再写入仓库文件</strong>
            ，也不会产生提交。
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-ink-50/80 px-4 py-3 text-sm dark:bg-white/[0.04]">
        <SyncIcon status={sync.status} />
        <span className="flex-1 text-ink-600 dark:text-ink-300">{statusLine}</span>
        {!OFFLINE && sync.canSync && (
          <>
            <button
              type="button"
              className="btn-outline h-8 text-xs"
              disabled={busy !== ''}
              onClick={() => act('save', () => sync.saveNow())}
            >
              {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              立即保存
            </button>
            <button
              type="button"
              className="btn-outline h-8 text-xs"
              disabled={busy !== ''}
              onClick={() => act('restore', () => sync.restoreNow())}
            >
              {busy === 'restore' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              从账号重新载入
            </button>
            {sync.remoteUrl && (
              <a
                href={sync.remoteUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost h-8 text-xs"
                title="在 GitHub 上查看这条设置讨论"
              >
                <ExternalLink size={13} />
                查看设置讨论
              </a>
            )}
          </>
        )}
      </div>

      {sync.pending.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          待保存：{sync.pending.join('、')}
        </p>
      )}

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm text-ink-600 dark:text-ink-300">
        <input
          type="checkbox"
          checked={sync.enabled}
          disabled={OFFLINE}
          onChange={(e) => sync.setEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded accent-brand-500"
        />
        <span>
          自动保存到这个 GitHub 账号
          <span className="block text-xs text-ink-400">
            关掉后设置只留在本浏览器；重新打开会立刻补一次同步（默认间隔 {Math.round(settingsSyncConfig.debounceMs / 1000)} 秒）。
          </span>
        </span>
      </label>

      <div className="mt-4 border-t border-ink-200/70 pt-4 dark:border-white/10">
        <p className="text-xs font-medium text-ink-500">会同步这些设置</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {SYNCED_SETTINGS.map((spec) => (
            <li
              key={spec.name}
              className="rounded-full bg-ink-100/80 px-2.5 py-1 text-[11px] text-ink-600 dark:bg-white/[0.06] dark:text-ink-300"
            >
              {spec.label}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          登录令牌、本地草稿、离线文章库与待更新队列永不上传；单条超过 8000 字符的值（例如选成本机图片的固定背景图）
          只留在本机，理由会列在下面。
        </p>
        {Object.keys(sync.skipped).length > 0 && (
          <ul className="mt-2 space-y-1">
            {Object.entries(sync.skipped).map(([name, reason]) => (
              <li key={name} className="flex gap-2 text-xs text-ink-400">
                <span className="shrink-0 font-medium text-amber-600 dark:text-amber-400">
                  {syncedSettingLabel(name)}
                </span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sync.canSync && sync.legacyFiles.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-xs dark:border-amber-500/20 dark:!bg-amber-500/[0.06]">
          <CircleDollarSign size={14} className="text-amber-600 dark:text-amber-400" />
          <span className="flex-1 text-ink-600 dark:text-ink-300">
            仓库里还留着旧版设置文件（{sync.legacyFiles.join('、')}）。现在设置已经改存在 Discussions，
            可以直接把它们从仓库删掉。
          </span>
          <button
            type="button"
            className="btn-outline h-8 text-xs"
            disabled={busy !== ''}
            onClick={() => act('clean', () => sync.cleanLegacyFiles())}
          >
            {busy === 'clean' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            清理仓库中的旧文件
          </button>
        </div>
      )}
    </section>
  )
}

function SyncIcon({ status }: { status: string }): ReactNode {
  if (status === 'saving' || status === 'restoring' || status === 'pending') {
    return <Loader2 size={16} className="animate-spin text-brand-500" />
  }
  if (status === 'error') return <CloudOff size={16} className="text-rose-500" />
  if (status === 'off' || status === 'local') return <CloudOff size={16} className="text-ink-400" />
  return <Cloud size={16} className="text-emerald-500" />
}

import { useCallback, useEffect, useState } from 'react'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'

/**
 * 编辑器相关的个人偏好（issue #101 / #127）。
 *
 * 这些开关都写在集中的账号偏好里（`settingsStore`），所以：
 *   · 其他标签页与设置页改完，正在写作的编辑器立刻跟上；
 *   · 登录状态下会被「账号设置自动同步」一起带到 GitHub 账号（issue #129）。
 */
type FlagSpec = { key: string; fallback: boolean }

function readFlag({ key, fallback }: FlagSpec): boolean {
  const value = readPersonalSetting<boolean>(key)
  return typeof value === 'boolean' ? value : fallback
}

function useFlag(spec: FlagSpec): [boolean, (next: boolean) => void] {
  const [enabled, setEnabledState] = useState(() => readFlag(spec))

  useEffect(() => {
    const sync = (event?: Event) => {
      const name = (event as CustomEvent<{ name?: string }> | undefined)?.detail?.name
      if (!name || name === spec.key) setEnabledState(readFlag(spec))
    }
    window.addEventListener('starlog:settings-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('starlog:settings-changed', sync)
      window.removeEventListener('storage', sync)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.key])

  const setEnabled = useCallback(
    (next: boolean) => {
      writePersonalSetting(spec.key, next)
      setEnabledState(next)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec.key],
  )

  return [enabled, setEnabled]
}

/** 双栏视图是否自动同步滚动（默认开：沿用编辑器原有的联动行为）。 */
export function readEditorScrollSync(): boolean {
  return readFlag({ key: 'editorScrollSync', fallback: true })
}

export function writeEditorScrollSync(enabled: boolean) {
  writePersonalSetting('editorScrollSync', enabled)
}

export function useEditorScrollSync(): [enabled: boolean, setEnabled: (enabled: boolean) => void] {
  return useFlag({ key: 'editorScrollSync', fallback: true })
}

/** 编辑区左侧行号栏（issue #127）。 */
export function readEditorLineNumbers(): boolean {
  return readFlag({ key: 'editorLineNumbers', fallback: true })
}

export function writeEditorLineNumbers(enabled: boolean) {
  writePersonalSetting('editorLineNumbers', enabled)
}

export function useEditorLineNumbers(): [enabled: boolean, setEnabled: (enabled: boolean) => void] {
  return useFlag({ key: 'editorLineNumbers', fallback: true })
}

/**
 * 编辑区末尾留白：允许一直往下滚，把最后一行顶到编辑区最上方（issue #127）。
 *
 * 默认开启；关掉时回到「滚到底就是文档底」的传统 textarea 行为。
 * 只在「单独编辑」与「双栏」视图下产生留白——纯预览视图没有编辑区可滚。
 */
export function readEditorScrollPastEnd(): boolean {
  return readFlag({ key: 'editorScrollPastEnd', fallback: true })
}

export function writeEditorScrollPastEnd(enabled: boolean) {
  writePersonalSetting('editorScrollPastEnd', enabled)
}

export function useEditorScrollPastEnd(): [enabled: boolean, setEnabled: (enabled: boolean) => void] {
  return useFlag({ key: 'editorScrollPastEnd', fallback: true })
}

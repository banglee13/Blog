import { useCallback, useEffect, useState } from 'react'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'

/** 个人偏好键：编辑器双栏视图是否自动同步滚动。 */
const SCROLL_SYNC_SETTING = 'editorScrollSync'
/** 个人偏好键：编辑区左侧是否显示行号（issue #127）。 */
const LINE_NUMBERS_SETTING = 'editorLineNumbers'
/** 个人偏好键：编辑区是否可以一直下滑到最后一行位于最上方（issue #127）。 */
const SCROLL_PAST_END_SETTING = 'editorScrollPastEnd'

function readBoolean(name: string, fallback: boolean): boolean {
  const value = readPersonalSetting<boolean>(name)
  return typeof value === 'boolean' ? value : fallback
}

/**
 * 一个布尔型编辑器偏好。设置页与其他标签页修改后，
 * 正在使用的编辑器会通过 `starlog:settings-changed` / `storage` 事件即时更新。
 */
function useBooleanSetting(
  name: string,
  fallback: boolean,
): [enabled: boolean, setEnabled: (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState(() => readBoolean(name, fallback))

  useEffect(() => {
    const sync = () => setEnabledState(readBoolean(name, fallback))
    window.addEventListener('starlog:settings-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('starlog:settings-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [name, fallback])

  const setEnabled = useCallback(
    (next: boolean) => {
      writePersonalSetting(name, next)
      setEnabledState(next)
    },
    [name],
  )

  return [enabled, setEnabled]
}

/** 默认开启：沿用双栏编辑器原有的自动同步行为。 */
export function readEditorScrollSync(): boolean {
  return readBoolean(SCROLL_SYNC_SETTING, true)
}

export function writeEditorScrollSync(enabled: boolean) {
  writePersonalSetting(SCROLL_SYNC_SETTING, enabled)
}

/** 编辑器滚动同步偏好。 */
export function useEditorScrollSync(): [enabled: boolean, setEnabled: (enabled: boolean) => void] {
  return useBooleanSetting(SCROLL_SYNC_SETTING, true)
}

/** 编辑区行号，默认显示。 */
export function useEditorLineNumbers(): [enabled: boolean, setEnabled: (enabled: boolean) => void] {
  return useBooleanSetting(LINE_NUMBERS_SETTING, true)
}

/** 编辑区可以下滑到最后一行位于最上方，默认开启。 */
export function useEditorScrollPastEnd(): [enabled: boolean, setEnabled: (enabled: boolean) => void] {
  return useBooleanSetting(SCROLL_PAST_END_SETTING, true)
}

import { useSyncExternalStore } from 'react'
import { getSettingsSyncState, subscribeSettingsSync, type SettingsSyncState } from './settingsSync'

/** 订阅设置同步的状态（设置页显示「已保存到账号 / 正在同步 / 失败」用）。 */
export function useSettingsSync(): SettingsSyncState {
  return useSyncExternalStore(subscribeSettingsSync, getSettingsSyncState, getSettingsSyncState)
}

import { useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { OFFLINE } from '../lib/runtime'

/**
 * 设置同步模块只有登录用户才用得到：按需加载，访客的首屏不必为它多下载、多解析一段代码。
 * 同一个 Promise 上的回调按注册顺序执行，所以「先停旧账号、再开新账号」的顺序是有保证的。
 */
let syncModule: Promise<typeof import('../lib/settingsSync')> | null = null
const loadSync = () => (syncModule ??= import('../lib/settingsSync'))

/**
 * 把登录状态接到设置同步上（issue #129）：登录后自动开始同步，退出登录即停止。
 * 不渲染任何内容；离线版没有账号体系，什么都不做。
 */
export function SettingsSyncBridge() {
  const { isAuthed, ghUser } = useAuth()
  const login = isAuthed && ghUser ? ghUser.login : null

  useEffect(() => {
    if (OFFLINE || !login) return
    let cancelled = false
    void loadSync().then((module) => {
      if (!cancelled) module.startSettingsSync(login)
    })
    return () => {
      cancelled = true
      void loadSync().then((module) => module.stopSettingsSync())
    }
  }, [login])

  return null
}

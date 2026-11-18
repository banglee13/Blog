import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  Archive,
  ArrowDownToLine,
  BookOpen,
  ChevronRight,
  House,
  LibraryBig,
  LogIn,
  LogOut,
  Moon,
  Orbit,
  PencilLine,
  Search,
  Settings2,
  Sun,
  Tags,
  Telescope,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { ThemePicker } from '../src/components/ThemePicker'
import { useTheme } from '../src/lib/theme'
import { useAuth } from '../src/lib/auth'
import { OFFLINE } from '../src/lib/runtime'
import './core-menu.css'

export interface CoreMenuProps {
  onClose(): void
  onGo(path: string): void
  onSearch(): void
}

const destinations: [string, string, LucideIcon][] = [
  ['/archive', '文章归档', Archive],
  ['/tags', '文章标签', Tags],
  ['/toolbox', '百宝箱', Wrench],
  ['/about', '博客帮助', BookOpen],
]

export function CoreMenu({ onClose, onGo, onSearch }: CoreMenuProps) {
  const { isAuthed, ghUser, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const dialog = useRef<HTMLDialogElement>(null)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [closing, setClosing] = useState(false)

  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    element.showModal()
    element
      .querySelector<HTMLButtonElement>('.core-search')
      ?.focus({ preventScroll: true })
    return () => {
      element.close()
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])

  useEffect(
    () => () => {
      if (exitTimer.current !== null) clearTimeout(exitTimer.current)
    },
    [],
  )

  const dismiss = useCallback((next: () => void) => {
    if (exitTimer.current !== null) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      next()
      return
    }
    setClosing(true)
    exitTimer.current = setTimeout(next, 135)
  }, [])

  function go(path: string) {
    dismiss(() => onGo(path))
  }

  return (
    <dialog
      ref={dialog}
      className="star-core-menu"
      aria-labelledby="star-core-title"
      data-leaving={closing || undefined}
      onCancel={(event) => {
        event.preventDefault()
        // Escape first dismisses the original theme picker, if it is expanded.
        if (!dialog.current?.querySelector('.core-theme [aria-expanded=true]'))
          dismiss(onClose)
      }}
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          dialog.current?.querySelector('.core-theme [aria-expanded=true]')
        ) {
          event.preventDefault()
          dialog.current
            .querySelector<HTMLButtonElement>(
              '.core-theme [aria-expanded=true]',
            )
            ?.click()
          return
        }
        if (event.key !== 'Tab') return
        const targets = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href]',
          ),
        ].filter((item) => item.getClientRects().length > 0)
        const first = targets[0]
        const last = targets[targets.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const box = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          dismiss(onClose)
      }}
    >
      <div className="core-menu-shell">
        <header className="core-menu-header">
          <span className="core-insignia" aria-hidden="true">
            <Orbit size={26} strokeWidth={1.3} />
          </span>
          <h2 id="star-core-title">星核导航</h2>
          <div className="core-theme">
            <ThemePicker />
          </div>
          <button
            type="button"
            className="core-round"
            aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            onClick={toggle}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
          <button
            type="button"
            className="core-round core-close"
            aria-label="关闭星核导航"
            onClick={() => dismiss(onClose)}
          >
            <X />
          </button>
        </header>
        <div className="core-menu-content">
          <button
            type="button"
            className="core-search"
            onClick={() => dismiss(onSearch)}
          >
            <Search size={18} />
            <span>搜索文章</span>
            <kbd>Ctrl / ⌘ K</kbd>
          </button>
          <nav aria-label="博客导航" className="core-destinations">
            {destinations.map(([path, label, Icon]) => (
              <button key={path} type="button" onClick={() => go(path)}>
                <Icon aria-hidden="true" size={20} strokeWidth={1.5} />
                <span>{label}</span>
                <ChevronRight aria-hidden="true" size={15} />
              </button>
            ))}
          </nav>
          <div className="core-workspace">
            <button type="button" onClick={() => go('/admin/new')}>
              <PencilLine />
              写新文章
            </button>
            {(OFFLINE || isAuthed) && (
              <button type="button" onClick={() => go('/admin')}>
                <LibraryBig />
                内容管理
              </button>
            )}
            {OFFLINE && (
              <button type="button" onClick={() => go('/admin?tab=export')}>
                <ArrowDownToLine />
                离线导出
              </button>
            )}
            <button type="button" onClick={() => go('/settings')}>
              <Settings2 />
              设置
            </button>
          </div>
        </div>
        <footer className="core-menu-footer">
          <button type="button" onClick={() => go('/')}>
            <House />
            返回星图
          </button>
          {OFFLINE ? (
            <span>
              <Telescope />
              本机文库
            </span>
          ) : isAuthed ? (
            <>
              <span className="core-account">@{ghUser?.login || '已登录'}</span>
              <button type="button" onClick={logout}>
                <LogOut />
                退出登录
              </button>
            </>
          ) : (
            <button type="button" onClick={() => go('/login')}>
              <LogIn />
              登录 GitHub
            </button>
          )}
        </footer>
      </div>
    </dialog>
  )
}

export default CoreMenu

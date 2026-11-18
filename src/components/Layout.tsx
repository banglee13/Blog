import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Github, Mail, Orbit, Rss } from 'lucide-react'
import { CoreMenu } from '../../cosmic/CoreMenu'
import StellarBackdrop from '../../cosmic/StellarBackdrop'
import '../../cosmic/page-navigation.css'
import { siteConfig } from '../lib/config'
import { OFFLINE } from '../lib/runtime'
import { AnimatedBackdrop } from './AnimatedBackdrop'
import {
  useAnimatedBackground,
  useAnimatedSceneOverride,
  getSceneValues,
} from '../lib/animatedBackground'
import { SearchDialog } from './SearchDialog'

function Footer() {
  const { social } = siteConfig
  // 离线版不联网：GitHub / RSS 这类外链在这里点了也没用，只保留 mailto（由邮件客户端处理，不是网络请求）
  const links = [
    !OFFLINE &&
      social.github && { href: social.github, icon: Github, label: 'GitHub' },
    social.email && {
      href: `mailto:${social.email}`,
      icon: Mail,
      label: 'Email',
    },
    !OFFLINE && social.rss && { href: social.rss, icon: Rss, label: 'RSS' },
  ].filter(Boolean) as { href: string; icon: typeof Github; label: string }[]

  return (
    <footer className="no-print mt-24" data-yield-list>
      <div className="container-page flex flex-col items-center justify-between gap-5 border-t border-ink-200/60 py-10 sm:flex-row dark:border-white/[0.08]">
        <div className="text-center sm:text-left">
          <p className="text-xs text-ink-400">
            © {new Date().getFullYear()} {siteConfig.author.name}
            {siteConfig.footerNote ? ` · ${siteConfig.footerNote}` : ''} ·{' '}
            {OFFLINE
              ? '离线单文件版（不联网）'
              : '由 React + Vite 驱动，托管于 GitHub Pages'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              aria-label={l.label}
              className="btn-ghost h-9 w-9 !px-0"
            >
              <l.icon size={17} />
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}

function AnimatedBackdropLayer({
  ignoreOverride = false,
}: {
  ignoreOverride?: boolean
}) {
  const pref = useAnimatedBackground()
  // 文章开头的 ::set-background[<id>]（issue #59）可在阅读本文时临时强制场景，
  // 参数仍用读者为该场景保存（或默认）的值；回声洞等独立全屏页始终使用用户自己选择的背景。
  const override = useAnimatedSceneOverride()
  const scene = ignoreOverride ? pref.scene : (override ?? pref.scene)
  if (scene === 'none') return null
  return <AnimatedBackdrop scene={scene} values={getSceneValues(pref, scene)} />
}

export const EDITOR_FULLSCREEN_EVENT = 'starlog:editor-fullscreen'

export function setEditorFullscreenActive(active: boolean) {
  if (typeof document !== 'undefined') {
    if (active) document.documentElement.dataset.editorFullscreen = 'true'
    else delete document.documentElement.dataset.editorFullscreen
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<boolean>(EDITOR_FULLSCREEN_EVENT, { detail: active }),
    )
  }
}

export function Layout() {
  const [panel, setPanel] = useState<'menu' | 'search' | null>(null)
  const [editorFullscreen, setEditorFullscreen] = useState(
    () => document.documentElement.dataset.editorFullscreen === 'true',
  )
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const echo =
    pathname === '/toolbox/echo' || pathname.startsWith('/toolbox/echo/')
  const hideNavigation = editorFullscreen || echo

  useEffect(() => {
    setPanel(null)
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  useEffect(() => {
    function changeFullscreen(event: Event) {
      const fullscreen = Boolean((event as CustomEvent<boolean>).detail)
      setEditorFullscreen(fullscreen)
      if (fullscreen) setPanel(null)
    }
    window.addEventListener(EDITOR_FULLSCREEN_EVENT, changeFullscreen)
    return () =>
      window.removeEventListener(EDITOR_FULLSCREEN_EVENT, changeFullscreen)
  }, [])

  useEffect(() => {
    if (hideNavigation || panel === 'menu') return
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return
      const editing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          !!event.target.closest('input, textarea, select'))
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPanel((current) => (current === 'search' ? null : 'search'))
      } else if (event.key === '/' && !editing) {
        event.preventDefault()
        setPanel('search')
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [hideNavigation, panel])

  return (
    <div className="stellar-page relative flex min-h-screen flex-col">
      <div
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
        aria-hidden="true"
      >
        <StellarBackdrop />
        <AnimatedBackdropLayer ignoreOverride={echo} />
      </div>
      <main className="relative flex-1">
        <Outlet />
      </main>
      {!hideNavigation && (
        <>
          <div className="relative">
            <Footer />
          </div>
          <button
            type="button"
            className="stellar-nav-toggle no-print"
            aria-label="打开星核导航"
            aria-haspopup="dialog"
            aria-expanded={panel === 'menu'}
            onClick={() => setPanel('menu')}
          >
            <Orbit aria-hidden="true" size={19} strokeWidth={1.5} />
            <span>星核导航</span>
          </button>
          {panel === 'menu' && (
            <CoreMenu
              onClose={() => setPanel(null)}
              onSearch={() => setPanel('search')}
              onGo={(path) => {
                setPanel(null)
                navigate(path)
              }}
            />
          )}
          {panel === 'search' && (
            <SearchDialog open onClose={() => setPanel(null)} />
          )}
        </>
      )}
    </div>
  )
}

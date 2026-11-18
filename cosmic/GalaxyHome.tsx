import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SearchDialog } from '../src/components/SearchDialog'
import { usePosts } from '../src/lib/usePosts'
import {
  mountGalaxy,
  type GalaxyArticle,
  type GalaxyView,
  type StarMap,
} from './galaxy'
import { CoreMenu } from './CoreMenu'
import './galaxy.css'
import './navigation.css'

let lastView: GalaxyView | undefined
let returnTarget: string | undefined

export default function GalaxyHome() {
  const [posts] = usePosts()
  const catalog = useMemo(
    () =>
      JSON.stringify(
        posts.map((post) => ({
          id: post.slug,
          title: post.title,
          date: post.date,
          savedAt: post.savedAt,
        })),
      ),
    [posts],
  )
  const stage = useRef<HTMLDivElement>(null)
  const scene = useRef<StarMap | null>(null)
  const [panel, setPanel] = useState<'menu' | 'search' | null>(null)
  const navigate = useNavigate()
  const router = useRef(navigate)
  router.current = navigate
  const overlay = useRef(panel)
  const atCore = useRef(false)
  overlay.current = panel

  useEffect(() => {
    const life = new AbortController()
    let busy = false
    let map: StarMap | undefined
    // Scheduling avoids allocating a second WebGL context during strict-mode's trial mount.
    const frame = requestAnimationFrame(() => {
      if (!stage.current) return
      async function select(target: string, path?: string) {
        if (busy || overlay.current || !map) return
        busy = true
        const destination = path
          ? import('../src/pages/PostPage')
          : Promise.resolve()
        const [finished] = await Promise.all([
          map.approach(target, { signal: life.signal }),
          destination,
        ])
        if (life.signal.aborted || !finished) {
          busy = false
          return
        }
        if (path) {
          returnTarget = target
          router.current(path)
        } else {
          atCore.current = true
          setPanel('menu')
        }
        busy = false
      }
      map = mountGalaxy(stage.current, {
        articles: JSON.parse(catalog) as GalaxyArticle[],
        initialView: lastView,
        onCore: () => {
          void select('core')
        },
        onArticle: (article) => {
          void select(article.id, '/posts/' + encodeURIComponent(article.id))
        },
      })
      scene.current = map
      map.setActive(!overlay.current)
      if (returnTarget && !overlay.current) {
        void map.returnFrom(returnTarget, { signal: life.signal })
        returnTarget = undefined
      }
    })
    return () => {
      life.abort()
      cancelAnimationFrame(frame)
      if (map) {
        lastView = map.getView()
        map.destroy()
      }
      scene.current = null
    }
  }, [catalog])

  useEffect(() => {
    scene.current?.setActive(panel === null)
  }, [panel])
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.defaultPrevented || overlay.current) return
      if (
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') ||
        event.key === '/'
      ) {
        event.preventDefault()
        scene.current?.cancelTransition()
        setPanel('search')
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        scene.current?.rotate(event.key === 'ArrowLeft' ? 12 : -12)
      } else if (
        !event.ctrlKey &&
        !event.metaKey &&
        ['+', '=', '-'].includes(event.key)
      ) {
        event.preventDefault()
        scene.current?.magnify(event.key === '-' ? 1 / 1.18 : 1.18)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  function close() {
    setPanel(null)
    scene.current?.setActive(true)
    if (atCore.current) {
      atCore.current = false
      void scene.current?.returnFrom('core')
    }
  }
  return (
    <>
      <main
        className="galaxy-viewport"
        aria-label="文章星图，拖动改变观察角度，滚轮缩放，点击恒星阅读，点击星核导航"
        ref={stage}
      />
      {panel === 'menu' && (
        <CoreMenu
          onClose={close}
          onSearch={() => setPanel('search')}
          onGo={(path) => {
            if (path === '/') {
              close()
              return
            }
            returnTarget = 'core'
            navigate(path)
          }}
        />
      )}
      {panel === 'search' && <SearchDialog open onClose={close} />}
    </>
  )
}

import './site.css'
import './galaxy.css'
import { mountGalaxy } from './galaxy.js'
import { about, getArticles, loadArticle } from './content.js'
import { OFFLINE } from '../src/lib/runtime'
import { loadOfflineLibrary } from './content.js'

const app = document.querySelector('#app')
const dialog = document.querySelector('#portal')
const systemTheme = matchMedia('(prefers-color-scheme: light)')
let galaxy, disposePage, disposePanel
let routeVersion = 0,
  panelVersion = 0,
  lastAngle = 0

function preferences() {
  try {
    return JSON.parse(localStorage.getItem('cosmic:preferences')) || {}
  } catch {
    return {}
  }
}

function applyPreferences() {
  const { theme, size = 17, font } = preferences()
  const light = theme === 'light' || (theme === 'system' && systemTheme.matches)
  const root = document.documentElement
  root.dataset.theme = light ? 'light' : 'dark'
  root.style.setProperty('--reading-size', size + 'px')
  root.style.setProperty(
    '--reader-font',
    font === 'serif'
      ? 'Georgia, SimSun, serif'
      : '"Segoe UI", "Microsoft YaHei", sans-serif',
  )
}

function savePrefs(changes) {
  localStorage.setItem(
    'cosmic:preferences',
    JSON.stringify({ ...preferences(), ...changes }),
  )
  applyPreferences()
}

function closePanel() {
  if (!dialog.open) return
  dialog.close()
  clearPanel()
}

function clearPanel() {
  if (dialog.open) return
  panelVersion++
  disposePanel?.()
  disposePanel = null
  dialog.replaceChildren()
  galaxy?.setActive(true)
}

function goArticle(article) {
  closePanel()
  location.hash = '/post/' + encodeURIComponent(article.id)
}

function goHome() {
  closePanel()
  location.hash = '/'
}

async function openPanel(page = 'menu', data = {}) {
  const version = ++panelVersion
  disposePanel?.()
  disposePanel = null
  if (!dialog.open) dialog.showModal()
  galaxy?.setActive(false)
  const { mountPanel } = await import('./panel.js')
  if (version !== panelVersion || !dialog.open) return
  disposePanel = mountPanel(dialog, {
    page,
    data,
    open: openPanel,
    close: closePanel,
    goHome,
    goArticle,
    goAbout: () => {
      closePanel()
      location.hash = '/about'
    },
    loadArticle,
    prefs: preferences(),
    savePrefs,
  })
}

function showGalaxy() {
  document.title = '星野笔记 · Starlog'
  const stage = document.createElement('section')
  stage.className = 'sky-stage'
  stage.setAttribute(
    'aria-label',
    '文章星图。滚轮旋转星系，选择恒星阅读文章，选择星核打开导航。',
  )
  app.replaceChildren(stage)
  galaxy = mountGalaxy(stage, {
    articles: getArticles(),
    initialAngle: lastAngle,
    onArticle: goArticle,
    onCore: () => openPanel(),
    onRotate: (angle) => {
      lastAngle = angle
    },
  })
  return () => {
    lastAngle = galaxy.getAngle()
    galaxy.destroy()
    galaxy = null
  }
}

function currentRoute() {
  const path =
    location.protocol === 'file:'
      ? ''
      : location.pathname.slice(import.meta.env.BASE_URL.length)
  const route = (location.hash.slice(1) || path).replace(/^\/+|\/+$/g, '')
  try {
    return decodeURIComponent(route)
  } catch {
    return route
  }
}

// Keep existing shared links usable after the merge.
function panelRoute(route) {
  const routes = {
    archive: 'archive',
    tags: 'tags',
    toolbox: 'tools',
    'toolbox/echo': 'echo',
    'toolbox/genshin': 'genshin',
    login: 'login',
    settings: 'settings',
    'admin/settings': 'settings',
    admin: 'manage',
    'admin/new': 'editor',
    editor: 'editor',
    search: 'search',
  }
  if (routes[route]) return [routes[route]]
  const tag = /^tags\/(.+)$/.exec(route)
  if (tag) return ['tags', { tag: tag[1] }]
  const edit = /^(?:admin\/edit|editor)\/(.+)$/.exec(route)
  if (edit) return ['editor', { id: edit[1] }]
  const game = /^toolbox\/genshin\/(characters|weapons)\/(.+)$/.exec(route)
  if (game) return ['genshin', { kind: game[1], id: game[2] }]
}

async function render() {
  const version = ++routeVersion
  closePanel()
  disposePage?.()
  disposePage = null
  const route = currentRoute()
  const panel = panelRoute(route)
  if (!route || panel) {
    disposePage = showGalaxy()
    if (panel) await openPanel(...panel)
    return
  }
  const post = /^(?:post|posts)\/(.+)$/.exec(route)
  if (route === 'about' || post) {
    const article = post ? await loadArticle(post[1]) : about
    if (version !== routeVersion) return
    if (article) {
      const { mountReader } = await import('./reader.js')
      if (version !== routeVersion) return
      document.title = article.title + ' · Starlog'
      disposePage = mountReader(app, {
        article,
        articles: getArticles(),
        onBack: goHome,
        onArticle: goArticle,
        onMenu: openPanel,
      })
      return
    }
  }
  app.innerHTML =
    '<section class="lost"><h1>未找到这一页</h1><a href="#/">返回星图</a></section>'
}

dialog.addEventListener('close', clearPanel)
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return
  const { left, right, top, bottom } = dialog.getBoundingClientRect()
  if (
    event.clientX < left ||
    event.clientX > right ||
    event.clientY < top ||
    event.clientY > bottom
  )
    closePanel()
})
window.addEventListener('hashchange', render)
window.addEventListener('starlog:posts-changed', () => {
  if (galaxy && !dialog.open) render()
})
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    openPanel('search')
  } else if (
    galaxy &&
    !dialog.open &&
    ['ArrowLeft', 'ArrowRight'].includes(event.key)
  ) {
    event.preventDefault()
    galaxy.rotate(event.key === 'ArrowLeft' ? -12 : 12)
  }
})
systemTheme.addEventListener('change', applyPreferences)
applyPreferences()
if (OFFLINE) loadOfflineLibrary().then(render)
else render()

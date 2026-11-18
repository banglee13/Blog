import './panel.css'
import { getArticles, searchArticles } from './content.js'
import { logout } from './workspace.js'
import { icon, escapeHTML as h, dateText, tool, command } from './ui.js'
const entries = {
  home: ['Orbit', '返回星图', 'Star atlas'],
  archive: ['Archive', '文章归档', 'Archives'],
  tags: ['Tags', '文章标签', 'Tags'],
  search: ['Search', '全文搜索', 'Search'],
  tools: ['Wrench', '百宝箱', 'Toolbox'],
  help: ['CircleHelp', '星图指南', 'Field guide'],
  settings: ['SlidersHorizontal', '观测设置', 'Preferences'],
  editor: ['PencilLine', '写新文章', 'New entry'],
  manage: ['Library', '内容管理', 'Library'],
  login: ['UserRound', '观测员账户', 'Account'],
  echo: ['AudioLines', '回声洞', 'Echo chamber'],
  genshin: ['Box', '原神资料库', 'Game database'],
  menu: ['Orbit', '星核导航', 'Navigation'],
}
const section = (label, html) =>
  '<section class="p-section"><h3>' + label + '</h3>' + html + '</section>'
const grid = (ids) =>
  '<div class="p-grid">' +
  ids
    .map(
      (k) =>
        '<button class="portal-choice" data-page="' +
        k +
        '">' +
        icon(entries[k][0]) +
        '<span>' +
        entries[k][1] +
        '</span>' +
        icon('ChevronRight') +
        '</button>',
    )
    .join('') +
  '</div>'
export function mountPanel(modal, ctx) {
  const { page, open, data } = ctx,
    ac = new AbortController(),
    signal = ac.signal,
    all = getArticles()
  const title = entries[page] || entries.menu
  modal.className = 'portal portal-' + page
  modal.innerHTML =
    '<header class="portal-head"><div class="portal-id">' +
    (page === 'menu'
      ? '<span class="portal-mark">' + icon('Orbit') + '</span>'
      : tool('menu', 'ArrowLeft', '返回星核导航')) +
    '<div><h2 id="portal-heading">' +
    title[1] +
    '</h2></div></div>' +
    tool('close', 'X', '关闭面板') +
    '</header><div class="portal-body"></div><div class="panel-msg" role="status"></div>'
  const body = modal.querySelector('.portal-body'),
    msg = (s) => (modal.querySelector('.panel-msg').textContent = s)
  const listen = (el, event, fn) => el.addEventListener(event, fn, { signal })
  const showPane = (k) => (k === 'home' ? (ctx.close(), ctx.goHome()) : open(k))
  listen(modal, 'click', (e) => {
    const p = e.target.closest('[data-page]'),
      a = e.target.closest('[data-action]'),
      article = e.target.closest('[data-read]')
    if (p) {
      showPane(p.dataset.page)
      return
    }
    if (article) {
      const item = all.find((v) => v.id === article.dataset.read)
      if (item) ctx.goArticle(item)
      return
    }
    switch (a?.dataset.action) {
      case 'close':
        ctx.close()
        break
      case 'menu':
        open('menu')
        break
      case 'about':
        ctx.goAbout()
        break
      case 'logout':
        logout()
        open('login')
        break
    }
  })
  function rows(items) {
    return items
      .map(
        (a) =>
          '<button class="article-row" data-read="' +
          h(a.id) +
          '"><span class="row-glyph">' +
          icon(a.encrypted ? 'LockKeyhole' : 'FileText') +
          '</span><span class="row-name">' +
          h(a.title) +
          '<small>' +
          h(a.tags.join(' / ')) +
          '</small></span><time>' +
          h(dateText(a)) +
          '</time>' +
          icon('ChevronRight') +
          '</button>',
      )
      .join('')
  }
  if (page === 'menu') {
    body.innerHTML =
      section(
        '探索',
        grid(['home', 'archive', 'tags', 'search', 'tools', 'help']),
      ) + section('工作台', grid(['editor', 'manage', 'settings', 'login']))
  } else if (page === 'archive') {
    const sorted = [...all].sort((a, b) => b.date.localeCompare(a.date)),
      groups = Map.groupBy
        ? Map.groupBy(sorted, (a) => a.date.slice(0, 4) || '日期未公开')
        : sorted.reduce((m, a) => {
            const g = a.date.slice(0, 4) || '日期未公开'
            return m.set(g, [...(m.get(g) || []), a])
          }, new Map())
    body.innerHTML = Array.from(groups, ([year, items]) =>
      section(h(year) + ' <small>' + items.length + ' 篇</small>', rows(items)),
    ).join('')
  } else if (page === 'search') {
    body.innerHTML =
      '<label class="search-field">' +
      icon('Search') +
      '<input type="search" autofocus placeholder="搜索标题、标签或正文" aria-label="全文搜索"></label><div class="results"></div>'
    const input = body.querySelector('input'),
      results = body.querySelector('.results')
    const search = () => {
      const items = searchArticles(input.value)
      results.innerHTML = items.length
        ? section(items.length + ' 篇文章', rows(items))
        : '<p class="empty">没有找到相关文章。试试其他关键词。</p>'
    }
    listen(input, 'input', search)
    listen(input, 'keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        results.querySelector('button')?.focus()
      } else if (e.key === 'Enter') results.querySelector('button')?.click()
    })
    search()
    input.focus()
  } else if (page === 'tags') {
    const tags = [...new Set(all.flatMap((a) => a.tags))]
    let current = tags.includes(data.tag) ? data.tag : ''
    body.innerHTML =
      '<div class="tag-options"></div><div class="results"></div>'
    function filter() {
      body.querySelector('.tag-options').innerHTML = ['', ...tags]
        .map(
          (t) =>
            '<button class="tag" aria-pressed="' +
            (t === current) +
            '" data-tag="' +
            h(t) +
            '">' +
            h(t || '全部') +
            '</button>',
        )
        .join('')
      body.querySelector('.results').innerHTML = rows(
        current ? all.filter((a) => a.tags.includes(current)) : all,
      )
    }
    listen(body, 'click', (e) => {
      const b = e.target.closest('[data-tag]')
      if (b) {
        current = b.dataset.tag
        filter()
      }
    })
    filter()
  } else if (page === 'tools') {
    body.innerHTML = grid(['echo', 'genshin'])
  } else if (page === 'help') {
    body.innerHTML =
      section(
        '漫游星图',
        '<dl class="guide"><dt>转动星系</dt><dd>滚动鼠标滚轮，或按左右方向键。</dd><dt>阅读文章</dt><dd>点击恒星或旁边的文章名。</dd><dt>打开导航</dt><dd>点击星核打开面板，按 Esc 关闭。</dd><dt>全文搜索</dt><dd>按 Ctrl / ⌘ + K 搜索文章。</dd></dl>',
      ) + section('星野笔记', command('about', 'BookOpen', '阅读项目手册'))
  } else if (page === 'settings') {
    const p = ctx.prefs
    body.innerHTML =
      section(
        '界面外观',
        '<div class="segments">' +
          [
            ['dark', 'Moon', '深色'],
            ['light', 'Sun', '浅色'],
            ['system', 'Monitor', '跟随系统'],
          ]
            .map(
              ([v, i, l]) =>
                '<button data-theme-choice="' +
                v +
                '" aria-pressed="' +
                ((p.theme || 'dark') === v) +
                '">' +
                icon(i) +
                l +
                '</button>',
            )
            .join('') +
          '</div>',
      ) +
      section(
        '阅读排版',
        '<label class="form-row"><span>正文字体</span><select name="font"><option value="sans">现代黑体</option><option value="serif">经典宋体</option></select></label><label class="form-row"><span>正文字号</span><input type="range" min="14" max="23" step="1" value="' +
          h(p.size || 17) +
          '"><output>' +
          h(p.size || 17) +
          ' px</output></label>',
      ) +
      '<div class="repo-settings"></div>'
    body.querySelector('select').value = p.font || 'sans'
    listen(body, 'click', (e) => {
      const b = e.target.closest('[data-theme-choice]')
      if (b) {
        ctx.savePrefs({ theme: b.dataset.themeChoice })
        body
          .querySelectorAll('[data-theme-choice]')
          .forEach((el) => el.setAttribute('aria-pressed', String(el === b)))
      }
    })
    listen(body.querySelector('select'), 'change', (e) =>
      ctx.savePrefs({ font: e.target.value }),
    )
    listen(body.querySelector('input'), 'input', (e) => {
      ctx.savePrefs({ size: +e.target.value })
      body.querySelector('output').value = e.target.value + ' px'
    })
    import('./author.js').then((m) => {
      if (!signal.aborted)
        m.repoForm(body.querySelector('.repo-settings'), { listen, msg })
    })
  } else if (['login', 'manage', 'editor'].includes(page)) {
    body.innerHTML = '<p class="fine">正在打开工作台…</p>'
    import('./author.js')
      .then((m) => {
        if (!signal.aborted)
          m.mountAuthor(body, { ...ctx, listen, msg, signal, rows })
      })
      .catch((e) => {
        if (!signal.aborted) msg(e.message)
      })
  } else if (['echo', 'genshin'].includes(page)) {
    body.innerHTML = '<p class="fine">正在读取资料…</p>'
    import('./tools.js')
      .then((m) => {
        if (!signal.aborted)
          return m.mountTool(body, { ...ctx, listen, msg, signal })
      })
      .catch((e) => {
        if (!signal.aborted) msg(e.message)
      })
  }
  if (data.focus === 'first') body.querySelector('button')?.focus()
  return () => ac.abort()
}

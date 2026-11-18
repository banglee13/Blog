import { escapeHTML as h, icon, command } from './ui.js'
import { currentAccount } from './workspace.js'
export async function mountTool(el, ctx) {
  const { listen, signal, msg, open } = ctx
  if (ctx.page === 'echo') {
    const m = await import('../src/lib/echoCave')
    if (signal.aborted) return
    const deck = m.createEchoDeck()
    let quote,
      nodeId = null
    el.innerHTML =
      '<blockquote class="echo-quote"></blockquote><div class="actions">' +
      command('next-echo', 'RefreshCw', '听下一句') +
      '</div><label class="field"><span>留下回声</span><textarea rows="2" maxlength="500"></textarea></label>' +
      command('send-echo', 'Send', '发送回声', 'primary')
    const quoteNode = el.querySelector('blockquote'),
      textarea = el.querySelector('textarea')
    textarea.value = m.readPendingEchoDraft()
    const show = () => {
      quote = deck.next(quote?.text)
      quoteNode.innerHTML =
        h(quote.text) + (quote.from ? '<cite>' + h(quote.from) + '</cite>' : '')
      deck.markShown(quote)
    }
    show()
    m.loadEchoCaveSnapshot()
      .then((s) => {
        if (!signal.aborted) {
          deck.setDiscussionEchoes(s.echoes)
          nodeId = s.discussionNodeId
        }
      })
      .catch(() => {})
    async function preload() {
      const q = await m.fetchHitokotoOne(signal)
      if (q && !signal.aborted) deck.pushHitokoto(q)
    }
    preload()
    listen(el, 'click', async (e) => {
      const b = e.target.closest('[data-action]')
      if (!b) return
      if (b.dataset.action === 'next-echo') {
        show()
        preload()
      }
      if (b.dataset.action === 'send-echo') {
        if (!textarea.value.trim()) {
          msg('请先写下一句话。')
          return
        }
        b.disabled = true
        try {
          const r = await m.submitEchoMessage(textarea.value, {
            knownDiscussionNodeId: nodeId,
            currentUserLogin: currentAccount()?.login,
          })
          if (signal.aborted) return
          if (r.status === 'needs_auth') {
            msg('回声已留作本地草稿，请登录后发送。')
            const login = document.createElement('button')
            login.className = 'command'
            login.textContent = '登录 GitHub'
            login.onclick = () => open('login')
            b.after(login)
          } else {
            msg('回声已发送。')
            textarea.value = ''
          }
        } catch (err) {
          if (!signal.aborted) msg(err.message)
        } finally {
          b.disabled = false
        }
      }
    })
    return
  }
  const m = await import('../src/lib/genshin')
  if (signal.aborted) return
  let kind = ctx.data?.kind === 'weapons' ? 'weapons' : 'characters',
    q = '',
    element = '',
    weapon = '',
    rarity = '',
    page = 0,
    detail,
    detailKey = '',
    detailVersion = 0
  const options = (map) =>
    Object.entries(map)
      .map(([v, l]) => '<option value="' + h(v) + '">' + h(l) + '</option>')
      .join('')
  function catalog() {
    el.innerHTML =
      '<div class="segments"><button data-kind="characters" aria-pressed="' +
      (kind === 'characters') +
      '">角色</button><button data-kind="weapons" aria-pressed="' +
      (kind === 'weapons') +
      '">武器</button></div><label class="search-field">' +
      icon('Search') +
      '<input type="search" placeholder="搜索角色或武器" aria-label="搜索角色或武器"></label><div class="actions filters">' +
      (kind === 'characters'
        ? '<select aria-label="元素" name="element"><option value="">全部元素</option>' +
          options(m.elements) +
          '</select>'
        : '') +
      '<select aria-label="武器类型" name="weapon"><option value="">全部武器类型</option>' +
      options(m.weaponTypes) +
      '</select><select aria-label="星级" name="rarity"><option value="">全部星级</option>' +
      [1, 2, 3, 4, 5]
        .map((v) => '<option value="' + v + '">' + v + ' 星</option>')
        .join('') +
      '</select></div><div class="game-table"></div><div class="inline-row"><span class="game-count"></span><div>' +
      command('game-prev', 'ChevronLeft', '上一页') +
      command('game-next', 'ChevronRight', '下一页') +
      '</div></div>'
    el.querySelector('input').value = q
    for (const [name, value] of Object.entries({ element, weapon, rarity })) {
      const f = el.querySelector('[name="' + name + '"]')
      if (f) f.value = value
    }
    draw()
  }
  function draw() {
    const items = m.catalog.filter(
      (a) =>
        a.kind === kind &&
        (!element || a.element === element) &&
        (!weapon || a.weaponType === weapon) &&
        (!rarity || a.rarity === +rarity) &&
        [a.name, a.enName, a.id]
          .join(' ')
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
    page = Math.max(0, Math.min(page, Math.ceil(items.length / 32) - 1))
    el.querySelector('.game-table').innerHTML = items.length
      ? items
          .slice(page * 32, (page + 1) * 32)
          .map(
            (a) =>
              '<button class="game-entry" data-game="' +
              h(a.id) +
              '">' +
              (m.genshinImage(a.icon)
                ? '<img src="' + h(m.genshinImage(a.icon)) + '" alt="">'
                : '') +
              '<span>' +
              h(m.entryName(a)) +
              '<small>' +
              h(a.rarity) +
              ' 星 · ' +
              h(m.label(a.weaponType)) +
              '</small></span></button>',
          )
          .join('')
      : '<p class="empty">无匹配结果</p>'
    el.querySelector('.game-count').textContent =
      items.length +
      ' 项 · 第 ' +
      (page + 1) +
      ' / ' +
      Math.max(1, Math.ceil(items.length / 32)) +
      ' 页'
    el.querySelector('[data-action="game-prev"]').disabled = page === 0
    el.querySelector('[data-action="game-next"]').disabled =
      (page + 1) * 32 >= items.length
  }
  function tree(v, depth = 0) {
    if (v === null || typeof v !== 'object')
      return h(m.cleanGameText(String(v ?? '—')))
    return Object.entries(v)
      .map(([k, val]) =>
        typeof val === 'object' && val !== null
          ? '<details class="data-item"><summary>' +
            h(m.label(k)) +
            '</summary>' +
            tree(val, depth + 1) +
            '</details>'
          : '<div class="data-item"><b>' +
            h(m.label(k)) +
            '</b>　' +
            tree(val, depth + 1) +
            '</div>',
      )
      .join('')
  }
  async function showDetail(id) {
    const seq = ++detailVersion
    detailKey = id
    const a = m.catalog.find((i) => i.id === id && i.kind === kind)
    el.innerHTML =
      command('game-back', 'ArrowLeft', '返回列表') +
      '<p class="fine">正在读取资料…</p>'
    try {
      detail = await m.loadGenshinDetail(kind, id)
      if (signal.aborted || seq !== detailVersion) return
      el.innerHTML =
        '<div class="inline-row">' +
        command('game-back', 'ArrowLeft', '返回列表') +
        (detail ? command('game-export', 'Download', '导出 JSON') : '') +
        '</div><div class="p-section"><h2>' +
        h(m.entryName(a)) +
        '</h2><p class="fine">' +
        h(a.enName) +
        '</p></div><div class="detail-groups">' +
        (detail
          ? Object.entries(detail)
              .map(
                ([k, v]) =>
                  '<details data-section="' +
                  h(k) +
                  '"><summary>' +
                  h(m.label(k)) +
                  '</summary><div></div></details>',
              )
              .join('')
          : '<p class="fine">当前快照尚未收录这一条目的详细资料。</p>') +
        '</div>'
      el.querySelectorAll('[data-section]').forEach((d) =>
        listen(d, 'toggle', () => {
          if (d.open && !d.lastElementChild.childNodes.length)
            d.lastElementChild.innerHTML = tree(detail[d.dataset.section])
        }),
      )
    } catch (e) {
      if (!signal.aborted) msg(e.message)
    }
  }
  listen(el, 'input', (e) => {
    if (e.target.type === 'search') {
      q = e.target.value
      page = 0
      draw()
    }
  })
  listen(el, 'change', (e) => {
    if (e.target.name === 'element') element = e.target.value
    if (e.target.name === 'weapon') weapon = e.target.value
    if (e.target.name === 'rarity') rarity = e.target.value
    page = 0
    draw()
  })
  listen(el, 'click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.kind) {
      kind = b.dataset.kind
      element = weapon = rarity = q = ''
      page = 0
      catalog()
    }
    if (b.dataset.game) showDetail(b.dataset.game)
    if (b.dataset.action === 'game-prev') {
      page--
      draw()
    }
    if (b.dataset.action === 'game-next') {
      page++
      draw()
    }
    if (b.dataset.action === 'game-back') {
      detailVersion++
      detail = null
      detailKey = ''
      catalog()
    }
    if (b.dataset.action === 'game-export' && detail)
      m.downloadGenshinJSON(detailKey + '.json', detail)
  })
  catalog()
  if (
    ctx.data?.id &&
    m.catalog.some((a) => a.kind === kind && a.id === ctx.data.id)
  )
    showDetail(ctx.data.id)
  m.loadGenshinImages()
    .then(() => {
      if (!signal.aborted && !detailKey) draw()
    })
    .catch(() => {})
}

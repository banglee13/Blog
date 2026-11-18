import './author.css'
import { OFFLINE } from '../src/lib/runtime'
import { escapeHTML as h, icon, tool, command, download } from './ui.js'
import { getArticles, loadArticle, unlockArticle } from './content.js'
import {
  beginLogin,
  finishLogin,
  currentAccount,
  loginWithToken,
  getDrafts,
  saveDraft,
  removeDraft,
  exportDraft,
  queueDraft,
  getPermissions,
  getRepoTarget,
  setRepoTarget,
  queueDelete,
} from './workspace.js'

const section = (title, inner) =>
  '<section class="p-section"><h3>' + h(title) + '</h3>' + inner + '</section>'
const input = (name, label, value = '', extra = '') =>
  '<label class="field"><span>' +
  h(label) +
  '</span><input name="' +
  name +
  '" value="' +
  h(value) +
  '" ' +
  extra +
  '></label>'
const external = (href, label) => {
  try {
    if (new URL(href).protocol !== 'https:') return h(label)
  } catch {
    return h(label)
  }
  return (
    '<a class="author-link" href="' +
    h(href) +
    '" target="_blank" rel="noreferrer">' +
    h(label) +
    ' ' +
    icon('ExternalLink') +
    '</a>'
  )
}
const select = (node, field) => node.querySelector('[name="' + field + '"]')

export function repoForm(el, { listen, msg }) {
  if (OFFLINE) {
    el.replaceChildren()
    return
  }
  const target = getRepoTarget()
  el.innerHTML =
    '<details><summary>GitHub 仓库</summary><form class="repo-form"><div class="author-grid">' +
    input('owner', '所有者', target.owner, 'required') +
    input('repo', '仓库名称', target.repo, 'required') +
    '</div><p class="fine">分支 ' +
    h(target.branch) +
    ' · 文章目录 ' +
    h(target.postsDir) +
    '</p><button class="command" type="submit">' +
    icon('Save') +
    '保存仓库设置</button></form></details>'
  listen(el.querySelector('form'), 'submit', (e) => {
    e.preventDefault()
    const owner = select(el, 'owner').value.trim(),
      repo = select(el, 'repo').value.trim()
    if (
      !/^[A-Za-z0-9-]+$/.test(owner) ||
      !/^[-A-Za-z0-9_.]+$/.test(repo) ||
      repo === '.' ||
      repo === '..'
    )
      return msg('请输入有效的 GitHub 所有者和仓库名称。')
    setRepoTarget({ ...target, owner, repo })
    msg('已保存目标仓库：' + owner + '/' + repo)
  })
}
export async function mountAuthor(body, ctx) {
  try {
    if (OFFLINE && ['login', 'manage'].includes(ctx.page)) {
      const { offlineAccount, offlineManager } = await import('./offline.js')
      if (!ctx.signal.aborted)
        (ctx.page === 'login' ? offlineAccount : offlineManager)(body, ctx)
      return
    }
    if (ctx.page === 'login') return account(body, ctx)
    if (ctx.page === 'manage') return await manage(body, ctx)
    if (ctx.page === 'editor') return await editor(body, ctx)
  } catch (e) {
    if (!ctx.signal.aborted) ctx.msg(e.message)
  }
}
function account(body, { listen, msg, signal, open }) {
  const user = currentAccount()
  if (user) {
    body.innerHTML =
      '<div class="account-profile"><span>' +
      icon('Github') +
      '</span><div><strong>' +
      h(user.name || user.login) +
      '</strong><small>@' +
      h(user.login) +
      '</small></div></div><div class="actions">' +
      command('workspace', 'Library', '内容管理') +
      command('logout', 'LogOut', '退出登录') +
      '</div>'
    listen(body, 'click', (e) => {
      if (e.target.closest('[data-action="workspace"]')) open('manage')
    })
    return
  }
  body.innerHTML =
    '<div class="account-profile"><span>' +
    icon('Github') +
    '</span><div><strong>连接 GitHub</strong><small>通过你的账号发布文章、投稿与评论。</small></div></div>' +
    '<div class="actions">' +
    command('device', 'Github', '使用 GitHub 登录', 'primary') +
    '</div><div class="auth-progress" aria-live="polite"></div>' +
    '<details><summary>使用访问令牌</summary><form>' +
    input(
      'token',
      'GitHub 访问令牌',
      '',
      'type="password" autocomplete="off" required',
    ) +
    '<button type="submit" class="command">' +
    icon('LogIn') +
    '验证并登录</button></form></details>'
  const status = body.querySelector('.auth-progress'),
    device = body.querySelector('[data-action="device"]')
  listen(device, 'click', async () => {
    device.disabled = true
    status.textContent = '正在获取设备验证码…'
    try {
      const auth = await beginLogin()
      if (signal.aborted) return
      status.innerHTML =
        '<p class="fine">在 GitHub 输入此验证码：</p><div class="account-code">' +
        h(auth.userCode) +
        '</div>' +
        external(auth.verificationUri, '前往 GitHub 授权') +
        '<p class="fine">正在等待授权…</p>'
      await finishLogin(auth, signal)
      if (!signal.aborted) open('login')
    } catch (e) {
      if (!signal.aborted) {
        device.disabled = false
        status.textContent = ''
        msg(e.message)
      }
    }
  })
  listen(body.querySelector('form'), 'submit', async (e) => {
    e.preventDefault()
    const b = e.currentTarget.querySelector('button')
    b.disabled = true
    try {
      await loginWithToken(select(body, 'token').value)
      if (!signal.aborted) open('login')
    } catch (err) {
      if (!signal.aborted) {
        msg(err.message)
        b.disabled = false
      }
    }
  })
}
function ask(body, label, action, fn) {
  const box = body.querySelector('.author-confirm')
  box.hidden = false
  box.replaceChildren()
  const p = document.createElement('p')
  p.textContent = label
  const ok = document.createElement('button')
  ok.className = 'command primary'
  ok.textContent = action
  const cancel = document.createElement('button')
  cancel.className = 'command'
  cancel.textContent = '取消'
  cancel.onclick = () => {
    box.hidden = true
  }
  ok.onclick = async () => {
    ok.disabled = true
    cancel.disabled = true
    try {
      await fn()
    } finally {
      box.hidden = true
    }
  }
  box.append(p, ok, cancel)
  box.scrollIntoView({ block: 'nearest' })
  ok.focus()
}
async function manage(body, ctx) {
  const { open, listen, msg, signal } = ctx
  const queue = await import('../src/lib/updateQueue')
  if (signal.aborted) return
  const drafts = getDrafts(),
    published = getArticles().filter((a) => a.source === 'repo')
  const row = (a, local) =>
    '<div class="library-entry" data-id="' +
    h(a.id) +
    '"><div><strong>' +
    h(a.title) +
    '</strong><small>' +
    h(local ? '本机草稿' : a.date || '加密文章') +
    '</small></div><div>' +
    (!local
      ? tool('read', 'BookOpen', '阅读文章') +
        tool('history', 'List', '查看版本')
      : '') +
    tool('edit', 'PencilLine', '编辑文章') +
    (local
      ? tool('discard', 'Trash2', '删除本机草稿')
      : currentAccount()
        ? tool('delete-remote', 'Trash2', '删除仓库文章')
        : '') +
    '</div></div>'
  body.innerHTML =
    '<div class="actions">' +
    command('new', 'Plus', '写新文章', 'primary') +
    command('queue', 'Upload', '更新队列 · ' + queue.getQueueCount()) +
    '</div>' +
    '<div class="author-confirm" hidden role="group"></div><div class="lib-extra"></div>' +
    section(
      '本机草稿 · ' + drafts.length,
      drafts.length
        ? drafts.map((a) => row(a, true)).join('')
        : '<p class="fine">暂无本机草稿。</p>',
    ) +
    section(
      '已发布 · ' + published.length,
      published.map((a) => row(a, false)).join(''),
    )
  const extra = body.querySelector('.lib-extra')
  const report = (fn) => async () => {
    try {
      await fn()
    } catch (err) {
      if (!signal.aborted) msg(err.message)
    }
  }
  listen(body, 'click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action,
      id = btn.closest('[data-id]')?.dataset.id
    const publishedEntry = published.find((a) => a.id === id)
    try {
      if (action === 'new') open('editor')
      if (action === 'read') ctx.goArticle(publishedEntry)
      if (action === 'edit') open('editor', { id })
      if (action === 'discard')
        ask(
          body,
          '删除这份本机草稿？已发布的文章不受影响。',
          '删除草稿',
          report(async () => {
            removeDraft(id)
            open('manage')
          }),
        )
      if (action === 'delete-remote') {
        const t = getRepoTarget()
        ask(
          body,
          '将《' +
            publishedEntry.title +
            '》从 ' +
            t.owner +
            '/' +
            t.repo +
            ' 删除的操作加入队列？',
          '加入删除队列',
          report(async () => {
            await queueDelete(id)
            body.querySelector('[data-action="queue"]').click()
            msg('删除操作已加入本机队列。')
          }),
        )
      }
      if (action === 'history') {
        extra.textContent = '正在读取 Git 提交…'
        const history = await import('../src/lib/postHistory')
        const names = await import('../src/lib/versionNames')
        const list = await history.loadPostHistory(id, publishedEntry.path)
        if (signal.aborted) return
        const fileSlug = publishedEntry.path
          .split('/')
          .pop()
          .replace(/\.md$/i, '')
        const opts = list
          .map(
            (v) =>
              '<option value="' +
              h(v.sha) +
              '">' +
              h(
                v.committedAt.slice(0, 10) +
                  ' · ' +
                  (names.resolveVersionName(v.sha, fileSlug) || v.message),
              ) +
              '</option>',
          )
          .join('')
        extra.innerHTML = section(
          publishedEntry.title + ' · 历史版本',
          list.length
            ? '<div class="history-browser"><label class="field"><span>版本</span><select name="revision">' +
                opts +
                '</select></label><div class="actions">' +
                command('version-read', 'FileText', '查看版本') +
                command('version-edit', 'PencilLine', '以此版本写草稿') +
                '</div><details><summary>对比与命名</summary><label class="field"><span>选择对照版本</span><select name="compare">' +
                opts +
                '</select></label>' +
                command('version-diff', 'ListTree', '查看源码差异') +
                input('version-name', '自定义版本名') +
                command('version-name', 'Save', '保存版本名') +
                '</details><div class="version-output"></div></div>'
            : '<p class="fine">没有找到提交记录。</p>',
        )
        if (list.length) {
          const pane = extra.querySelector('.history-browser'),
            output = pane.querySelector('.version-output')
          select(pane, 'compare').selectedIndex = Math.min(1, list.length - 1)
          const syncName = () =>
            (select(pane, 'version-name').value =
              names.resolveVersionName(
                select(pane, 'revision').value,
                fileSlug,
              ) || '')
          syncName()
          listen(select(pane, 'revision'), 'change', syncName)
          listen(pane, 'click', async (ev) => {
            const action = ev.target.closest('[data-action]')?.dataset.action
            if (!action?.startsWith('version-')) return
            const sha = select(pane, 'revision').value
            try {
              if (action === 'version-name') {
                const name = select(pane, 'version-name').value.trim()
                names.setVersionName(sha, name)
                queue.enqueueVersionRename(
                  { slug: fileSlug, title: publishedEntry.title },
                  sha,
                  name,
                )
                for (const select of pane.querySelectorAll('select')) {
                  const option = [...select.options].find(
                      (o) => o.value === sha,
                    ),
                    v = list.find((v) => v.sha === sha)
                  option.text =
                    v.committedAt.slice(0, 10) + ' · ' + (name || v.message)
                }
                return msg('版本名已保存，并加入更新队列。')
              }
              output.textContent = '正在读取版本…'
              const raw = await history.loadPostHistoryMarkdown(
                id,
                sha,
                publishedEntry.path,
              )
              if (signal.aborted || !pane.isConnected) return
              if (action === 'version-read') {
                output.innerHTML = '<pre></pre>'
                output.firstChild.textContent = raw
              }
              if (action === 'version-edit') {
                const { buildPost } = await import('../src/lib/posts')
                const post = buildPost(raw, {
                  slug: id,
                  source: 'repo',
                  path: publishedEntry.path,
                })
                if (post.encryption) {
                  output.textContent =
                    '此历史版本已加密。可以从版本源码导出加密文件。'
                  return
                }
                const draft = saveDraft({
                  ...post,
                  id: undefined,
                  title: post.title + '（历史草稿）',
                  encryptIntent: publishedEntry.encrypted,
                })
                open('editor', { id: draft.id })
              }
              if (action === 'version-diff') {
                const old = await history.loadPostHistoryMarkdown(
                  id,
                  select(pane, 'compare').value,
                  publishedEntry.path,
                )
                const diff = await import('../src/lib/diff')
                if (signal.aborted || !pane.isConnected) return
                const lines = diff.diffLines(old, raw),
                  stats = diff.diffStats(lines)
                output.innerHTML =
                  '<p class="fine">新增 ' +
                  stats.added +
                  ' 行 · 删除 ' +
                  stats.removed +
                  ' 行</p><pre>' +
                  diff
                    .collapseContext(lines)
                    .map((l) =>
                      l.type === 'skip'
                        ? '<span>… ' + l.count + ' 行相同</span>'
                        : '<span class="diff-' +
                          l.type +
                          '">' +
                          (l.type === 'insert'
                            ? '+ '
                            : l.type === 'delete'
                              ? '− '
                              : '  ') +
                          h(l.text) +
                          '</span>',
                    )
                    .join('\n') +
                  '</pre>'
              }
            } catch (err) {
              if (!signal.aborted) output.textContent = err.message
            }
          })
        }
      }
      if (action === 'queue') {
        const kinds = {
          'post-publish': '发布文章',
          'post-pr': '创建投稿',
          'post-delete': '删除文章',
          'image-upload': '上传图片',
          'settings-sync': '同步设置',
          'version-name': '命名版本',
        }
        const items = queue.getUpdateQueue()
        extra.innerHTML = section(
          '待提交的更改',
          items.length
            ? items
                .map(
                  (item) =>
                    '<div class="library-entry" data-qi="' +
                    h(item.id) +
                    '"><label class="queue-choice"><input type="checkbox" checked value="' +
                    h(item.id) +
                    '"><span><strong>' +
                    h(item.title) +
                    '</strong><small>' +
                    h(kinds[item.kind]) +
                    ' · ' +
                    h(item.target) +
                    '</small></span></label>' +
                    tool('drop-queue', 'X', '移除此项') +
                    '</div>',
                )
                .join('') + command('flush', 'Upload', '提交选中更改')
            : '<p class="fine">队列为空。</p>',
        )
        body.querySelector('[data-action="queue"]').lastChild.textContent =
          '更新队列 · ' + items.length
      }
      if (action === 'drop-queue') {
        queue.removeQueueItem(btn.closest('[data-qi]').dataset.qi)
        body.querySelector('[data-action="queue"]').click()
      }
      if (action === 'flush') {
        if (!currentAccount()) return msg('请先登录 GitHub，再提交更新。')
        const checked = new Set(
          [...extra.querySelectorAll('input:checked')].map((el) => el.value),
        )
        const items = queue
            .getUpdateQueue()
            .filter((item) => checked.has(item.id)),
          t = getRepoTarget()
        if (!items.length) return msg('请先选择要提交的更改。')
        ask(
          body,
          '将以上 ' +
            items.length +
            ' 项更改提交至 ' +
            t.owner +
            '/' +
            t.repo +
            '？',
          '提交更改',
          report(async () => {
            const res = await queue.flushUpdateQueue(items)
            if (signal.aborted) return
            body.querySelector('[data-action="queue"]').click()
            msg(
              '成功 ' +
                res.succeeded.length +
                ' 项，失败 ' +
                res.failed.length +
                ' 项。' +
                res.failed
                  .map((f) => f.item.title + '：' + f.message)
                  .join('；'),
            )
          }),
        )
      }
    } catch (err) {
      extra.textContent = ''
      if (!signal.aborted) msg(err.message)
    }
  })
}
async function editor(body, ctx) {
  const { data = {}, listen, msg, open, signal } = ctx
  let article = data.id
    ? getDrafts().find((v) => v.id === data.id) || (await loadArticle(data.id))
    : null
  if (signal.aborted) return
  if (article?.encrypted) {
    body.innerHTML =
      '<form>' +
      input('password', '此文章需要密码', '', 'type="password" required') +
      '<button type="submit" class="command primary">' +
      icon('LockKeyhole') +
      '解锁编辑</button></form>'
    listen(body.querySelector('form'), 'submit', async (e) => {
      e.preventDefault()
      try {
        article = await unlockArticle(
          article.id,
          select(body, 'password').value,
        )
        if (!signal.aborted) render()
      } catch (err) {
        msg(err.message)
      }
    })
    return
  }
  render()
  function render() {
    let id = article?.id,
      timer,
      dirty = false,
      previewRoot,
      previewEpoch = 0
    const account = currentAccount(),
      target = getRepoTarget()
    body.innerHTML =
      '<div class="editable">' +
      input('title', '文章标题', article?.title, 'placeholder="无标题文章"') +
      '<label class="field"><span>正文</span><textarea name="content" placeholder="从这里开始写作…" spellcheck="false"></textarea></label>' +
      '<div class="editor-strip"><span class="draft-state" role="status"></span><div>' +
      tool('image', 'Image', '插入本机图片') +
      tool('preview', 'Eye', '预览文章') +
      tool('export', 'Download', '导出 Markdown') +
      '</div></div>' +
      '<input type="file" accept="image/*" hidden><div class="editor-preview" hidden></div>' +
      '<details class="article-meta"><summary>文章资料</summary><div class="author-grid">' +
      input('tags', '标签（逗号分隔）', (article?.tags || []).join(', ')) +
      input('date', '日期', article?.date, 'type="date"') +
      '</div>' +
      input('summary', '摘要', article?.summary) +
      '</details>' +
      '<div class="actions editor-actions">' +
      command('save', 'Save', '保存草稿', 'primary') +
      command('publish', 'Send', OFFLINE ? '发布到本机' : '发布或投稿') +
      command('library', 'Library', '内容管理') +
      '</div>' +
      '<div class="publish-fields" hidden></div><div class="author-confirm" hidden role="group"></div></div>'
    const area = select(body, 'content'),
      state = body.querySelector('.draft-state'),
      preview = body.querySelector('.editor-preview'),
      pub = body.querySelector('.publish-fields')
    area.value = article?.content || ''
    state.textContent =
      article?.source === 'local' ? '已保存至本机' : '本机草稿'
    if (!article) select(body, 'title').focus()
    const draftInput = () => ({
      id,
      title: select(body, 'title').value.trim() || '无标题文章',
      content: area.value,
      tags: select(body, 'tags').value,
      date: select(body, 'date').value,
      summary: select(body, 'summary').value,
    })
    function store(manual = false) {
      clearTimeout(timer)
      if (!manual && !dirty) return
      try {
        const result = saveDraft(draftInput())
        id = result.id
        dirty = false
        state.textContent =
          '已保存至本机 · ' +
          new Date().toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })
      } catch (e) {
        state.textContent = e.message
        if (manual) throw e
      }
    }
    async function showPreview() {
      if (preview.hidden) return
      const epoch = ++previewEpoch
      const [{ createRoot }, react, renderer] = await Promise.all([
        import('react-dom/client'),
        import('react'),
        import('./reader-markdown.jsx'),
      ])
      if (signal.aborted || epoch !== previewEpoch || preview.hidden) return
      previewRoot ??= createRoot(preview)
      previewRoot.render(
        react.createElement(renderer.ArticleBody, {
          source: area.value,
          articles: getArticles(),
          onArticle: () => {},
        }),
      )
    }
    function changed() {
      dirty = true
      state.textContent = '正在编辑…'
      clearTimeout(timer)
      timer = setTimeout(() => {
        store()
        showPreview()
      }, 700)
    }
    listen(body, 'input', (e) => {
      if (
        e.target.closest('.editable') &&
        !e.target.closest('.publish-fields') &&
        e.target.type !== 'file'
      )
        changed()
    })
    listen(body, 'keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        try {
          store(true)
        } catch (err) {
          msg(err.message)
        }
      }
    })
    // close() removes the panel only after abort; keep a pending edit when switching panes.
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        store()
        previewRoot?.unmount()
      },
      { once: true },
    )
    listen(body.querySelector('[type=file]'), 'change', async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      try {
        const { enqueueImageUpload } = await import('../src/lib/updateQueue')
        const url = await enqueueImageUpload(file)
        if (signal.aborted) return
        const label = file.name.replace(/[\[\]\r\n]/g, '')
        area.setRangeText(
          '![' + label + '](' + url + ')',
          area.selectionStart,
          area.selectionEnd,
          'end',
        )
        changed()
        msg('已插入图片，文件在更新队列中，尚未上传。')
      } catch (err) {
        msg(err.message)
      } finally {
        e.target.value = ''
      }
    })
    listen(body, 'click', async (e) => {
      const b = e.target.closest('[data-action]')
      if (!b) return
      try {
        switch (b.dataset.action) {
          case 'save':
            store(true)
            break
          case 'preview':
            preview.hidden = !preview.hidden
            b.setAttribute('aria-pressed', String(!preview.hidden))
            await showPreview()
            break
          case 'image':
            body.querySelector('input[type=file]').click()
            break
          case 'library':
            store()
            open('manage')
            break
          case 'export': {
            store(true)
            const f = exportDraft(id)
            download(f.name, f.text, 'text/markdown;charset=utf-8')
            msg('已导出 Markdown。')
            break
          }
          case 'publish': {
            store(true)
            pub.hidden = false
            if (OFFLINE) {
              pub.innerHTML =
                input(
                  'secret',
                  '文章加密密码（可选）',
                  '',
                  'type="password" autocomplete="new-password"',
                ) +
                command(
                  'publish-local',
                  'Save',
                  '确认保存到本机星图',
                  'primary',
                )
              break
            }
            if (!account) {
              pub.innerHTML =
                '<p class="fine">草稿已保存在本机。登录 GitHub 后即可发布。</p>' +
                command('login', 'LogIn', '登录 GitHub')
              return
            }
            const perms = await getPermissions()
            if (signal.aborted) return
            pub.innerHTML =
              '<p class="fine">发布目标：' +
              h(target.owner) +
              ' / ' +
              h(target.repo) +
              ' · ' +
              h(target.branch) +
              '</p>' +
              input(
                'secret',
                '文章加密密码（可选）',
                '',
                'type="password" autocomplete="new-password"',
              ) +
              '<div class="actions">' +
              (perms.canPush
                ? command('direct', 'Upload', '加入发布队列', 'primary')
                : '') +
              command('pr', 'Send', '加入投稿队列') +
              '</div>'
            break
          }
          case 'login':
            open('login')
            break
          case 'publish-local': {
            if (!OFFLINE) break
            const { publishOfflineDraft } = await import('./offline.js')
            await publishOfflineDraft(id, select(pub, 'secret').value)
            if (!signal.aborted) open('manage')
            break
          }
          case 'direct':
          case 'pr': {
            store(true)
            const mode = b.dataset.action,
              password = select(pub, 'secret').value
            await queueDraft(id, { mode, password })
            if (!signal.aborted) {
              pub.innerHTML = command('library', 'Library', '打开内容管理')
              msg('已加入本机队列，前往内容管理审核并提交。')
            }
            break
          }
        }
      } catch (err) {
        if (!signal.aborted) msg(err.message)
      }
    })
  }
}

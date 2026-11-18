import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clock3,
  List,
  LockKeyhole,
  MessageCircle,
  Orbit,
  Trash2,
  UserRound,
} from 'lucide-react'
import { loadArticle, unlockArticle } from './content'
import { ArticleBody } from './reader-markdown'
import { OFFLINE } from '../src/lib/runtime'
import LocalNotes from './offline-notes.jsx'
import './reader.css'

function KeyForm({ id, onUnlocked }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    const password = new FormData(e.currentTarget).get('password')
    setBusy(true)
    setError('')
    try {
      onUnlocked(await unlockArticle(id, password))
    } catch {
      setError('密码不正确或文章未能解密，请重试。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="cr-locked">
      <LockKeyhole size={22} />
      <h2>这篇文章已加密</h2>
      <label htmlFor="cr-password">文章密码</label>
      <div>
        <input
          id="cr-password"
          name="password"
          type="password"
          autoComplete="off"
          required
        />
        <button disabled={busy}>
          {busy ? '正在解密' : '解锁文章'} <ArrowRight size={16} />
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}

function Comments({ article, onMenu }) {
  const [open, setOpen] = useState(false),
    [api, setApi] = useState(null)
  const [items, setItems] = useState([]),
    [value, setValue] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false)
  const discussions = 'https://github.com/lrbkdgw/Blog/discussions'
  const user = api?.currentAccount()
  const [discussionUrl, setDiscussionUrl] = useState(discussions)
  const [pendingDelete, setPendingDelete] = useState('')
  async function refresh(client) {
    const result = await client.getComments(article.id)
    setItems(result.comments || [])
    setDiscussionUrl(result.discussion?.url || discussions)
  }
  async function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setStatus('')
    setBusy(true)
    try {
      const client = await import('./workspace')
      setApi(client)
      if (client.currentAccount()) await refresh(client)
    } catch (err) {
      setStatus(err?.message || '讨论加载失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }
  async function save(e) {
    e.preventDefault()
    if (!value.trim()) return
    setBusy(true)
    setStatus('')
    try {
      await api.sendComment(article, value.trim())
      setValue('')
      await refresh(api)
    } catch (err) {
      setStatus(err?.message || '评论未能发送。')
    } finally {
      setBusy(false)
    }
  }
  async function remove(id) {
    setBusy(true)
    setStatus('')
    try {
      await api.removeComment(id)
      await refresh(api)
      setPendingDelete('')
    } catch (err) {
      setStatus(err?.message || '删除失败。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="cr-comments">
      <button
        className="cr-discussion-toggle"
        onClick={toggle}
        aria-expanded={open}
      >
        <MessageCircle size={19} /> 文章讨论{' '}
        <ChevronRight size={16} className={open ? 'cr-down' : ''} />
      </button>
      {open && (
        <div className="cr-thread">
          {user ? (
            <>
              {!busy && !status && !items.length && <p>还没有评论。</p>}
              {items.map((c) => (
                <div className="cr-comment" key={c.id}>
                  <header>
                    <strong>{c.author?.login || '读者'}</strong>{' '}
                    <time>{c.createdAt?.slice(0, 10)}</time>
                    {c.viewerCanDelete && (
                      <button
                        type="button"
                        title="删除这条评论"
                        aria-label="删除这条评论"
                        onClick={() => setPendingDelete(c.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </header>
                  <p>{c.body}</p>
                  {pendingDelete === c.id && (
                    <div className="cr-comment-confirm">
                      <span>删除这条评论？</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(c.id)}
                      >
                        删除
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete('')}
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <form onSubmit={save}>
                <label htmlFor="cr-message">撰写评论</label>
                <textarea
                  id="cr-message"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  rows={3}
                  required
                />
                <button disabled={busy || !value.trim()}>
                  发表评论 <ArrowRight size={14} />
                </button>
              </form>
            </>
          ) : (
            !busy && (
              <p>
                登录后即可参与讨论。{' '}
                <button className="cr-inline" onClick={() => onMenu('login')}>
                  打开账户
                </button>
              </p>
            )
          )}
          <p aria-live="polite">{status || (busy ? '正在连接…' : '')}</p>
          <a href={discussionUrl} target="_blank" rel="noreferrer">
            在 GitHub 查看讨论 ↗
          </a>
        </div>
      )}
    </section>
  )
}

function Reader({
  article: original,
  articles = [],
  onBack,
  onMenu,
  onArticle,
}) {
  const [article, setArticle] = useState(original),
    [error, setError] = useState('')
  const [toc, setToc] = useState([]),
    [active, setActive] = useState('')
  const root = useRef(null),
    body = useRef(null),
    headings = useRef([]),
    progress = useRef(null),
    percent = useRef(null)
  const isAbout = article.id === 'about'
  const current = articles.findIndex((a) => a.id === article.id)
  const previous = current > 0 && articles[current - 1],
    next = current >= 0 && articles[current + 1]
  useEffect(() => {
    let live = true
    loadArticle(original.id)
      .then((a) => {
        if (live && a) setArticle(a)
      })
      .catch(() => {
        if (live && !original.content && !original.encrypted)
          setError('文章未能加载。')
      })
    return () => {
      live = false
    }
  }, [original])
  useLayoutEffect(() => {
    if (!body.current) return
    const update = () => {
      headings.current = Array.from(
        body.current.querySelectorAll('h1,h2,h3,h4'),
      ).filter((el) => el.getClientRects().length > 0)
      const used = new Set()
      const sections = headings.current.map((h, i) => {
        let id = h.id || 'section-' + i
        if (used.has(id)) id += '-' + i
        h.id = id
        used.add(id)
        return {
          id,
          label: h.textContent.trim(),
          level: Number(h.tagName.slice(1)),
        }
      })
      setToc(sections)
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(body.current, { childList: true, subtree: true })
    body.current.addEventListener('toggle', update, true)
    const element = body.current
    return () => {
      observer.disconnect()
      element.removeEventListener('toggle', update, true)
    }
  }, [article])
  useLayoutEffect(() => {
    const box = root.current
    let frame = 0
    function draw() {
      frame = 0
      const max = box.scrollHeight - box.clientHeight
      const n =
        max > 0
          ? Math.min(100, Math.max(0, Math.round((box.scrollTop / max) * 100)))
          : 100
      if (progress.current)
        progress.current.style.transform = 'scaleX(' + n / 100 + ')'
      if (percent.current) percent.current.textContent = n + '%'
      const threshold = box.getBoundingClientRect().top + 140
      let i = 0
      for (
        let j = 1;
        j < headings.current.length &&
        headings.current[j].getBoundingClientRect().top <= threshold;
        j++
      )
        i = j
      setActive(headings.current[i]?.id || '')
    }
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    draw()
    box.addEventListener('scroll', queue, { passive: true })
    const resize = new ResizeObserver(queue)
    resize.observe(box)
    if (body.current) resize.observe(body.current)
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      box.removeEventListener('scroll', queue)
    }
  }, [toc])
  const minLevel = Math.min(...toc.map((t) => t.level))
  const bodySource = article.bodyMarkdown ?? article.content ?? ''
  const stableBody = useMemo(
    () => (
      <ArticleBody
        source={bodySource}
        articles={articles}
        onArticle={onArticle}
      />
    ),
    [bodySource, articles, onArticle],
  )
  return (
    <div
      ref={root}
      className="cr-page"
      tabIndex={-1}
      aria-label={isAbout ? '关于博客' : '文章阅读页'}
    >
      <header className="cr-ribbon">
        <div className="cr-ribbon-inner">
          <button onClick={onBack} className="cr-back">
            <ArrowLeft size={17} /> 返回星图
          </button>
          <span className="cr-ribbon-rule" aria-hidden="true"></span>
          <span className="cr-place">{isAbout ? '关于博客' : '文章阅读'}</span>
          <button className="cr-core" onClick={() => onMenu()}>
            <Orbit size={17} /> 星核面板
          </button>
        </div>
        <i className="cr-progress" ref={progress} />
      </header>
      <div className="cr-layout">
        <article className="cr-article">
          <header className="cr-intro">
            <div className="cr-kind">
              <span className="cr-spark" aria-hidden="true">
                ✦
              </span>{' '}
              {article.category || (isAbout ? '博客文档' : '博客文章')}
            </div>
            <h1 tabIndex={-1}>{article.title}</h1>
            {article.excerpt && <p className="cr-deck">{article.excerpt}</p>}
            <div className="cr-meta">
              {article.author && (
                <span>
                  <UserRound />
                  {article.author}
                </span>
              )}
              {article.date && (
                <span>
                  <CalendarDays />
                  <time dateTime={article.date}>
                    {article.date.slice(0, 10)}
                  </time>
                </span>
              )}
              {!!article.readingTime && (
                <span>
                  <Clock3 />约 {article.readingTime} 分钟
                </span>
              )}
            </div>
          </header>
          {article.encrypted ? (
            <KeyForm id={article.id} onUnlocked={setArticle} />
          ) : (
            <div ref={body} className="cr-body">
              {error ? <p role="alert">{error}</p> : stableBody}
            </div>
          )}
          {!article.encrypted &&
            !isAbout &&
            (OFFLINE ? (
              <LocalNotes key={article.id} article={article} />
            ) : (
              <Comments article={article} onMenu={onMenu} />
            ))}
          {(previous || next) && (
            <nav className="cr-neighbors" aria-label="相邻文章">
              {previous && (
                <button onClick={() => onArticle(previous)}>
                  <span>
                    <ArrowLeft size={14} />
                    上一篇
                  </span>
                  <strong>{previous.title}</strong>
                </button>
              )}
              {next && (
                <button onClick={() => onArticle(next)}>
                  <span>
                    下一篇
                    <ArrowRight size={14} />
                  </span>
                  <strong>{next.title}</strong>
                </button>
              )}
            </nav>
          )}
        </article>
        <aside className="cr-aside">
          <div className="cr-aside-title">
            <List size={16} /> 本文目录
          </div>
          {toc.length ? (
            <nav aria-label="本文目录" className="cr-toc">
              {toc.map((t) => (
                <button
                  key={t.id}
                  style={{ '--depth': Math.min(t.level - minLevel, 2) }}
                  aria-current={active === t.id ? 'location' : undefined}
                  onClick={() =>
                    document
                      .getElementById(t.id)
                      ?.scrollIntoView({ block: 'start' })
                  }
                >
                  {t.label}
                </button>
              ))}
            </nav>
          ) : (
            <p className="cr-empty-toc">
              {article.encrypted ? '解锁后可查看目录' : '本文没有分节'}
            </p>
          )}
          <div className="cr-progress-info">
            <span>
              <BookOpen size={14} /> 阅读进度
            </span>
            <b ref={percent}>0%</b>
          </div>
          <button
            className="cr-top"
            onClick={() => root.current.scrollTo({ top: 0 })}
          >
            <ArrowUp size={14} /> 回到篇首
          </button>
        </aside>
      </div>
    </div>
  )
}

export function renderReader(container, options) {
  const root = createRoot(container)
  root.render(<Reader {...options} />)
  return () => root.unmount()
}

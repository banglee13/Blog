import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  CloudOff,
  Copy,
  Download,
  HardDrive,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Save,
  Users,
} from 'lucide-react'
import { useToast } from '../components/Toast'
import {
  createBrowserTransport,
  createLanSession,
  normalizeHubUrl,
  type LanPeer,
  type LanStatus,
} from '../lib/lanSync'
import { textToBlocks } from '../lib/lanDoc'
import { countWords, excerpt, saveLocalPost, slugify, today } from '../lib/posts'
import { OFFLINE } from '../lib/runtime'

/**
 * 局域网协作编辑（issue #112，只在离线单文件版里出现）。
 *
 * 场景是机房 / 宿舍：几台设备在同一个局域网里共写一份文档，全程不碰公网。
 * 中心是自己在某台设备上跑的 `node scripts/offline-hub.mjs`（零依赖，只监听局域网）。
 *
 * 合并规则：文档按**段落**同步，各人改不同段落时互不覆盖；同一段落被同时改动时后写的赢，
 * 被覆盖的一方会显示在「冲突」提示里，可以复制回去。详细取舍见 `lib/lanDoc.ts` 文件头。
 */

const PREF_KEY = 'starlog:lan-hub'
const STATUS_TEXT: Record<LanStatus, string> = {
  idle: '未连接',
  connecting: '正在连接中心…',
  online: '已连接，改动会在停手后自动同步',
  pushing: '正在上行…',
  retrying: '连接不稳，正在重试',
  offline: '连不上中心，检查地址与网络',
}

interface StoredPrefs {
  hub: string
  room: string
  name: string
}

function readPrefs(): StoredPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') as Partial<StoredPrefs>
    return {
      hub: typeof parsed.hub === 'string' ? parsed.hub : '',
      room: typeof parsed.room === 'string' && parsed.room ? parsed.room : '机房协作',
      name: typeof parsed.name === 'string' ? parsed.name : '',
    }
  } catch {
    return { hub: '', room: '机房协作', name: '' }
  }
}

export default function LanEdit() {
  const toast = useToast()
  const initial = useRef(readPrefs())
  const [hub, setHub] = useState(initial.current.hub)
  const [room, setRoom] = useState(initial.current.room)
  const [name, setName] = useState(initial.current.name)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<LanStatus>('idle')
  const [detail, setDetail] = useState('')
  const [peers, setPeers] = useState<LanPeer[]>([])
  const [connected, setConnected] = useState(false)
  const [conflicts, setConflicts] = useState(0)
  const sessionRef = useRef<ReturnType<typeof createLanSession> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editingRef = useRef(false)

  const words = useMemo(() => countWords(text), [text])
  const paragraphs = useMemo(() => textToBlocks(text, '').length, [text])

  const stop = useCallback(() => {
    sessionRef.current?.leave()
    sessionRef.current = null
    setConnected(false)
    setStatus('idle')
    setPeers([])
  }, [])

  useEffect(() => () => stop(), [stop])

  const connect = async () => {
    let base = ''
    try {
      base = normalizeHubUrl(hub)
    } catch (err) {
      toast(err instanceof Error ? err.message : '中心地址无效', 'error')
      return
    }
    const who = name.trim() || `设备-${Math.floor(Math.random() * 900 + 100)}`
    setName(who)
    localStorage.setItem(PREF_KEY, JSON.stringify({ hub: base, room, name: who }))
    stop()

    const session = createLanSession(
      {
        room: room.trim() || 'default',
        name: who,
        handlers: {
          onText(next, meta) {
            // 正在敲字时不回写（光标会跳），等本次输入结束由本地改动去和中心合并
            if (editingRef.current) {
              setConflicts((value) => value + meta.conflicts.length)
              return
            }
            const caret = textareaRef.current?.selectionStart ?? next.length
            setText(next)
            setConflicts(meta.conflicts.length)
            requestAnimationFrame(() => {
              const el = textareaRef.current
              if (el) {
                const position = Math.min(caret, next.length)
                el.selectionStart = el.selectionEnd = position
              }
            })
          },
          onStatus(next, message) {
            setStatus(next)
            setDetail(message ?? '')
          },
          onPeers(list) {
            setPeers(list)
          },
        },
      },
      createBrowserTransport(base),
    )
    sessionRef.current = session
    // 先 seed 再 join：房间是空的时，join 会把这份当成初始文档全量上行
    session.seed(text)
    await session.join()
    setConnected(session.getStatus() !== 'offline')
  }

  const onInput = (value: string) => {
    setText(value)
    editingRef.current = true
    sessionRef.current?.pushLocalText(value)
    window.setTimeout(() => {
      editingRef.current = false
    }, 900)
  }

  const seedFromCurrent = async () => {
    if (!sessionRef.current) return
    sessionRef.current.seed(text)
    // 全量上行：房间可能已有内容，逐条 put 由中心按 (v, ts) 覆盖同 id 段落
    await sessionRef.current.pushEverything()
    toast('已把当前内容提交给房间里的所有人', 'success')
  }

  const saveDraft = () => {
    const title = `局域网协作 · ${room.trim() || 'default'}`
    const slug = slugify(`lan-${room}-${today()}`)
    saveLocalPost({
      slug,
      title,
      date: today(),
      summary: excerpt(text, 120),
      tags: ['局域网协作'],
      draft: true,
      content: text,
    })
    toast(`已存为本机草稿《${title}》，可在「内容管理」里继续编辑`, 'success')
  }

  const download = () => {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `lan-${room || 'doc'}-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="container-page max-w-5xl pt-10" data-yield-list>
      <Link
        to="/toolbox"
        className="group mb-5 inline-flex items-center gap-1.5 text-sm text-ink-400 transition hover:text-brand-600 dark:hover:text-brand-300"
      >
        <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
        回到百宝箱
      </Link>

      <header className="mb-6">
        <h1 className="flex items-center gap-2 font-serif text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl dark:text-white">
          <Users size={26} className="text-brand-500" />
          局域网协作
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500">
          同一个局域网里的几台设备一起编辑一份文档（issue #112）。中心是本机上的一个小进程，
          全程不联网、不经过任何公网服务：
        </p>
      </header>

      <section className="card mb-5 p-5">
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          <li>
            在任意一台设备上执行{' '}
            <code className="font-mono text-[11px]">node scripts/offline-hub.mjs --room {room || '机房协作'}</code>
            （离线文件单独用时，把这个脚本和 <code className="font-mono text-[11px]">offline/index.html</code> 放在一起）。
          </li>
          <li>每台设备填同一个中心地址与房间名，点「连接」。</li>
          {typeof window !== 'undefined' && window.location.protocol === 'file:' && (
            <li>
              你现在是用 <code className="font-mono text-[11px]">file://</code> 打开的：部分浏览器不允许本机文件向{' '}
              <code className="font-mono text-[11px]">http://</code> 发请求，连不上中心时改用中心自己发的地址打开
              （<code className="font-mono text-[11px]">http://&lt;那台设备的IP&gt;:8787/</code>），它会把同一份离线页面发给局域网里的其他设备。
            </li>
          )}
          <li>
            文档只存在那个进程的内存里 —— 收尾时记得{' '}
            <span className="font-medium text-ink-700 dark:text-ink-200">存为本地草稿</span> 或导出。
          </li>
        </ol>

        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">中心地址</span>
            <input
              value={hub}
              onChange={(e) => setHub(e.target.value)}
              disabled={connected}
              placeholder="http://192.168.1.20:8787"
              className="input font-mono text-xs"
              spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">房间名</span>
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              disabled={connected}
              placeholder="机房协作"
              className="input text-xs"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">你的名字</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={connected}
              placeholder="同桌看到的名字"
              className="input text-xs"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {connected ? (
            <button type="button" className="btn-outline h-9" onClick={() => { stop(); toast('已断开', 'info') }}>
              <LogOut size={15} />
              断开
            </button>
          ) : (
            <button type="button" className="btn-primary h-9" onClick={() => void connect()}>
              <LogIn size={15} />
              连接
            </button>
          )}
          <button
            type="button"
            className="btn-outline h-9"
            disabled={!connected}
            onClick={() => void sessionRef.current?.flush()}
          >
            <RefreshCw size={15} />
            立即上行
          </button>
          <button type="button" className="btn-outline h-9" disabled={!connected || !text.trim()} onClick={() => void seedFromCurrent()}>
            <CloudOff size={15} />
            用当前内容初始化房间
          </button>
          <span className="ml-auto flex items-center gap-1.5 text-xs">
            {status === 'connecting' || status === 'pushing' ? (
              <Loader2 size={13} className="animate-spin text-brand-500" />
            ) : status === 'offline' || status === 'retrying' ? (
              <CloudOff size={13} className="text-rose-500" />
            ) : (
              <span className={`h-2 w-2 rounded-full ${status === 'online' ? 'bg-emerald-500' : 'bg-ink-300 dark:bg-white/20'}`} />
            )}
            <span className="text-ink-500 dark:text-ink-400">{STATUS_TEXT[status]}</span>
            {detail && <span className="text-rose-500">· {detail}</span>}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-400">在线 {peers.length} 人：</span>
          {peers.length === 0 ? (
            <span className="text-ink-400">（还没有别人进来）</span>
          ) : (
            peers.map((peer) => (
              <span
                key={peer.name}
                className={`rounded-full px-2 py-0.5 ${
                  peer.name === name
                    ? 'bg-brand-500/12 font-medium text-brand-600 dark:text-brand-300'
                    : 'bg-ink-100/80 text-ink-600 dark:bg-white/[0.06] dark:text-ink-300'
                }`}
              >
                {peer.name}
              </span>
            ))
          )}
        </div>

        {conflicts > 0 && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            刚才有 {conflicts} 处「同一段落被两人同时改动」的情况：中心按后写保留，先写的那份被覆盖。
            建议把这一段的分工说一声，或者各写各的段落。
          </p>
        )}
        {!OFFLINE && (
          <p className="mt-3 text-xs leading-relaxed text-rose-500">
            这个页面只在离线单文件版里提供（协作必须完全在局域网内完成，不经过公网）。
            在线站点请用 <Link to="/admin" className="underline">内容管理</Link> 与待更新队列。
          </p>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-ink-200/70 px-4 py-2 text-xs text-ink-400 dark:border-white/10">
          <span className="font-mono">{words} 字</span>
          <span className="font-mono">{paragraphs} 段</span>
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              className="btn-ghost h-7 px-2"
              onClick={() => {
                void navigator.clipboard?.writeText(text)
                toast('已复制全文', 'success')
              }}
            >
              <Copy size={13} />
              复制
            </button>
            <button type="button" className="btn-ghost h-7 px-2" onClick={download}>
              <Download size={13} />
              导出
            </button>
            <button type="button" className="btn-ghost h-7 px-2" onClick={saveDraft}>
              <Save size={13} />
              存为本地草稿
            </button>
          </span>
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onInput(e.target.value)}
          placeholder={connected ? '开始写吧，停手约 0.7 秒后自动同步给房间里的其他人…' : '填写中心地址后点「连接」，也可以先在这里写一段'}
          spellCheck={false}
          className="editor-textarea h-[min(60vh,34rem)] w-full resize-none bg-transparent p-5 font-mono text-[14px] text-ink-800 outline-none placeholder:text-ink-400 dark:text-ink-100"
        />
        <p className="flex items-center gap-1.5 border-t border-ink-200/70 px-4 py-2 text-xs text-ink-400 dark:border-white/10">
          <HardDrive size={13} />
          共享文档只在局域网中心的内存里；这份离线文件不会向公网发出任何请求。
        </p>
      </section>
    </div>
  )
}

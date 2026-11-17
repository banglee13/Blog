import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  CloudOff,
  Copy,
  Download,
  HardDrive,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Save,
  Settings2,
  Users,
} from 'lucide-react'
import { useToast } from '../components/Toast'
import {
  createBrowserTransport,
  createLanSession,
  discoverHub,
  formatRoomCode,
  hubCandidates,
  normalizeHubUrl,
  normalizeRoomCode,
  parseLanInvite,
  type LanPeer,
  type LanRoomSummary,
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
 * 交互目标：**加入者只输 6 位房间码**。中心地址由页面自己找 ——
 *   手填地址 → 当前站点（页面本来就是中心发出去的）→ 本机连过的地址，
 * 逐个问 `GET /api/rooms?code=` 谁有这个房间码就接进谁；全都找不到时才展开「高级」手填。
 * 浏览器不能监听端口、也拿不到自己的网段（ICE candidate 被 mDNS 混淆），
 * 所以「发起者连一条命令都不用跑」这件事在纯网页里做不到，那一条命令是硬要求。
 *
 * 合并规则：文档按**段落**同步，各人改不同段落时互不覆盖；同一段落被同时改动时后写的赢，
 * 被覆盖的一方会计入「冲突」提示。详细取舍见 `lib/lanDoc.ts` 文件头。
 */

const PREF_KEY = 'starlog:lan-hub'
const HUBS_KEY = 'starlog:lan-hubs'
/** 扫描候选中心时单个地址最多等多久（局域网里连不上通常就是端口不通，等久了反而卡手） */
const PROBE_TIMEOUT_MS = 1200

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
      room: typeof parsed.room === 'string' ? parsed.room : '',
      name: typeof parsed.name === 'string' ? parsed.name : '',
    }
  } catch {
    return { hub: '', room: '', name: '' }
  }
}

/** 最近用过的中心地址（最多 5 条）：第二次开始就不必再找。 */
function readHubHistory(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(HUBS_KEY) || '[]') as unknown
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string' && !!item) : []
  } catch {
    return []
  }
}

function rememberHub(hub: string) {
  if (!hub) return
  try {
    const next = [hub, ...readHubHistory().filter((item) => item !== hub)].slice(0, 5)
    localStorage.setItem(HUBS_KEY, JSON.stringify(next))
  } catch {
    // 存储不可用（无痕模式等）：记住地址这种事丢了也不影响协作
  }
}

/** 只读探测：中心不可达、端口上跑的别的服务、超时，一律当「不是它」跳过。 */
async function probeHub(url: string): Promise<{ rooms?: LanRoomSummary[] }> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as { rooms?: LanRoomSummary[] }
  } finally {
    window.clearTimeout(timer)
  }
}

export default function LanEdit() {
  const toast = useToast()
  const initial = useRef(readPrefs())
  const [params] = useSearchParams()
  const invite = useMemo(() => parseLanInvite(params.toString()), [params])
  const [code, setCode] = useState(() => {
    const fromLink = normalizeRoomCode(invite?.room ?? '')
    if (fromLink) return fromLink
    return normalizeRoomCode(initial.current.room) || formatRoomCode(initial.current.room)
  })
  const [hub, setHub] = useState(() => invite?.hub || initial.current.hub || '')
  const [name, setName] = useState(initial.current.name)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<LanStatus>('idle')
  const [detail, setDetail] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [peers, setPeers] = useState<LanPeer[]>([])
  const [connected, setConnected] = useState(false)
  const [connectedHub, setConnectedHub] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [roomName, setRoomName] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [conflicts, setConflicts] = useState(0)
  const sessionRef = useRef<ReturnType<typeof createLanSession> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editingRef = useRef(false)
  const autoJoinRef = useRef(false)

  const words = useMemo(() => countWords(text), [text])
  const paragraphs = useMemo(() => textToBlocks(text, '').length, [text])
  const currentOrigin = useMemo(() => {
    if (typeof window === 'undefined') return ''
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return ''
    return window.location.origin
  }, [])
  const digits = normalizeRoomCode(code)

  const stop = useCallback(() => {
    sessionRef.current?.leave()
    sessionRef.current = null
    setConnected(false)
    setConnectedHub('')
    setStatus('idle')
    setPeers([])
  }, [])

  useEffect(() => () => stop(), [stop])

  /** 连上之后要做的事：记住中心、把状态摆好。 */
  const openSession = useCallback(
    async (base: string, identifier: string, who: string) => {
      const session = createLanSession(
        {
          room: identifier,
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
      const ok = session.getStatus() !== 'offline'
      setConnected(ok)
      if (ok) {
        setConnectedHub(base)
        rememberHub(base)
        const got = session.getRoomCode()
        if (got) setRoomCode(got)
      }
      return ok
    },
    [text],
  )

  /**
   * 「只输房间码」的加入流程。
   *
   * 先在候选中心里找有这个码的房间；找不到就用第一个候选（通常是当前站点）把房间建起来 ——
   * 这就是发起者的路径：他跑的进程就在同一个 origin 上，中心认得这个码，别人随后扫得到。
   */
  const connect = useCallback(async () => {
    const who = name.trim() || `设备-${Math.floor(Math.random() * 900 + 100)}`
    setName(who)
    stop()

    let manual = ''
    if (hub.trim()) {
      try {
        manual = normalizeHubUrl(hub)
      } catch (err) {
        toast(err instanceof Error ? err.message : '中心地址无效', 'error')
        setAdvancedOpen(true)
        return
      }
    }
    const candidates = hubCandidates({
      manual,
      currentOrigin,
      history: manual ? [] : readHubHistory(),
    })
    const identifier = digits || code.trim() || 'default'

    if (candidates.length === 0) {
      toast('这台设备还不知道中心在哪：在「高级」里填一次中心地址就行（之后会自动记住）', 'info')
      setAdvancedOpen(true)
      return
    }

    let target = ''
    if (digits) {
      setDiscovering(true)
      const found = await discoverHub(digits, candidates, probeHub)
      setDiscovering(false)
      if (found) {
        target = found.hub
        setRoomName(found.room.name ?? '')
      }
    } else {
      // 填的是房间名而不是码：只能连自己指定/记着的那个中心
      target = candidates[0]
    }
    if (!target) target = manual || candidates[0]

    localStorage.setItem(PREF_KEY, JSON.stringify({ hub: target, room: identifier, name: who }))
    const ok = await openSession(target, identifier, who)
    if (!ok) {
      toast('连不上任何中心。确认那台设备的 `node scripts/offline-hub.mjs` 还开着', 'error')
      return
    }
    const session = sessionRef.current
    const joinedCode = session?.getRoomCode() ?? ''
    if (digits && joinedCode === digits) {
      toast(`已加入房间 ${formatRoomCode(digits)}`, 'success')
    } else if (digits) {
      toast(`已在 ${target} 上开好房间 ${formatRoomCode(joinedCode || digits)}，把这 6 位数字告诉其他人`, 'success')
      setCode(formatRoomCode(joinedCode || digits))
    } else {
      toast('已连接中心', 'success')
    }
  }, [code, currentOrigin, digits, hub, name, openSession, stop, toast])

  // 从中心打印的加入链接进来时：地址与房间码都在链接里，直接连上，一个字段都不用填
  useEffect(() => {
    if (autoJoinRef.current) return
    if (!invite?.room) return
    autoJoinRef.current = true
    if (invite.hub) setHub(invite.hub)
    void connect()
  }, [connect, invite])

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

  const inviteLink = useMemo(() => {
    const base = connectedHub || currentOrigin
    const shown = formatRoomCode(roomCode || digits)
    if (!base || !shown) return ''
    return `${base}/#/toolbox/lan?room=${shown}`
  }, [connectedHub, currentOrigin, digits, roomCode])

  const saveDraft = () => {
    const label = roomCode || code.trim() || 'room'
    const title = `局域网协作 · ${formatRoomCode(label) || label}`
    saveLocalPost({
      slug: slugify(`lan-${label}-${today()}`),
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
    const label = roomCode || code.trim() || 'doc'
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `lan-${label}-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const shownCode = formatRoomCode(roomCode || digits)
  const busy = discovering || status === 'connecting'

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
          全程只在局域网里跑，不经过任何公网服务。
        </p>
      </header>

      <section className="card mb-5 p-5">
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          <li>
            在任意一台设备上执行{' '}
            <code className="font-mono text-[11px]">node scripts/offline-hub.mjs --open</code>
            （离线文件单独用时，把这个脚本和 <code className="font-mono text-[11px]">offline/index.html</code> 放在一起）。
            它会打印房间码并打开这个页面。
          </li>
          <li>
            其他人只要**输那 6 位房间码**：页面会在「当前站点 → 本机连过的中心 → 手填地址」里自己找，
            谁有这个房间码就接进谁。
          </li>
          {typeof window !== 'undefined' && window.location.protocol === 'file:' && (
            <li>
              你现在是用 <code className="font-mono text-[11px]">file://</code> 打开的：部分浏览器不允许本机文件向{' '}
              <code className="font-mono text-[11px]">http://</code> 发请求。连不上时改用中心发出来的地址打开
              （<code className="font-mono text-[11px]">http://&lt;那台设备的IP&gt;:8787/</code>），
              它会把同一份离线页面发给局域网里的其他设备。
            </li>
          )}
          <li>
            文档只存在那个进程的内存里 —— 收尾时记得{' '}
            <span className="font-medium text-ink-700 dark:text-ink-200">存为本地草稿</span> 或导出。
          </li>
        </ol>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-500">
              <KeyRound size={13} className="text-brand-500" />
              房间码
            </span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d-]/g, '').slice(0, 7))}
              disabled={connected}
              placeholder="483-902"
              inputMode="numeric"
              autoComplete="off"
              className="input text-center font-mono text-lg tracking-[0.35em]"
              spellCheck={false}
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-ink-400">
              6 位数字。也可以直接填中心启动时打印的房间名。
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">你的名字（别人看到的）</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={connected}
              placeholder="留空自动取一个，例如 设备-427"
              className="input text-xs"
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-ink-400">
              {digits ? `房间码 ${formatRoomCode(digits)} · 中心地址自动寻找` : '填房间名时需要在「高级」里指定中心地址'}
            </span>
          </label>
        </div>

        <details
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
          className="mt-3 rounded-lg bg-ink-100/50 px-3 py-2 dark:bg-white/[0.04]"
        >
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-ink-500 dark:text-ink-400">
            <Settings2 size={13} />
            高级：手动指定中心地址或房间名
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
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
            <p className="self-center text-[11px] leading-relaxed text-ink-400">
              只有页面自己找不到中心时才需要填；填过一次之后这台设备会记住它（最多 5 个地址）。
            </p>
          </div>
        </details>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {connected ? (
            <button
              type="button"
              className="btn-outline h-9"
              onClick={() => {
                stop()
                toast('已断开', 'info')
              }}
            >
              <LogOut size={15} />
              断开
            </button>
          ) : (
            <button type="button" className="btn-primary h-9" disabled={busy} onClick={() => void connect()}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
              {discovering ? '正在找中心…' : '加入房间'}
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
          <button
            type="button"
            className="btn-outline h-9"
            disabled={!connected || !text.trim()}
            onClick={() => void seedFromCurrent()}
          >
            <CloudOff size={15} />
            用当前内容初始化房间
          </button>
          <span className="ml-auto flex items-center gap-1.5 text-xs">
            {busy || status === 'pushing' ? (
              <Loader2 size={13} className="animate-spin text-brand-500" />
            ) : status === 'offline' || status === 'retrying' ? (
              <CloudOff size={13} className="text-rose-500" />
            ) : (
              <span
                className={`h-2 w-2 rounded-full ${
                  status === 'online' ? 'bg-emerald-500' : 'bg-ink-300 dark:bg-white/20'
                }`}
              />
            )}
            <span className="text-ink-500 dark:text-ink-400">{discovering ? '在候选中心里找这个房间码…' : STATUS_TEXT[status]}</span>
            {detail && <span className="text-rose-500">· {detail}</span>}
          </span>
        </div>

        {connected && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-brand-500/[0.07] px-4 py-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-brand-600 dark:text-brand-300">
                房间码
              </p>
              <p className="font-mono text-2xl font-semibold tracking-[0.2em] text-ink-900 dark:text-white">
                {shownCode || '—'}
              </p>
            </div>
            <div className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
              <p>房间名 {roomName || '（中心没给名字）'}</p>
              <p className="font-mono text-[11px]">{connectedHub}</p>
            </div>
            {inviteLink && (
              <button
                type="button"
                className="btn-ghost ml-auto h-8 px-2 text-xs"
                onClick={() => {
                  void navigator.clipboard?.writeText(inviteLink)
                  toast('加入链接已复制，发到群里别人点开就在房间里了', 'success')
                }}
              >
                <Copy size={13} />
                复制加入链接
              </button>
            )}
          </div>
        )}

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
          placeholder={
            connected
              ? '开始写吧，停手约 0.7 秒后自动同步给房间里的其他人…'
              : '输好房间码点「加入房间」；也可以先在这里写一段，进去时会自动作为初始内容交出去'
          }
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

/**
 * 局域网协作的客户端会话（issue #112）。
 *
 * 与中心（`scripts/offline-hub.mjs`）之间只有四个接口 + 一条 SSE：
 *   POST /api/join   { room, name }              → { rev, blocks, peers }
 *   POST /api/ops    { room, name, ops }         → { rev, blocks, peers }
 *   GET  /api/state?room=&name=                  → { rev, blocks, peers }
 *   GET  /api/events?room=&name=   (SSE)         → { type: 'doc' | 'presence', ... }
 *
 * 同步策略（写在这里，别当成黑盒）：
 *   1. 本地每次改动都先记下来，停止输入 `quietMs`（默认 700ms）后才把「相对上次同步基线的段落差异」发出去；
 *   2. 收到别人的改动时，如果我方正处在输入中，先不回写编辑器（否则光标会跳），等本轮输入结束后一并合并；
 *   3. 合并完成后以中心的段落表为准重写文本 —— 同一段落被两边同时改时后写的覆盖先写的，
 *      被覆盖的一方会出现在 `conflicts` 里，界面提示可以自己复制回去。
 *
 * 网络与事件流都从外面注入（`transport`），因此这一层可以离线单测，也方便以后换 SSE → WebSocket。
 */
import {
  applyRemoteOps,
  blocksToText,
  liveBlocks,
  planLocalChange,
  textToBlocks,
  type LanBlock,
  type LanOp,
  resequence,
} from './lanDoc'

export type LanStatus =
  | 'idle'
  | 'connecting'
  /** 已连上中心，可以同步 */
  | 'online'
  /** 正在上行本地改动 */
  | 'pushing'
  /** 中心不可达，正在重试 */
  | 'retrying'
  | 'offline'

export interface LanPeer {
  name: string
  at: number
}

/** 中心 `GET /api/rooms` 列出的房间摘要。 */
export interface LanRoomSummary {
  code: string
  name: string
  rev?: number
  peers?: number
  chars?: number
}

export interface LanTransport {
  request<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T>
  /** 订阅一个事件流路径（如 `/api/events?room=x`），返回取消函数 */
  subscribe(path: string, handler: (event: LanEvent) => void): () => void
}

/** 中心推过来的事件。`doc` 带段落改动，`presence` 只报在线成员。 */
export interface LanEvent {
  type?: 'doc' | 'presence'
  ops?: LanOp[]
  by?: string
  rev?: number
  peers?: LanPeer[]
}

export interface LanDocState {
  rev: number
  blocks: LanBlock[]
  peers: LanPeer[]
  /** 中心给这个房间定的 6 位房间码（新建房间时由中心生成） */
  code?: string
  name?: string
}

export interface LanSessionHandlers {
  /** 合并后的最新文本（界面据此重写编辑区） */
  onText(text: string, meta: { rev: number; by: string; conflicts: LanBlock[] }): void
  onStatus(status: LanStatus, detail?: string): void
  onPeers(peers: LanPeer[]): void
}

export interface LanSessionOptions {
  room: string
  name: string
  handlers: LanSessionHandlers
  /** 输入停止多久后上行（ms） */
  quietMs?: number
  /** 断线后的重试间隔（ms） */
  retryMs?: number
}

const DEFAULT_QUIET_MS = 700
const DEFAULT_RETRY_MS = 3000

export interface LanSession {
  /** 载入初始文本（加入房间前 / 载入本地草稿时） */
  seed(text: string): void
  /** 中心回报的房间码（join / state 的响应里带；没连上时为 null） */
  getRoomCode(): string | null
  /** 编辑器内容变化时调用；内部按 quietMs 去抖 */
  pushLocalText(text: string): void
  /** 立刻把当前文本发出去（失焦、手动保存时） */
  flush(): Promise<void>
  /**
   * 把当前整篇内容**全量**上行（不走差异）。
   *
   * 空房间第一次进、或想把本地草稿当成房间初始文档时用：此时基线与内容相同，
   * 差异比对会得出「什么都不用发」，中心就永远拿不到内容了。
   */
  pushEverything(): Promise<void>
  join(): Promise<void>
  leave(): void
  getStatus(): LanStatus
}

export function createLanSession(options: LanSessionOptions, transport: LanTransport): LanSession {
  const { room, name, handlers } = options
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS

  let blocks: LanBlock[] = []
  let rev = 0
  let roomCode: string | null = null
  /** 上次与中心一致的文本：本地差异都以它为基线计算 */
  let baseline = ''
  /**
   * baseline 对应的那份段落表。
   *
   * 关键：正在输入时收到的远端段落**不能**参与「本地差异」的比对，否则下一次上行会把
   * 别人刚写、自己还没看到的段落当成「被我删掉了」发出去。差异一律以这行为基线算，
   * 再由 `bumpVersions()` 把版本号抬到中心当前值之上，保证 LWW 判据下我们的写入能赢。
   */
  let baselineBlocks: LanBlock[] = []
  let pendingText: string | null = null
  let remoteChangedWhileTyping = false
  let status: LanStatus = 'idle'
  let joined = false
  let closed = false
  let quietTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let unsubscribe: (() => void) | null = null

  const setStatus = (next: LanStatus, detail?: string) => {
    if (status === next && !detail) return
    status = next
    handlers.onStatus(next, detail)
  }

  const emitText = (conflicts: LanBlock[], by: string) => {
    const text = blocksToText(blocks)
    baseline = text
    baselineBlocks = blocks.map((block) => ({ ...block }))
    handlers.onText(text, { rev, by, conflicts })
  }

  /** 把计划里的版本号抬到中心当前值之上（远端在我输入期间改过同一段时尤其需要）。 */
  const bumpVersions = (ops: LanOp[]): LanOp[] => {
    const now = Date.now()
    for (const op of ops) {
      const current = blocks.find((block) => block.id === op.id)
      if (!current) continue
      if (current.v > op.v || (current.v === op.v && current.ts > op.ts)) {
        op.v = current.v + 1
        op.ts = Math.max(now, current.ts + 1)
      }
    }
    return ops
  }

  const adopt = (state: LanDocState) => {
    blocks = resequence(Array.isArray(state.blocks) ? state.blocks : [])
    rev = state.rev
    if (typeof state.code === 'string' && state.code) roomCode = state.code
    handlers.onPeers(Array.isArray(state.peers) ? state.peers : [])
  }

  const schedule = (fn: () => void, delay: number) => {
    if (quietTimer) clearTimeout(quietTimer)
    quietTimer = setTimeout(() => {
      quietTimer = null
      fn()
    }, delay)
  }

  const pushNow = async () => {
    if (closed || !joined) return
    const text = pendingText ?? baseline
    pendingText = null
    if (text === baseline || (pendingText === null && text === baseline)) {
      if (remoteChangedWhileTyping) {
        remoteChangedWhileTyping = false
        emitText([], name)
      }
      return
    }
    const plan = planLocalChange(baselineBlocks, text, name)
    const ops = bumpVersions([...plan.puts, ...plan.dels])
    if (ops.length === 0) {
      // 本地只是空白 / 空行差异，段落内容没变：本地吸收，不打扰中心
      baseline = text
      if (remoteChangedWhileTyping) {
        remoteChangedWhileTyping = false
        emitText([], name)
      }
      return
    }
    const ok = await sendOps(ops)
    if (!ok) {
      // 发送失败：留着这份文本，重试成功后再冲一次
      pendingText = text
      return
    }
    // 基线段落表要跟上，否则下一次差异比对会把已发的改动再发一遍
    baselineBlocks = blocks.map((block) => ({ ...block }))
  }

  /** 段落表里所有存活段落 → 全量 put（顺序与文档一致） */
  const opsForAll = (source: LanBlock[] = blocks): LanOp[] =>
    liveBlocks(source).map((block) => ({
      id: block.id,
      kind: 'put',
      text: block.text,
      seq: block.seq,
      v: block.v,
      by: name,
      ts: block.ts,
    }))

  const sendOps = async (ops: LanOp[]): Promise<boolean> => {
    if (closed || !joined || ops.length === 0) return false
    setStatus('pushing')
    try {
      const state = await transport.request<LanDocState>('/api/ops', {
        method: 'POST',
        body: { room, name, ops },
      })
      adopt(state)
      remoteChangedWhileTyping = false
      setStatus('online')
      emitText([], name)
      return true
    } catch (err) {
      setStatus('retrying', err instanceof Error ? err.message : '上行失败')
      scheduleRetry()
      return false
    }
  }

  const scheduleRetry = () => {
    if (retryTimer || closed) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      void (async () => {
        try {
          await refresh()
          setStatus('online')
        } catch {
          setStatus('offline')
        }
      })()
    }, retryMs)
  }

  const refresh = async () => {
    const state = await transport.request<LanDocState>(`/api/state?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`)
    adopt(state)
    emitText([], state.peers.find((peer) => peer.name !== name)?.name ?? name)
  }

  const onEvent = (event: LanEvent) => {
    if (!event) return
    if (Array.isArray(event.peers)) handlers.onPeers(event.peers)
    if (event.type !== 'doc') return
    const ops = Array.isArray(event.ops) ? event.ops : []
    if (ops.length === 0) return
    const result = applyRemoteOps(blocks, ops)
    blocks = result.blocks
    if (typeof event.rev === 'number') rev = event.rev
    if (pendingText !== null || (quietTimer !== null && blocksToText(blocks) !== baseline)) {
      // 正在输入：先记下「中心有新东西」，等本轮输入结束再合并，避免光标乱跳
      remoteChangedWhileTyping = true
      return
    }
    emitText(result.conflicts, event.by ?? '')
  }

  return {
    seed(text) {
      // 只用于「进房间前先把本地内容摆好」：直接按段落建表，不动中心
      blocks = textToBlocks(text, name)
      baseline = blocksToText(blocks)
      baselineBlocks = blocks.map((block) => ({ ...block }))
      pendingText = null
    },
    pushLocalText(text) {
      if (closed) return
      if (text === baseline && !remoteChangedWhileTyping) return
      pendingText = text
      schedule(() => {
        void pushNow()
      }, quietMs)
    },
    async pushEverything() {
      if (joined) await sendOps(opsForAll())
    },
    async flush() {
      if (quietTimer) {
        clearTimeout(quietTimer)
        quietTimer = null
      }
      await pushNow()
    },
    async join() {
      closed = false
      setStatus('connecting')
      try {
        // 先留住本地已经写好的内容：adopt 会用中心的段落表覆盖 blocks，
        // 空房间时全靠这份快照把初始文档交出去。
        const localSnapshot = [...blocks]
        const state = await transport.request<LanDocState>('/api/join', {
          method: 'POST',
          body: { room, name },
        })
        adopt(state)
        joined = true
        setStatus('online')
        const remoteText = blocksToText(blocks)
        if (!remoteText && localSnapshot.length) {
          // 房间还是空的：把本地这份整篇交出去当初始内容（差异比对在这里派不上用场）
          await sendOps(opsForAll(localSnapshot))
        } else if (remoteText) {
          pendingText = null
          emitText([], name)
        }
        unsubscribe = transport.subscribe(`/api/events?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`, onEvent)
      } catch (err) {
        joined = false
        setStatus('offline', err instanceof Error ? err.message : '无法连接局域网中心')
        scheduleRetry()
      }
    },
    leave() {
      closed = true
      joined = false
      if (quietTimer) clearTimeout(quietTimer)
      if (retryTimer) clearTimeout(retryTimer)
      quietTimer = null
      retryTimer = null
      pendingText = null
      unsubscribe?.()
      unsubscribe = null
      setStatus('idle')
      void transport
        .request('/api/leave', { method: 'POST', body: { room, name } })
        .catch(() => undefined)
    },
    getRoomCode() {
      return roomCode
    },
    getStatus() {
      return status
    },
  }
}

/* ------------------------------ 房间码与自动发现 ------------------------------ */

/** 只认 6 位数字；`483-902`、`483 902`、`483902` 都算同一个码，其余返回空串。 */
export function normalizeRoomCode(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length === 6 ? digits : ''
}

/** 展示形式：483902 → 483-902。 */
export function formatRoomCode(value: unknown): string {
  const digits = normalizeRoomCode(value)
  return digits ? `${digits.slice(0, 3)}-${digits.slice(3)}` : ''
}

export interface LanInvite {
  /** 中心地址；只有链接里显式写了 hub 时才有值 */
  hub: string
  /** 房间码或房间名（原样保留，交给中心去认） */
  room: string
  code: string
}

/**
 * 解析「加入链接」里的查询串。
 *
 * 链接形如 `http://192.168.1.20:8787/#/toolbox/lan?room=483-902`：离线版用 HashRouter，
 * 查询串在 hash 里，所以 `location.search` 是空的 —— 这里两种都吃（传入整串或带 ? 前缀都行）。
 * `hub` 允许省略：页面本身就由中心发出时，当前站点就是答案。
 */
export function parseLanInvite(raw: string): LanInvite | null {
  if (typeof raw !== 'string') return null
  const query = raw.replace(/^.*?\?/, '').trim()
  if (!query || !/[?&]?(room|code|hub)=/i.test(raw)) return null
  let params: URLSearchParams
  try {
    params = new URLSearchParams(query)
  } catch {
    return null
  }
  const room = (params.get('room') ?? params.get('code') ?? '').trim()
  const hubRaw = (params.get('hub') ?? '').trim()
  const code = normalizeRoomCode(room)
  if (!code && !room && !hubRaw) return null
  return { hub: hubRaw, room: room || '', code }
}

/**
 * 该去哪些地址找中心：手填 > 当前站点（页面就是中心发出来的）> 本机连过的。
 *
 * 顺序是有意的：手填最明确；当前站点在「用中心发的链接打开」时 100% 命中；
 * 记忆列表按最近使用排在前面。`file://` 打开的离线文件没有 origin 可用，此时只剩记忆与手填。
 */
export function hubCandidates(input: { manual?: string; currentOrigin?: string; history?: string[] }): string[] {
  const out: string[] = []
  const push = (value?: string) => {
    const trimmed = (value ?? '').trim().replace(/\/+$/, '')
    if (!trimmed) return
    if (trimmed === 'null' || trimmed === 'file://') return
    if (!/^https?:\/\//i.test(trimmed)) return
    if (!out.includes(trimmed)) out.push(trimmed)
  }
  push(input.manual)
  push(input.currentOrigin)
  for (const item of input.history ?? []) push(item)
  return out
}

/**
 * 在候选中心里找「有这个房间码」的那一台。
 *
 * 只做只读的 `GET /api/rooms?code=`：中心没有这个房间时返回空列表（也不会顺手建），
 * 所以扫错地址、扫到没跑协作的机器（fetch 抛错）都直接跳过，不会有任何副作用。
 */
export async function discoverHub(
  code: string,
  candidates: string[],
  probe: (url: string) => Promise<{ rooms?: LanRoomSummary[] }>,
): Promise<{ hub: string; room: LanRoomSummary } | null> {
  const digits = normalizeRoomCode(code)
  if (!digits) return null
  for (const hub of candidates) {
    try {
      const payload = await probe(`${hub}/api/rooms?code=${digits}`)
      const hit = (payload?.rooms ?? []).find((room) => normalizeRoomCode(room.code) === digits)
      if (hit) return { hub, room: hit }
    } catch {
      // 这个地址不可达 / 不是中心：换下一个候选
    }
  }
  return null
}

/** 浏览器实现：fetch + EventSource，全部指向用户自己填的局域网地址。 */
export function createBrowserTransport(hubUrl: string): LanTransport {
  const base = normalizeHubUrl(hubUrl)
  return {
    async request<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
      const response = await fetch(`${base}${path}`, {
        method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
        ...(init?.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }),
      })
      if (!response.ok) throw new Error(`中心返回 ${response.status} ${response.statusText}`)
      return (await response.json()) as T
    },
    subscribe(path, handler) {
      const source = new EventSource(`${base}${path}`)
      const onMessage = (event: MessageEvent<string>) => {
        try {
          handler(JSON.parse(event.data))
        } catch {
          // 坏帧忽略，等下一帧
        }
      }
      source.addEventListener('starlog', onMessage)
      return () => source.close()
    },
  }
}

/**
 * 把用户填的地址整理成 `http://host:port` 形式。
 *
 * 允许填 `192.168.1.5:8787`、`http://…/`、`http://…/api`（老手会顺手贴完整路径），
 * 但只接受 http / https 与局域网风格的主机写法，避免变成任意跳转。
 */
export function normalizeHubUrl(input: string): string {
  const raw = input.trim()
  if (!raw) throw new Error('请填写中心地址，例如 http://192.168.1.20:8787')
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error('中心地址不是合法 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('中心地址只能是 http:// 或 https://')
  }
  // 主机名再核一遍：只接受 IP / 主机名 / IPv6 字面量，且必须像局域网里能填的东西
  // （new URL() 对 `http://notaurl!!` 这种照样放行，不能只靠它）
  const host = url.hostname
  const hostOk = /^\[[0-9a-f:.]+\]$/i.test(host) || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(host)
  if (!hostOk || (!host.includes('.') && !host.includes(':') && host !== 'localhost')) {
    throw new Error('中心地址的主机名不像局域网设备，例如 http://192.168.1.20:8787 或 http://nas.local:8787')
  }
  const path = url.pathname.replace(/\/+$/, '')
  const trimmed = path.endsWith('/api') ? path.slice(0, -4) : path
  return `${url.protocol}//${url.host}${trimmed === '/' ? '' : trimmed}`
}

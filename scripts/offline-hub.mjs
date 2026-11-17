#!/usr/bin/env node
/**
 * 离线版「局域网协作」中心（issue #112）。
 *
 * 离线单文件版完全不联网，所以协作的中心必须是用户自己机器上的一个小进程。这个文件：
 *   · 零依赖，只用 Node 内置模块（`node scripts/offline-hub.mjs` 就能跑，不用 npm install）；
 *   · 只监听局域网地址，**不向公网发出任何请求**；
 *   · 顺手把 `offline/index.html` 作为站点根路径发出去，局域网里其他设备直接用浏览器打开就加入了；
 *   · 文档只存在内存里，进程一停就没了 —— 要留档请在页面里「存为本地草稿」或导出文章包。
 *
 * 用法：
 *   node scripts/offline-hub.mjs                     # 端口 8787，房间 default
 *   node scripts/offline-hub.mjs --port 9000 --room 机房四人
 *   node scripts/offline-hub.mjs --file dist-offline/index.html --allow-write
 *
 * 然后每台设备打开离线文件（或 http://<本机局域网IP>:8787/），在「百宝箱 → 局域网协作」里
 * 填同一个中心地址和房间名即可。
 *
 * 协议（与 src/lib/lanSync.ts 一一对应）：
 *   POST /api/join   { room, name }        → { rev, blocks, peers }
 *   POST /api/ops    { room, name, ops }   → { rev, blocks, peers }
 *   POST /api/leave  { room, name }        → { ok }
 *   GET  /api/state?room=&name=            → { rev, blocks, peers }
 *   GET  /api/events?room=&name=  (SSE)    → event: starlog / data: { type, ops, by, rev, peers }
 *
 * 段落合并语义与 `src/lib/lanDoc.ts` 保持一致：按 (v, ts) 后写覆盖先写，删除打墓碑，
 * seq 挤在一起时中心负责重排。改动请同时跑 `npm test`（里面有协议级集成测试）。
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { hostname, networkInterfaces } from 'node:os'
import { extname, resolve } from 'node:path'

/* --------------------------------- 参数 --------------------------------- */

function parseArgs(argv) {
  const out = {
    port: 8787,
    host: '0.0.0.0',
    room: 'default',
    file: 'offline/index.html',
    readOnly: false,
    quiet: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[(i += 1)]
    if (arg === '--port' || arg === '-p') out.port = Number.parseInt(next(), 10)
    else if (arg === '--host' || arg === '-h') out.host = next()
    else if (arg === '--room') out.room = next()
    else if (arg === '--file') out.file = next()
    else if (arg === '--allow-write') out.allowWrite = true // 旧参数名，等价于「不加 --read-only」
    else if (arg === '--read-only') out.readOnly = true
    else if (arg === '--quiet') out.quiet = true
    else if (arg === '--help') {
      out.help = true
    }
  }
  if (!Number.isFinite(out.port) || out.port <= 0 || out.port > 65535) {
    throw new Error(`--port 需要一个 1-65535 的端口，收到：${argv.join(' ')}`)
  }
  return out
}

/* -------------------------------- 文档模型 -------------------------------- */

const SEQ_GAP = 1000

/** 房间：一份段落表 + 在线成员 + SSE 订阅者 */
class Room {
  constructor(name) {
    this.name = name
    this.rev = 0
    /** @type {Map<string, object>} */
    this.blocks = new Map()
    /** @type {Map<string, { at: number }>} */
    this.peers = new Map()
    /** @type {Set<import('node:http').ServerResponse>} */
    this.clients = new Set()
  }

  snapshot() {
    const blocks = [...this.blocks.values()]
      .filter((block) => !block.dead)
      .sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : 1))
    return { rev: this.rev, blocks, peers: this.peerList() }
  }

  peerList() {
    const now = Date.now()
    const peers = []
    for (const [name, info] of this.peers) {
      if (now - info.at > 90_000) {
        this.peers.delete(name)
        continue
      }
      peers.push({ name, at: info.at })
    }
    return peers.sort((a, b) => a.name.localeCompare(b.name))
  }

  touch(name) {
    if (!name) return
    this.peers.set(name, { at: Date.now() })
  }

  /**
   * 与 src/lib/lanDoc.ts 的 applyRemoteOps + resequence 等价：
   * (v, ts) 新的覆盖旧的，删除只打墓碑，seq 撞上就整表重排。
   */
  applyOps(ops, by) {
    let changed = 0
    for (const op of ops) {
      if (!op || typeof op.id !== 'string' || (op.kind !== 'put' && op.kind !== 'del')) continue
      const existing = this.blocks.get(op.id)
      const incomingVersion = Number.isFinite(op.v) ? op.v : 1
      const incomingTime = Number.isFinite(op.ts) ? op.ts : Date.now()
      if (existing) {
        const newer =
          incomingVersion > existing.v || (incomingVersion === existing.v && incomingTime >= existing.ts)
        if (!newer) continue
        if (op.kind === 'del') {
          existing.dead = true
        } else {
          existing.dead = false
          existing.text = typeof op.text === 'string' ? op.text : ''
          if (Number.isFinite(op.seq)) existing.seq = op.seq
        }
        existing.v = incomingVersion
        existing.by = by || existing.by
        existing.ts = incomingTime
      } else if (op.kind === 'put') {
        this.blocks.set(op.id, {
          id: op.id,
          text: typeof op.text === 'string' ? op.text : '',
          seq: Number.isFinite(op.seq) ? op.seq : SEQ_GAP,
          v: incomingVersion,
          by: by || 'unknown',
          ts: incomingTime,
          dead: false,
        })
      } else {
        // 没见过的段落要删：说明它已经被删过，直接忽略
        continue
      }
      changed += 1
    }
    if (changed === 0) return null
    this.resequenceIfNeeded()
    this.rev += 1
    return ops
  }

  resequenceIfNeeded() {
    const sorted = [...this.blocks.values()].sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : 1))
    let needs = false
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i].seq - sorted[i - 1].seq
      if (!(gap >= 1)) {
        needs = true
        break
      }
    }
    if (!needs) return
    sorted.forEach((block, index) => {
      block.seq = (index + 1) * SEQ_GAP
    })
  }

  broadcast(payload) {
    const frame = `event: starlog\ndata: ${JSON.stringify(payload)}\n\n`
    for (const res of this.clients) res.write(frame)
  }

  textLength() {
    let total = 0
    for (const block of this.blocks.values()) if (!block.dead) total += block.text.length
    return total
  }
}

const rooms = new Map()

function getRoom(name) {
  const key = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'default'
  let room = rooms.get(key)
  if (!room) {
    room = new Room(key)
    rooms.set(key, room)
  }
  return room
}

/* --------------------------------- HTTP --------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

const MAX_BODY_BYTES = 2 * 1024 * 1024
/** 单段文字与整篇文档的上限（内存中心，不设限会被一张大图压垮） */
const MAX_OP_TEXT = 200 * 1024
const MAX_ROOM_TEXT = 4 * 1024 * 1024

function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        rejectPromise(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolvePromise({})
        return
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        rejectPromise(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', rejectPromise)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function serveApp(res, filePath) {
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(
      `找不到离线单文件版：${filePath}\n\n` +
        '先执行 npm run build:offline 生成 dist-offline/index.html，' +
        '或用 --file 指定你手上那个离线文件的位置。',
    )
    return
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'Content-Length': statSync(filePath).size,
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  })
  createReadStream(filePath).pipe(res)
}

export function createLanHub(options = {}) {
  const config = {
    file: resolve(process.cwd(), options.file ?? 'offline/index.html'),
    defaultRoom: options.room ?? 'default',
    readOnly: options.readOnly === true,
    onLog: typeof options.onLog === 'function' ? options.onLog : () => {},
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Max-Age': '600',
      })
      res.end()
      return
    }

    try {
      if (path === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          rooms: [...rooms.keys()],
          peers: [...rooms.values()].reduce((sum, room) => sum + room.peerList().length, 0),
        })
        return
      }
      if (path === '/api/join' && req.method === 'POST') {
        const body = await readBody(req)
        const room = getRoom(body.room || config.defaultRoom)
        const name = String(body.name ?? '').trim().slice(0, 40) || '匿名'
        room.touch(name)
        config.onLog(`加入「${room.name}」：@${name}`)
        room.broadcast({ type: 'presence', peers: room.peerList() })
        sendJson(res, 200, room.snapshot())
        return
      }
      if (path === '/api/ops' && req.method === 'POST') {
        if (config.readOnly) {
          sendJson(res, 403, { error: '中心当前是只读模式（--read-only），去掉这个参数即可写入' })
          return
        }
        const body = await readBody(req)
        const room = getRoom(body.room || config.defaultRoom)
        const name = String(body.name ?? '').trim().slice(0, 40) || '匿名'
        room.touch(name)
        const ops = Array.isArray(body.ops) ? body.ops.slice(0, 500) : []
        // 体积上限：整篇 4MB、单段 200KB，超限整批退回不应用（内存里的小中心不替你收超大文档）
        const oversized = ops.find((op) => typeof op?.text === 'string' && op.text.length > MAX_OP_TEXT)
        if (oversized) {
          sendJson(res, 413, { error: `单段文字超过 ${Math.round(MAX_OP_TEXT / 1024)}KB，请拆分段落` })
          return
        }
        if (room.textLength() > MAX_ROOM_TEXT) {
          sendJson(res, 413, { error: '共享文档已超过 4MB，先删减一点再提交' })
          return
        }
        if (ops.length > 0 && room.applyOps(ops, name)) {
          config.onLog(`「${room.name}」@${name} 提交 ${ops.length} 处改动（rev ${room.rev}）`)
          // 别人的改动只发 op 给对方，自己这条以 POST 响应为准，避免自己的回声把自己顶回去
          room.broadcast({ type: 'doc', ops, by: name, rev: room.rev, peers: room.peerList() })
        }
        sendJson(res, 200, room.snapshot())
        return
      }
      if (path === '/api/leave' && req.method === 'POST') {
        const body = await readBody(req)
        const room = rooms.get(String(body.room || config.defaultRoom).trim().slice(0, 60))
        const name = String(body.name ?? '').trim()
        if (room) {
          room.peers.delete(name)
          room.broadcast({ type: 'presence', peers: room.peerList() })
        }
        sendJson(res, 200, { ok: true })
        return
      }
      if (path === '/api/state') {
        const room = getRoom(url.searchParams.get('room') || config.defaultRoom)
        const name = url.searchParams.get('name')
        room.touch(name ?? '')
        sendJson(res, 200, room.snapshot())
        return
      }
      if (path === '/api/events') {
        const room = getRoom(url.searchParams.get('room') || config.defaultRoom)
        const name = url.searchParams.get('name')
        room.touch(name ?? '')
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })
        res.write('retry: 2000\n\n')
        res.write(`event: starlog\ndata: ${JSON.stringify({ type: 'hello', ...room.snapshot() })}\n\n`)
        room.clients.add(res)
        const heartbeat = setInterval(() => {
          room.touch(name ?? '')
          res.write(': ping\n\n')
        }, 25_000)
        req.on('close', () => {
          clearInterval(heartbeat)
          room.clients.delete(res)
          if (name) {
            room.peers.delete(name)
            room.broadcast({ type: 'presence', peers: room.peerList() })
          }
        })
        return
      }
      if (path === '/' || path === '/index.html' || path === '/404.html') {
        serveApp(res, config.file)
        return
      }
      sendJson(res, 404, { error: '未知路径', path })
    } catch (err) {
      config.onLog(`错误：${err instanceof Error ? err.message : String(err)}`)
      sendJson(res, 400, { error: err instanceof Error ? err.message : '请求失败' })
    }
  })

  return { server, rooms, config }
}

/* --------------------------------- 启动 --------------------------------- */

function localAddresses(port) {
  const lines = []
  const interfaces = networkInterfaces()
  for (const [device, list] of Object.entries(interfaces)) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) {
        lines.push(`    http://${item.address}:${port}/   （${device}）`)
      }
    }
  }
  lines.push(`    http://127.0.0.1:${port}/   （本机）`)
  return lines
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)

if (isMain) {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err))
    process.exit(1)
  }
  if (options.help) {
    console.log(
      [
        '用法：node scripts/offline-hub.mjs [选项]',
        '',
        '  --port <n>        监听端口（默认 8787）',
        '  --host <addr>     监听地址（默认 0.0.0.0，即局域网可见）',
        '  --room <名称>     默认房间名（默认 default）',
        '  --file <路径>     要作为站点发出的离线单文件（默认 offline/index.html）',
        '  --read-only       只读模式：只能看别人的改动，不接受写入（默认允许写入）',
        '  --quiet           不打印日志',
        '',
        '每台设备打开该地址（或自己的离线 HTML 文件），在「百宝箱 → 局域网协作」里',
        '填同一个中心地址与房间名即可一起编辑。文档只存在内存里，进程停止就没了。',
      ].join('\n'),
    )
    process.exit(0)
  }
  const { server, config } = createLanHub({ ...options, readOnly: options.readOnly })
  server.listen(options.port, options.host, () => {
    if (options.quiet) return
    console.log(`\n  局域网协作中心 · ${hostname()}`)
    console.log(`  ─ ${'─'.repeat(46)}`)
    console.log(`  默认房间：${config.defaultRoom}`)
    console.log(`  写入权限：${config.readOnly ? '只读（--read-only）' : '允许写入'}`)
    console.log(`  离线文件：${config.file}${existsSync(config.file) ? '' : '   ← 找不到，页面仍可用自己手上的离线文件'}`)
    console.log(`\n  其他设备访问：`)
    for (const line of localAddresses(options.port)) console.log(line)
    console.log('\n  Ctrl+C 停止（内存里的共享文档会一起消失）\n')
  })
  const shutdown = () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

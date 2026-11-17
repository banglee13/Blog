/**
 * 局域网协作的文档模型（issue #112）。
 *
 * 离线单文件版按设计完全不联网，所以「同一个局域网里的几台设备一起改一份文档」必须满足：
 *   · 服务器是用户自己在任意一台设备上跑的（`scripts/offline-hub.mjs`，零依赖），
 *     只监听局域网地址，绝不访问公网；
 *   · 文档按**段落**合并：一个段落是一个 block，各设备并发改不同段落时互不覆盖；
 *     同一段落被同时改动时按「最后写入优先」，并把被覆盖的一方留在冲突记录里（不丢内容）。
 *
 * 为什么不直接上 CRDT（Yjs 之类）：离线版是**单个 HTML 文件**，产物体积已经由内置文章与
 * KaTeX 字体决定；为局域网写作再加一整套 OT/CRDT 依赖不划算，而且段落级 LWW 对
 * 「几个人分头写同一段说明」这种机房场景足够。这个取舍写在这里，别当成遗漏。
 *
 * 本模块只有纯函数，不碰 fetch / EventSource，所以 `scripts/test-features.mjs` 能直接跑。
 */

/** 文档里的一个段落。 */
export interface LanBlock {
  id: string
  text: string
  /** 排序键：插入时取相邻两段的中点，冲突时由中心重排（见 resequence） */
  seq: number
  /** 段落版本号，每次写入 +1；LWW 的比较用 (v, ts) */
  v: number
  /** 最后写入这台设备的名字 */
  by: string
  /** 最后写入时间（毫秒） */
  ts: number
  /** 墓碑：删除只标记，避免别人的旧写入把它「复活」 */
  dead?: boolean
}

/** 一次要发给中心的改动。 */
export interface LanOp {
  /** 段落 id */
  id: string
  kind: 'put' | 'del'
  text?: string
  seq?: number
  v: number
  by: string
  ts: number
}

export interface LanDocSnapshot {
  rev: number
  blocks: LanBlock[]
}

const SEQ_GAP = 1000

let idCounter = 0

/** 生成 block id：设备内自增 + 时间戳 + 随机尾巴，局域网里不会撞车。 */
export function nextBlockId(prefix = 'b'): string {
  idCounter = (idCounter + 1) % 0xffff
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

export function compareBlocks(a: LanBlock, b: LanBlock): number {
  return a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** 按 seq 排好序的存活段落。 */
export function liveBlocks(blocks: LanBlock[]): LanBlock[] {
  return blocks.filter((block) => !block.dead).sort(compareBlocks)
}

/** 文档文本 = 各段之间空一行（与 Markdown 的分段习惯一致）。 */
export function blocksToText(blocks: LanBlock[]): string {
  return liveBlocks(blocks).map((block) => block.text).join('\n\n')
}

/**
 * 把文本切成段落。
 *
 * 以「一整行空白」为分隔；行内换行留在同一段里，所以一段代码块、一个列表不会被拆开。
 * 连续多个空行会合并成一个分隔（协作时按段落对齐比保留原始空白更重要）。
 */
export function textToBlocks(text: string, by: string, ts = Date.now()): LanBlock[] {
  return splitParagraphs(text).map((paragraph, index) => ({
    id: nextBlockId(),
    text: paragraph,
    seq: (index + 1) * SEQ_GAP,
    v: 1,
    by,
    ts,
  }))
}

/** 代码围栏起始行（``` 或 ~~~，三个及以上）。 */
const FENCE_RE = /^\s*(`{3,}|~{3,})/
/** 本站的容器块：`::begin_ui-ccs … ::end_ui-ccs`、`::IF[…] … ::IF_END` 内部的空行不能把段落切开。 */
const CONTAINER_BEGIN_RE = /^\s*::begin_|^\s*::IF\[/
const CONTAINER_END_RE = /^\s*::end_|^\s*::IF_END\b/

/**
 * 按「一整行空白」切段，但**跳过代码围栏与容器块内部**。
 *
 * 少了这条保护，`::begin_ui-ccs` 里一空行就会被当成两段，同步后行号与语义都会错位；
 * 代码块中间的空行同理（`splitParagraphs` 的产物要和 Markdown 的分段习惯一致才有意义）。
 * 段落首尾的空白行会被去掉，行内缩进保留（缩进式代码块依赖它）。
 */
export function splitParagraphs(text: string): string[] {
  if (!text.trim()) return []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let fence = ''
  let containers = 0

  const flush = () => {
    while (current.length && current[0].trim() === '') current.shift()
    while (current.length && current[current.length - 1].trim() === '') current.pop()
    if (current.length) {
      const joined = current.map((line) => line.replace(/[ \t]+$/, '')).join('\n')
      if (joined.trim()) blocks.push(joined.replace(/\s+$/, ''))
    }
    current = []
  }

  for (const line of lines) {
    const fenceMark = FENCE_RE.exec(line)?.[1] ?? ''
    const insideBlock = fence !== '' || containers > 0
    if (!insideBlock && line.trim() === '') {
      flush()
      continue
    }
    if (fence) {
      // 围栏的闭合要求同一字符且不比开头短（``` 关掉 ```，也关掉 ````，但 ~~~ 不关 ```）
      if (fenceMark && fenceMark[0] === fence[0] && fenceMark.length >= fence.length) fence = ''
    } else if (fenceMark) {
      fence = fenceMark
    }
    if (CONTAINER_BEGIN_RE.test(line)) containers += 1
    else if (CONTAINER_END_RE.test(line) && containers > 0) containers -= 1
    current.push(line)
  }
  flush()
  return blocks
}

/** 中心收到的一份快照 → 文本。 */
export function snapshotToText(snapshot: LanDocSnapshot): string {
  return blocksToText(snapshot.blocks)
}

/**
 * 求两组段落的最长公共子序列（下标对列表），用来判断「哪些段落是同一段」。
 *
 * 只比字符串是否完全相等，不做行内 diff：段落级合并足够支撑「你写第一节、我写第二节」，
 * 而行内合并需要真正的 CRDT，见文件头的取舍说明。前后缀先剥掉，中间再跑 DP，
 * 一般只有几段有差异，代价很小。
 */
export function lcsMatches(base: string[], target: string[]): Array<[number, number]> {
  const matches: Array<[number, number]> = []
  let head = 0
  while (head < base.length && head < target.length && base[head] === target[head]) {
    matches.push([head, head])
    head += 1
  }
  let baseEnd = base.length - 1
  let targetEnd = target.length - 1
  const tail: Array<[number, number]> = []
  while (baseEnd >= head && targetEnd >= head && base[baseEnd] === target[targetEnd]) {
    tail.unshift([baseEnd, targetEnd])
    baseEnd -= 1
    targetEnd -= 1
  }
  const rows = baseEnd - head + 1
  const cols = targetEnd - head + 1
  if (rows > 0 && cols > 0) {
    const width = cols + 1
    const table = new Int32Array((rows + 1) * width)
    for (let r = rows - 1; r >= 0; r -= 1) {
      for (let c = cols - 1; c >= 0; c -= 1) {
        table[r * width + c] =
          base[head + r] === target[head + c]
            ? table[(r + 1) * width + c + 1] + 1
            : Math.max(table[(r + 1) * width + c], table[r * width + c + 1])
      }
    }
    let r = 0
    let c = 0
    while (r < rows && c < cols) {
      if (base[head + r] === target[head + c]) {
        matches.push([head + r, head + c])
        r += 1
        c += 1
      } else if (table[(r + 1) * width + c] >= table[r * width + c + 1]) {
        r += 1
      } else {
        c += 1
      }
    }
  }
  return matches.concat(tail)
}

export interface LocalChangePlan {
  /** 需要新写入 / 改动的段落 */
  puts: LanOp[]
  /** 需要删除的段落 id */
  dels: LanOp[]
  /** 与远端一致、不用发出去的段落 */
  kept: number
  /** 目标文本（用于本地立刻反映最新状态） */
  blocks: LanBlock[]
}

/**
 * 把「本地编辑后的整篇文本」与「上次同步的基线段落表」比对，生成要发给中心的改动。
 *
 * 先按内容完全相同做最长公共子序列拿到「锚点段落」，再逐段处理锚点之间的空隙：
 *   · 两边数量对得上的 → 视为**改写**，沿用原 id 与位置，只在内容真的变了时发一条 put；
 *   · 目标多出来的 → 新增，seq 落在前一段与锚点段之间（小数即可，中心会在挤不下时整表重排）；
 *   · 基线多出来的 → 打墓碑删除。
 * 关键是「改写」这一步：没有它，改一句话就变成「删掉旧的 + 新插一段」，
 * 别人在同一段上的改动会被误删，行号也会跳。
 */
export function planLocalChange(
  previous: LanBlock[],
  nextText: string,
  localName: string,
  now = Date.now(),
): LocalChangePlan {
  const baseBlocks = liveBlocks(previous)
  const baseText = baseBlocks.map((block) => block.text)
  const targetText = splitParagraphs(nextText)
  const anchors = lcsMatches(baseText, targetText)

  const copies = new Map<string, LanBlock>(previous.map((block) => [block.id, { ...block }]))
  const puts: LanOp[] = []
  const dels: LanOp[] = []
  let kept = 0

  /** 新增段落的排序键：均匀插在前后锚点之间，留给并发插入的空位由中心重排时收回。 */
  const seqForInserts = (prev: LanBlock | undefined, anchor: LanBlock | undefined, count: number, index: number): number => {
    const lo = prev ? prev.seq : anchor ? anchor.seq - SEQ_GAP : 0
    const hi = anchor && anchor.seq > lo ? anchor.seq : lo + SEQ_GAP
    return lo + ((hi - lo) * (index + 1)) / (count + 1)
  }

  let bi = 0
  let ti = 0
  let prevBlock: LanBlock | undefined
  const stops: Array<[number, number]> = [...anchors, [baseBlocks.length, targetText.length]]
  for (const [anchorBase, anchorTarget] of stops) {
    const baseGap = baseBlocks.slice(bi, anchorBase)
    const targetGap = targetText.slice(ti, anchorTarget)
    const anchorBlock = anchorBase < baseBlocks.length ? baseBlocks[anchorBase] : undefined
    const paired = Math.min(baseGap.length, targetGap.length)

    for (let k = 0; k < paired; k += 1) {
      const block = copies.get(baseGap[k].id)
      if (!block) continue
      block.dead = false
      const text = targetGap[k]
      if (block.text !== text) {
        block.text = text
        block.v += 1
        block.by = localName
        block.ts = now
        puts.push({ id: block.id, kind: 'put', text, v: block.v, by: localName, ts: now })
      } else {
        kept += 1
      }
      prevBlock = block
    }

    const inserts = targetGap.slice(paired)
    inserts.forEach((text, index) => {
      const block: LanBlock = {
        id: nextBlockId(),
        text,
        seq: seqForInserts(prevBlock, anchorBlock, inserts.length, index),
        v: 1,
        by: localName,
        ts: now,
      }
      copies.set(block.id, block)
      puts.push({ id: block.id, kind: 'put', text, seq: block.seq, v: 1, by: localName, ts: now })
      prevBlock = block
    })

    for (let k = paired; k < baseGap.length; k += 1) {
      const block = copies.get(baseGap[k].id)
      if (!block || block.dead) continue
      block.dead = true
      block.v += 1
      block.by = localName
      block.ts = now
      dels.push({ id: block.id, kind: 'del', v: block.v, by: localName, ts: now })
    }

    if (anchorBlock) {
      const anchor = copies.get(anchorBlock.id)
      if (anchor && anchor.dead) {
        // 锚点段落在这一轮被删过又出现在目标里：算「改回来」，重新启用
        anchor.dead = false
        anchor.v += 1
        anchor.by = localName
        anchor.ts = now
        puts.push({ id: anchor.id, kind: 'put', text: anchor.text, v: anchor.v, by: localName, ts: now })
      } else if (anchor) {
        kept += 1
      }
      prevBlock = anchor
      bi = anchorBase + 1
    }
    ti = anchorTarget + 1
  }

  return { puts, dels, kept, blocks: [...copies.values()] }
}

/** 把远端的改动套到本地段落表上（LWW：(v, ts) 新的赢）。 */
export function applyRemoteOps(blocks: LanBlock[], ops: LanOp[]): { blocks: LanBlock[]; conflicts: LanBlock[] } {
  const byId = new Map(blocks.map((block) => [block.id, { ...block }]))
  const conflicts: LanBlock[] = []
  for (const op of ops) {
    const existing = byId.get(op.id)
    if (!existing) {
      if (op.kind === 'put') {
        byId.set(op.id, {
          id: op.id,
          text: op.text ?? '',
          seq: typeof op.seq === 'number' ? op.seq : SEQ_GAP,
          v: op.v,
          by: op.by,
          ts: op.ts,
        })
      }
      continue
    }
    if (!isNewer(op, existing)) {
      // 旧改动（乱序到达 / 自己的回声）：忽略，但记录成冲突，让界面能说清「谁覆盖了谁」
      continue
    }
    if (op.kind === 'del') {
      existing.dead = true
      existing.v = op.v
      existing.by = op.by
      existing.ts = op.ts
      continue
    }
    if (existing.text !== (op.text ?? '')) {
      conflicts.push({ ...existing })
    }
    existing.text = op.text ?? ''
    if (typeof op.seq === 'number') existing.seq = op.seq
    existing.v = op.v
    existing.by = op.by
    existing.ts = op.ts
    existing.dead = false
  }
  return { blocks: [...byId.values()], conflicts }
}

function isNewer(op: LanOp, block: LanBlock): boolean {
  return op.v > block.v || (op.v === block.v && op.ts >= block.ts)
}

/**
 * 中心侧的重排：把段落按当前顺序编号，避免并发插入把 seq 挤成同一个数。
 * 客户端不需要主动调用（下一次同步拿到的是重排后的快照）。
 */
export function resequence(blocks: LanBlock[]): LanBlock[] {
  const sorted = [...blocks].sort(compareBlocks)
  const gapsTooSmall = sorted.some((block, index) => index > 0 && block.seq - sorted[index - 1].seq < 1)
  const duplicated = new Set(sorted.map((block) => block.seq)).size !== sorted.length
  if (!gapsTooSmall && !duplicated) return blocks
  return sorted.map((block, index) => ({ ...block, seq: (index + 1) * SEQ_GAP }))
}

/** 该不该用远端段落覆盖本地段落。 */
export function shouldAdoptRemote(local: LanBlock | undefined, remote: LanBlock): boolean {
  if (!local) return true
  if (local.dead && !remote.dead) return remote.v > local.v
  return remote.v > local.v || (remote.v === local.v && remote.ts > local.ts)
}

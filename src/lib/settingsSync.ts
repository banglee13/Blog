/**
 * 设置同步（issue #129 / #130）。
 *
 * 登录 GitHub 之后，这台设备上的**所有个人设置**（配色主题、明暗模式、字体与字号、背景渐变、
 * 固定背景图片的选择、动态背景及参数、编辑器开关、目标仓库……以及以后新增的任何个人偏好）
 * 会自动保存到账号，并在其他设备登录同一账号时自动恢复。
 *
 * 保存在哪：站点仓库的 GitHub Discussions 里有一个专属讨论（标题见 `settingsSyncConfig`），
 * 每个账号在里面有**一条由本人发表的评论**，评论正文里是一段 JSON。
 *   - 不向仓库提交任何文件、不进待更新队列、不需要仓库写权限：任何登录用户都能保存自己的设置；
 *   - 评论只有作者本人（和仓库管理员）能改，别人改不了你的设置；
 *   - 读取时只认 GitHub 标明「当前登录者本人发表」的那条评论。
 * 注意 Discussions 是公开的：这里只放外观与使用偏好，不放令牌、草稿等任何敏感内容。
 *
 * 怎么合并多台设备的改动：每一项设置各自带一个「最后修改时间」，谁改得晚听谁的
 * （时间相同时以账号里的为准，各设备才能收敛到同一个值）。因此在手机上换了配色、
 * 在电脑上调了字号，两边互不覆盖。
 *
 * 本模块不依赖 React（界面通过 subscribe / getState 订阅），便于单独测试。
 * 离线单文件版没有账号体系，`startSettingsSync` 在那里什么都不做；所有请求都经由
 * `github.ts` 的出口，离线构建里连接口地址都不存在。
 */
import { githubConfig, settingsSyncConfig, STORAGE_KEYS } from './config'
import { getToken, githubGraphql } from './github'
import { hasNetwork, OFFLINE } from './runtime'
import {
  isThemeMode,
  readPersonalSetting,
  readPersonalSettings,
  readSettingTimes,
  readStoredThemeMode,
  THEME_MODE_SETTING,
  writePersonalSetting,
  writeSettingTimes,
  writeThemeMode,
  type SettingChangeDetail,
} from './settingsStore'

/* -------------------------------------------------------------------------- */
/*                                  数据结构                                    */
/* -------------------------------------------------------------------------- */

export interface SyncedEntry {
  value: unknown
  /** 这一项最后一次被修改的时间（毫秒时间戳）；0 表示「不知道」（同步机制上线之前留下的设置） */
  at: number
}

export type SyncedSettings = Record<string, SyncedEntry>

export interface SettingsSnapshot {
  version: number
  updatedAt: number
  settings: SyncedSettings
}

const SNAPSHOT_VERSION = 1
/** 单项设置序列化后的长度上限：正常的偏好只有几百字节，超过这个数的一律不收。 */
const MAX_ENTRY_CHARS = 20_000
/** GitHub 评论正文上限是 65536 个字符，留出说明文字的余量。 */
const MAX_BODY_CHARS = 60_000

/* -------------------------------------------------------------------------- */
/*                         各项设置上传 / 取回时的处理                            */
/* -------------------------------------------------------------------------- */

interface SettingAdapter {
  /** 上传之前：去掉只属于这台设备、或者不该公开的字段 */
  toRemote?: (value: unknown) => unknown
  /** 取回之后：校验并与本机现有的值合并；返回 undefined 表示这个值不可用，忽略它 */
  fromRemote?: (remote: unknown, local: unknown) => unknown
}

/** 不随账号同步、只留在这台设备上的设置（目前没有；新增只属于单台设备的偏好时登记在这里）。 */
const LOCAL_ONLY_SETTINGS = new Set<string>()

/** 这些设置在统一偏好对象出现之前各有自己的存储键，老用户的值可能还只存在那里。 */
const LEGACY_KEYS: Record<string, string> = {
  font: STORAGE_KEYS.font,
  background: STORAGE_KEYS.background,
  repository: STORAGE_KEYS.ghRepo,
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const ADAPTERS: Record<string, SettingAdapter> = {
  [THEME_MODE_SETTING]: {
    fromRemote: (remote) => (isThemeMode(remote) ? remote : undefined),
  },
  colorTheme: {
    fromRemote: (remote) => (typeof remote === 'string' && remote.length <= 60 ? remote : undefined),
  },
  backgroundImage: {
    // 本机图片的文件名可能带有个人信息，而保存位置是公开的：不上传，只同步「用的是本地图片」这件事。
    toRemote: (value) => (isPlainObject(value) ? { ...value, localName: '' } : value),
    fromRemote: (remote, local) => {
      if (!isPlainObject(remote)) return undefined
      const localName = isPlainObject(local) && typeof local.localName === 'string' ? local.localName : ''
      return { ...remote, localName }
    },
  },
  repository: {
    // 目标仓库会被拼进 GitHub 接口路径，只接受合法的用户名 / 仓库名。
    fromRemote: (remote) => {
      if (!isPlainObject(remote)) return undefined
      const { owner, repo } = remote
      if (typeof owner !== 'string' || typeof repo !== 'string') return undefined
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo)) {
        return undefined
      }
      return remote
    },
  },
}

/** 键按字典序排列的 JSON：用于判断两个值是否相同，不受对象键顺序影响。 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function toRemoteValue(name: string, value: unknown): unknown {
  return ADAPTERS[name]?.toRemote ? ADAPTERS[name].toRemote(value) : value
}

function fromRemoteValue(name: string, remote: unknown, local: unknown): unknown {
  if (remote === undefined || remote === null) return undefined
  let serialized: string
  try {
    serialized = JSON.stringify(remote)
  } catch {
    return undefined
  }
  if (typeof serialized !== 'string' || serialized.length > MAX_ENTRY_CHARS) return undefined
  return ADAPTERS[name]?.fromRemote ? ADAPTERS[name].fromRemote(remote, local) : remote
}

/* -------------------------------------------------------------------------- */
/*                              本机设置 ↔ 快照                                  */
/* -------------------------------------------------------------------------- */

/** 这台设备上当前所有要同步的设置，连同各自的最后修改时间。 */
export function collectLocalSettings(): SyncedSettings {
  const times = readSettingTimes()
  const settings: SyncedSettings = {}
  const all = { ...readPersonalSettings() }
  for (const [name, legacyKey] of Object.entries(LEGACY_KEYS)) {
    if (name in all) continue
    const legacy = readPersonalSetting<unknown>(name, legacyKey)
    if (legacy !== null && legacy !== undefined) all[name] = legacy
  }
  for (const [name, value] of Object.entries(all)) {
    if (LOCAL_ONLY_SETTINGS.has(name) || name === THEME_MODE_SETTING) continue
    if (value === undefined || value === null) continue
    settings[name] = { value: toRemoteValue(name, value), at: times[name] ?? 0 }
  }
  // 明暗模式只有读者主动选过才会被保存（见 theme.tsx），没选过就不同步。
  const mode = readStoredThemeMode()
  if (mode) settings[THEME_MODE_SETTING] = { value: mode, at: times[THEME_MODE_SETTING] ?? 0 }
  return settings
}

export interface MergeResult {
  /** 合并后的完整设置：也就是应当保存在账号里的内容 */
  merged: SyncedSettings
  /** 账号里更新、需要套用到这台设备的项 */
  incoming: SyncedSettings
  /** 这台设备更新（或账号里还没有）的项；非空说明需要把合并结果写回账号 */
  outgoing: string[]
}

/**
 * 逐项合并本机与账号里的设置：谁的修改时间晚听谁的；值相同就不动；
 * 时间相同而值不同时以账号为准（否则两台设备会各说各话，永远对不齐）。
 */
export function mergeSettings(local: SyncedSettings, remote: SyncedSettings): MergeResult {
  const merged: SyncedSettings = {}
  const incoming: SyncedSettings = {}
  const outgoing: string[] = []
  for (const name of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const mine = local[name]
    const theirs = remote[name]
    if (mine && !theirs) {
      merged[name] = mine
      outgoing.push(name)
    } else if (theirs && !mine) {
      merged[name] = theirs
      incoming[name] = theirs
    } else if (stableStringify(mine.value) === stableStringify(theirs.value)) {
      merged[name] = theirs
    } else if (mine.at > theirs.at) {
      merged[name] = mine
      outgoing.push(name)
    } else {
      merged[name] = theirs
      incoming[name] = theirs
    }
  }
  return { merged, incoming, outgoing }
}

/** 把账号里更新的设置套用到这台设备；返回实际套用了的设置名。 */
export function applyIncomingSettings(incoming: SyncedSettings): string[] {
  const applied: string[] = []
  const all = readPersonalSettings()
  for (const [name, entry] of Object.entries(incoming)) {
    if (LOCAL_ONLY_SETTINGS.has(name)) continue
    const local = name === THEME_MODE_SETTING ? readStoredThemeMode() : all[name]
    const value = fromRemoteValue(name, entry.value, local)
    if (value === undefined) continue
    if (name === THEME_MODE_SETTING) {
      if (!isThemeMode(value)) continue
      writeThemeMode(value, { source: 'sync', at: entry.at })
    } else {
      writePersonalSetting(name, value, { source: 'sync', at: entry.at })
    }
    applied.push(name)
  }
  return applied
}

/* -------------------------------------------------------------------------- */
/*                               评论正文的格式                                  */
/* -------------------------------------------------------------------------- */

/** 写成拼接形式：离线单文件版会把脚本内联进 HTML，源码里不能出现完整的 HTML 注释起始标记。 */
export const SETTINGS_COMMENT_MARKER = `<${'!--'} starlog-settings:v${SNAPSHOT_VERSION} -->`
export const SETTINGS_DISCUSSION_MARKER = `<${'!--'} starlog-settings-sync -->`

export function serializeSettingsComment(login: string, snapshot: SettingsSnapshot): string {
  const body = [
    SETTINGS_COMMENT_MARKER,
    `这条评论由博客站点自动维护，用来在 @${login} 的多台设备之间同步站点设置（配色、字号、字体、背景等）。`,
    '请不要手动修改。删除它不会影响任何设备上已有的设置，下次修改设置时会重新创建。',
    '',
    '```json',
    JSON.stringify(snapshot, null, 2),
    '```',
  ].join('\n')
  if (body.length > MAX_BODY_CHARS) throw new Error('设置内容过大，无法保存到 GitHub Discussions')
  return body
}

/** 从评论正文里取出设置；不是设置评论、或内容损坏时返回 null。 */
export function parseSettingsComment(body: string): SettingsSnapshot | null {
  if (typeof body !== 'string' || !body.includes(SETTINGS_COMMENT_MARKER)) return null
  const match = body.slice(body.indexOf(SETTINGS_COMMENT_MARKER)).match(/```json\s*\n([\s\S]*?)\n```/)
  if (!match) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(match[1])
  } catch {
    return null
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.settings)) return null
  const settings: SyncedSettings = {}
  for (const [name, entry] of Object.entries(parsed.settings)) {
    if (!isPlainObject(entry) || entry.value === undefined || entry.value === null) continue
    const at = typeof entry.at === 'number' && Number.isFinite(entry.at) && entry.at >= 0 ? entry.at : 0
    settings[name] = { value: entry.value, at }
  }
  return {
    version: typeof parsed.version === 'number' ? parsed.version : SNAPSHOT_VERSION,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    settings,
  }
}

/* -------------------------------------------------------------------------- */
/*                            GitHub Discussions 读写                            */
/* -------------------------------------------------------------------------- */

interface SyncMeta {
  login?: string
  discussionId?: string
  commentId?: string
  commentUrl?: string
  lastSyncedAt?: number
}

function readMeta(): SyncMeta {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.settingsSync) || '{}')
    return isPlainObject(parsed) ? (parsed as SyncMeta) : {}
  } catch {
    return {}
  }
}

function writeMeta(meta: SyncMeta) {
  try {
    localStorage.setItem(STORAGE_KEYS.settingsSync, JSON.stringify(meta))
  } catch {
    // 记不住评论编号只是下次要多查一遍，不影响同步本身。
  }
}

function isMissingNodeError(error: unknown): boolean {
  return error instanceof Error && /could not resolve to a node/i.test(error.message)
}

interface CommentNode {
  id: string
  url: string
  body: string
  viewerDidAuthor: boolean
}

interface RemoteState {
  discussionId: string | null
  commentId: string | null
  commentUrl: string | null
  snapshot: SettingsSnapshot | null
  /** 这一轮已经查过讨论时留下结果：需要新建讨论 / 评论时不必再查一遍 */
  lookup?: DiscussionLookup
}

/** 按记住的评论编号直接读取；评论已被删除、或不是本人的评论时返回 null。 */
async function fetchCommentById(commentId: string): Promise<CommentNode | null> {
  try {
    const data = await githubGraphql<{ node: Partial<CommentNode> | null }>(
      `query SettingsComment($id: ID!) {
        node(id: $id) {
          ... on DiscussionComment { id url body viewerDidAuthor }
        }
      }`,
      { id: commentId },
    )
    const node = data.node
    if (!node || !node.id || typeof node.body !== 'string' || !node.viewerDidAuthor) return null
    return { id: node.id, url: node.url ?? '', body: node.body, viewerDidAuthor: true }
  } catch (error) {
    if (isMissingNodeError(error)) return null
    throw error
  }
}

interface DiscussionLookup {
  repositoryId: string
  categoryId: string | null
  discussionId: string | null
}

/** 在站点仓库里找「设置同步」讨论（最早创建的那一个），同时带回新建讨论需要的仓库与分类编号。 */
async function findSettingsDiscussion(): Promise<DiscussionLookup> {
  let after: string | null = null
  let repositoryId = ''
  let categoryId: string | null = null
  for (let page = 0; page < 10; page++) {
    const data: {
      repository: {
        id: string
        hasDiscussionsEnabled: boolean
        discussionCategories: { nodes: { id: string; name: string; slug: string }[] }
        discussions: {
          nodes: { id: string; title: string; body: string }[]
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
        }
      } | null
    } = await githubGraphql(
      `query SettingsDiscussion($owner: String!, $name: String!, $after: String) {
        repository(owner: $owner, name: $name) {
          id
          hasDiscussionsEnabled
          discussionCategories(first: 50) { nodes { id name slug } }
          discussions(first: 100, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
            nodes { id title body }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { owner: githubConfig.owner, name: githubConfig.repo, after },
    )
    const repository = data.repository
    if (!repository) throw new Error('找不到站点仓库，无法同步设置')
    if (!repository.hasDiscussionsEnabled) {
      throw new Error('站点仓库尚未开启 GitHub Discussions，无法把设置保存到账号')
    }
    repositoryId = repository.id
    const wanted = settingsSyncConfig.category.trim().toLowerCase()
    const categories = repository.discussionCategories.nodes
    categoryId =
      (categories.find((item) => item.name.trim().toLowerCase() === wanted || item.slug.toLowerCase() === wanted) ??
        categories[0])?.id ?? null
    const match = repository.discussions.nodes.find(
      (item) => item.body.includes(SETTINGS_DISCUSSION_MARKER) || item.title.trim() === settingsSyncConfig.title,
    )
    if (match) return { repositoryId, categoryId, discussionId: match.id }
    const { hasNextPage, endCursor } = repository.discussions.pageInfo
    if (!hasNextPage || !endCursor) break
    after = endCursor
  }
  return { repositoryId, categoryId, discussionId: null }
}

async function createSettingsDiscussion(lookup: DiscussionLookup): Promise<string> {
  if (!lookup.categoryId) throw new Error('站点仓库的 Discussions 没有可用的分类，无法创建「设置同步」讨论')
  try {
    const data = await githubGraphql<{ createDiscussion: { discussion: { id: string } | null } }>(
      `mutation CreateSettingsDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
          discussion { id }
        }
      }`,
      {
        repositoryId: lookup.repositoryId,
        categoryId: lookup.categoryId,
        title: settingsSyncConfig.title,
        body: [
          '这个讨论由博客站点自动使用：登录用户的站点设置（配色、字号、字体、背景等）保存在各自的一条评论里，',
          '用来在同一账号的多台设备之间同步。请不要在这里手动回复。',
          '',
          SETTINGS_DISCUSSION_MARKER,
        ].join('\n'),
      },
    )
    const id = data.createDiscussion.discussion?.id
    if (!id) throw new Error('GitHub 没有返回新建的讨论')
    return id
  } catch (error) {
    const reason = error instanceof Error ? error.message : '未知错误'
    throw new Error(
      `无法创建「${settingsSyncConfig.title}」讨论（${reason}）。` +
        `可以请仓库管理员在 Discussions 的「${settingsSyncConfig.category}」分类里新建一个标题为「${settingsSyncConfig.title}」的讨论`,
    )
  }
}

/** 在讨论里找当前登录者自己的设置评论（最早的一条）。 */
async function findOwnComment(discussionId: string): Promise<CommentNode | null> {
  let after: string | null = null
  for (let page = 0; page < 30; page++) {
    const data: {
      node: {
        comments?: {
          nodes: CommentNode[]
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
        }
      } | null
    } = await githubGraphql(
      `query SettingsComments($id: ID!, $after: String) {
        node(id: $id) {
          ... on Discussion {
            comments(first: 100, after: $after) {
              nodes { id url body viewerDidAuthor }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`,
      { id: discussionId, after },
    )
    const comments = data.node?.comments
    if (!comments) return null
    const own = comments.nodes.find((item) => item.viewerDidAuthor && item.body.includes(SETTINGS_COMMENT_MARKER))
    if (own) return own
    if (!comments.pageInfo.hasNextPage || !comments.pageInfo.endCursor) return null
    after = comments.pageInfo.endCursor
  }
  return null
}

/** 找到账号里保存的设置：优先用上次记住的评论编号（一次请求），找不到再去讨论里翻。 */
async function readRemote(meta: SyncMeta): Promise<RemoteState> {
  if (meta.commentId) {
    const comment = await fetchCommentById(meta.commentId)
    if (comment) {
      return {
        discussionId: meta.discussionId ?? null,
        commentId: comment.id,
        commentUrl: comment.url || null,
        snapshot: parseSettingsComment(comment.body),
      }
    }
  }
  const lookup = await findSettingsDiscussion()
  const { discussionId } = lookup
  if (!discussionId) return { discussionId: null, commentId: null, commentUrl: null, snapshot: null, lookup }
  const comment = await findOwnComment(discussionId)
  return {
    discussionId,
    commentId: comment?.id ?? null,
    commentUrl: comment?.url || null,
    snapshot: comment ? parseSettingsComment(comment.body) : null,
    lookup,
  }
}

interface WrittenComment {
  discussionId: string | null
  commentId: string
  commentUrl: string | null
}

async function updateComment(commentId: string, body: string): Promise<{ id: string; url: string }> {
  const data = await githubGraphql<{ updateDiscussionComment: { comment: { id: string; url: string } | null } }>(
    `mutation UpdateSettingsComment($commentId: ID!, $body: String!) {
      updateDiscussionComment(input: { commentId: $commentId, body: $body }) {
        comment { id url }
      }
    }`,
    { commentId, body },
  )
  const comment = data.updateDiscussionComment.comment
  if (!comment) throw new Error('GitHub 没有返回更新后的设置评论')
  return comment
}

/** 把设置写回账号：已有评论就更新，没有就新建（讨论也不存在时一并创建）。 */
async function writeRemote(login: string, remote: RemoteState, snapshot: SettingsSnapshot): Promise<WrittenComment> {
  const body = serializeSettingsComment(login, snapshot)
  if (remote.commentId) {
    const comment = await updateComment(remote.commentId, body)
    return { discussionId: remote.discussionId, commentId: comment.id, commentUrl: comment.url || null }
  }

  let discussionId = remote.discussionId
  if (!discussionId) {
    const lookup = remote.lookup ?? (await findSettingsDiscussion())
    discussionId = lookup.discussionId ?? (await createSettingsDiscussion(lookup))
  }
  const data = await githubGraphql<{ addDiscussionComment: { comment: { id: string; url: string } | null } }>(
    `mutation AddSettingsComment($discussionId: ID!, $body: String!) {
      addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
        comment { id url }
      }
    }`,
    { discussionId, body },
  )
  const created = data.addDiscussionComment.comment
  if (!created) throw new Error('GitHub 没有返回新建的设置评论')

  // 两台设备同时第一次保存时，各自都会「没找到评论 → 新建一条」。新建之后再看一眼：
  // 如果讨论里已经有一条更早的本人评论，就把内容合并进那一条并删掉刚建的，
  // 保证每个账号始终只认同一条评论（否则两台设备会各用各的，再也同步不到一起）。
  const canonical = await findOwnComment(discussionId)
  if (canonical && canonical.id !== created.id) {
    const earlier = parseSettingsComment(canonical.body)?.settings ?? {}
    const { merged } = mergeSettings(snapshot.settings, earlier)
    const kept = await updateComment(canonical.id, serializeSettingsComment(login, { ...snapshot, settings: merged }))
    try {
      await githubGraphql(
        `mutation DeleteSettingsComment($id: ID!) {
          deleteDiscussionComment(input: { id: $id }) { comment { id } }
        }`,
        { id: created.id },
      )
    } catch {
      // 删不掉多出来的那条不影响同步：以后一律使用最早的那条。
    }
    // 那条更早的评论里可能有另一台设备的改动：本轮结束后紧接着再同步一轮，把它们取回来。
    rerun = true
    return { discussionId, commentId: kept.id, commentUrl: kept.url || null }
  }
  return { discussionId, commentId: created.id, commentUrl: created.url || null }
}

/* -------------------------------------------------------------------------- */
/*                               同步状态与调度                                  */
/* -------------------------------------------------------------------------- */

export type SettingsSyncStatus = 'disabled' | 'idle' | 'syncing' | 'synced' | 'error'

export interface SettingsSyncState {
  status: SettingsSyncStatus
  /** 正在同步到哪个账号；未登录时为 null */
  login: string | null
  /** 这台设备上有改动还没保存到账号 */
  pending: boolean
  lastSyncedAt: number | null
  error: string | null
  /** 账号里那条设置评论的地址 */
  commentUrl: string | null
}

const DISABLED_STATE: SettingsSyncState = {
  status: 'disabled',
  login: null,
  pending: false,
  lastSyncedAt: null,
  error: null,
  commentUrl: null,
}

/** 改完设置后等这么久再保存：拖动滑块时会连续触发几十次修改，只需要保存最后的结果。 */
const PUSH_DEBOUNCE_MS = 1500
/** 回到页面时，如果距离上次同步超过这个时间，就再取一次账号里的设置（别的设备可能改过）。 */
const REFRESH_INTERVAL_MS = 60_000
const RETRY_BASE_MS = 30_000
const RETRY_MAX_MS = 10 * 60_000

let state: SettingsSyncState = DISABLED_STATE
const listeners = new Set<() => void>()
let activeLogin: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let running: Promise<void> | null = null
let rerun = false
/** 这台设备上有改动还没保存到账号（一轮同步开始读取本机设置时清零） */
let dirty = false
let lastRunAt = 0
let failures = 0

function setState(patch: Partial<SettingsSyncState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function getSettingsSyncState(): SettingsSyncState {
  return state
}

export function subscribeSettingsSync(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function schedule(delay: number) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void syncSettingsNow()
  }, delay)
}

function onLocalChange(event: Event) {
  const detail = (event as CustomEvent<SettingChangeDetail | undefined>).detail
  // 同步自己套用的值不算本机改动，否则每次取回设置都会立刻再推一遍。
  if (!detail || detail.source === 'sync' || LOCAL_ONLY_SETTINGS.has(detail.name)) return
  dirty = true
  setState({ pending: true })
  schedule(PUSH_DEBOUNCE_MS)
}

function onVisibilityChange() {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
  if (Date.now() - lastRunAt >= REFRESH_INTERVAL_MS) schedule(0)
}

function onOnline() {
  schedule(0)
}

/** 同一时刻只让一个标签页读写账号里的设置，避免两个标签页各自「读—改—写」互相覆盖。 */
async function withCrossTabLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { locks?: { request: (name: string, cb: () => Promise<T>) => Promise<T> } }).locks
    : undefined
  if (locks?.request) return locks.request('starlog-settings-sync', run)
  return run()
}

async function runOnce(login: string): Promise<void> {
  if (!getToken() || !hasNetwork()) {
    // 没有网络：改动留在本机，联网（online 事件）或下次打开页面时再保存。
    if (activeLogin === login && state.status === 'syncing') setState({ status: 'idle' })
    return
  }
  setState({ status: 'syncing', error: null })
  lastRunAt = Date.now()
  try {
    const result = await withCrossTabLock(async () => {
      let meta = readMeta()
      if (meta.login && meta.login !== login) {
        // 这台设备上次同步的是另一个账号：现有设置不是这个账号改出来的，
        // 不能凭它们的修改时间盖过新账号里已有的设置——全部当作「时间未知」，只补上账号里没有的项。
        writeSettingTimes({})
        meta = { login }
        // 立刻记下「已经换成这个账号」：即使这一轮随后失败，重试时也不会把期间新做的修改再清一遍时间。
        writeMeta(meta)
      }
      const remote = await readRemote(meta)
      // 从这里开始读取本机设置：之后再发生的改动留给下一轮。
      dirty = false
      const local = collectLocalSettings()
      const { merged, incoming, outgoing } = mergeSettings(local, remote.snapshot?.settings ?? {})
      applyIncomingSettings(incoming)
      let { discussionId, commentId, commentUrl } = remote
      if (outgoing.length > 0) {
        ;({ discussionId, commentId, commentUrl } = await writeRemote(login, remote, {
          version: SNAPSHOT_VERSION,
          updatedAt: Date.now(),
          settings: merged,
        }))
      }
      const syncedAt = Date.now()
      writeMeta({
        login,
        discussionId: discussionId ?? undefined,
        commentId: commentId ?? undefined,
        commentUrl: commentUrl ?? undefined,
        lastSyncedAt: syncedAt,
      })
      return { syncedAt, commentUrl }
    })
    failures = 0
    if (activeLogin === login) {
      setState({ status: 'synced', pending: dirty, lastSyncedAt: result.syncedAt, commentUrl: result.commentUrl, error: null })
    }
  } catch (error) {
    failures += 1
    if (activeLogin === login) {
      setState({ status: 'error', pending: dirty, error: error instanceof Error ? error.message : '同步设置失败' })
      // 失败后自动重试，间隔逐次加倍；期间读者再改设置或手动点「立即同步」会立刻再试。
      schedule(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1)))
    }
  }
}

/** 立即同步一次（取回账号里的设置并保存本机的改动）。正在同步时会在结束后再跑一轮。 */
export function syncSettingsNow(): Promise<void> {
  const login = activeLogin
  if (!login) return Promise.resolve()
  if (running) {
    rerun = true
    return running
  }
  running = (async () => {
    do {
      rerun = false
      await runOnce(login)
    } while (rerun && activeLogin === login)
  })().finally(() => {
    running = null
  })
  return running
}

/** 登录后调用：开始把这台设备的设置与该账号同步。重复以同一账号调用没有副作用。 */
export function startSettingsSync(login: string): void {
  if (OFFLINE || typeof window === 'undefined' || !login) return
  if (activeLogin === login) return
  stopSettingsSync()
  activeLogin = login
  failures = 0
  dirty = false
  const meta = readMeta()
  const sameAccount = meta.login === login
  setState({
    status: 'idle',
    login,
    pending: false,
    lastSyncedAt: sameAccount ? (meta.lastSyncedAt ?? null) : null,
    error: null,
    commentUrl: sameAccount ? (meta.commentUrl ?? null) : null,
  })
  try {
    // 旧版把账号偏好缓存在这两个键里（当时偏好保存在仓库文件中），已不再使用。
    localStorage.removeItem('starlog:font-accounts')
    localStorage.removeItem('starlog:background-accounts')
  } catch {
    // 清理失败无妨
  }
  window.addEventListener('starlog:settings-changed', onLocalChange)
  window.addEventListener('online', onOnline)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
  void syncSettingsNow()
}

/** 退出登录时调用：停止同步。这台设备上的设置原样保留。 */
export function stopSettingsSync(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('starlog:settings-changed', onLocalChange)
    window.removeEventListener('online', onOnline)
  }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
  activeLogin = null
  rerun = false
  if (state !== DISABLED_STATE) {
    state = DISABLED_STATE
    for (const listener of listeners) listener()
  }
}

import { STORAGE_KEYS } from '../src/lib/config'
import { OFFLINE } from '../src/lib/runtime'
import {
  getRepoTarget,
  setRepoTarget,
  getToken,
  setToken,
  verifyToken,
  requestDeviceCode,
  pollDeviceToken,
  checkUserRepoPermissions,
  loadBlogDiscussionComments,
  createBlogDiscussion,
  addBlogDiscussionComment,
  deleteBlogDiscussionComment,
} from '../src/lib/github'
import {
  getLocalPosts,
  saveLocalPost,
  deleteLocalPost,
  serializePost,
  slugify,
  today,
} from '../src/lib/posts'
import { toArticle, publishedSource } from './content.js'

export { getRepoTarget, setRepoTarget }
export const beginLogin = requestDeviceCode
export function currentAccount() {
  try {
    const session = JSON.parse(localStorage.getItem(STORAGE_KEYS.session))
    return session?.mode === 'github' &&
      Date.now() - session.at < 604800000 &&
      getToken()
      ? JSON.parse(localStorage.getItem(STORAGE_KEYS.ghUser))
      : null
  } catch {
    return null
  }
}
export async function loginWithToken(value) {
  const token = String(value || '').trim()
  if (!token) throw new Error('请输入 GitHub 令牌。')
  const user = await verifyToken(token)
  setToken(token)
  localStorage.setItem(STORAGE_KEYS.ghUser, JSON.stringify(user))
  localStorage.setItem(
    STORAGE_KEYS.session,
    JSON.stringify({ mode: 'github', at: Date.now(), user }),
  )
  window.dispatchEvent(new Event('cosmic:account-changed'))
  return user
}
export async function finishLogin(info, signal) {
  if (OFFLINE) throw new Error('离线版使用本机文章库。')
  const token = await pollDeviceToken(info, signal)
  if (signal?.aborted) throw new Error('授权已取消。')
  return loginWithToken(token)
}
export function logout() {
  setToken(null)
  localStorage.removeItem(STORAGE_KEYS.session)
  localStorage.removeItem(STORAGE_KEYS.ghUser)
  window.dispatchEvent(new Event('cosmic:account-changed'))
}
function requireUser() {
  const user = currentAccount()
  if (!user) throw new Error('请先登录 GitHub。')
  return user
}
export async function getPermissions() {
  const user = currentAccount()
  return user
    ? checkUserRepoPermissions(user.login)
    : { canPush: false, canAdmin: false }
}
export function getDrafts() {
  return getLocalPosts()
    .map(toArticle)
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
}
export function saveDraft(input) {
  const title = String(input.title || '').trim()
  if (!title) throw new Error('请填写文章标题。')
  const local = getLocalPosts()
  let id = input.id || slugify(title)
  if (!input.id) {
    const stem = id
    for (
      let i = 2;
      id === 'about' || publishedSource(id) || local.some((p) => p.slug === id);
      i++
    )
      id = stem + '-' + i
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(id) || id === 'about')
    throw new Error('文章标识无效。')
  const prior = local.find((p) => p.slug === id)
  const seed = publishedSource(id)
  if (prior?.encryption)
    throw new Error('请先解锁并导出此加密文件，再创建编辑副本。')
  const tags = input.tags ?? prior?.tags ?? seed?.tags ?? []
  const source = {
    ...(seed || {}),
    ...(prior || {}),
    slug: id,
    title,
    draft: true,
    source: 'local',
    date:
      input.date ||
      prior?.date ||
      (seed?.encryption ? null : seed?.date) ||
      today(),
    updated: today(),
    content: String(input.content ?? ''),
    tags: (Array.isArray(tags) ? tags : String(tags).split(/[,，]/))
      .map((t) => String(t).trim())
      .filter(Boolean),
    author:
      input.author || prior?.author || seed?.author || currentAccount()?.login,
    summary:
      input.summary ??
      prior?.summary ??
      (seed?.encryption ? '' : seed?.summary) ??
      '',
    encryptIntent: Boolean(
      seed?.encryption || prior?.encryptIntent || input.encryptIntent,
    ),
  }
  return toArticle(saveLocalPost(source))
}
export function removeDraft(id) {
  deleteLocalPost(id)
}
function storedDraft(id) {
  const draft = getLocalPosts().find((p) => p.slug === id)
  if (!draft) throw new Error('这份本地草稿不存在。请先保存文章。')
  if (!draft.title.trim() || !draft.content.trim())
    throw new Error('请先填写文章标题和正文。')
  return draft
}
export function exportDraft(id) {
  const draft = storedDraft(id)
  if (draft.encryption) {
    const raw = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.drafts) || '[]',
    ).find((p) => p.slug === id)?.raw
    if (!raw) throw new Error('找不到加密原文。')
    return { name: id + '.md', text: raw }
  }
  return { name: id + '.md', text: serializePost(draft) }
}
// The editor stages a reviewable copy. The only repository write is the
// manager's explicit flush of the selected queue entries.
export async function queueDraft(id, { mode, password } = {}) {
  requireUser()
  if (!['direct', 'pr'].includes(mode))
    throw new Error('请选择直接发布或提交投稿。')
  const snapshot = storedDraft(id)
  const seed = publishedSource(id)
  if (
    (seed?.encryption || snapshot.encryptIntent) &&
    !password &&
    !snapshot.encryption
  )
    throw new Error('这篇文章必须重新加密。请提供发布密码。')
  const post = { ...snapshot, draft: false, updated: today() }
  const text = snapshot.encryption
    ? exportDraft(id).text
    : password
      ? await (
          await import('../src/lib/crypto')
        ).encryptPostMarkdown(post, password)
      : serializePost(post)
  const filename = seed?.path?.split('/').pop()?.replace(/\.md$/i, '') || id
  if (mode === 'direct' && !(await getPermissions()).canPush)
    throw new Error('当前账号没有仓库写入权限，请使用投稿。')
  const q = await import('../src/lib/updateQueue')
  return (mode === 'pr' ? q.enqueuePostPr : q.enqueuePostPublish)(
    { slug: filename, title: post.title },
    text,
  )
}
export async function queueDelete(id) {
  requireUser()
  if (!(await getPermissions()).canPush)
    throw new Error('当前账号没有仓库写入权限。')
  const post = publishedSource(id)
  if (!post) throw new Error('未找到仓库文章。')
  const { enqueuePostDelete } = await import('../src/lib/updateQueue')
  return enqueuePostDelete(
    post.path.split('/').pop().replace(/\.md$/i, ''),
    post.title,
  )
}
export async function getComments(id) {
  requireUser()
  return loadBlogDiscussionComments(id)
}
export async function sendComment(article, body) {
  requireUser()
  if (!body.trim()) throw new Error('请先填写评论。')
  const existing = await loadBlogDiscussionComments(article.id)
  const thread =
    existing.discussion ||
    (await createBlogDiscussion(
      existing.repositoryId,
      existing.categoryId,
      article.id,
      article.title,
    ))
  await addBlogDiscussionComment(thread.id, body.trim())
}
export async function removeComment(id) {
  requireUser()
  return deleteBlogDiscussionComment(id)
}

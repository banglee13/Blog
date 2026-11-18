import aboutSource from '../content/about.md?raw'
import {
  buildPost,
  getRepoPosts,
  getLocalPosts,
  hasPublicDate,
} from '../src/lib/posts'
import { siteConfig } from '../src/lib/config'
import { OFFLINE } from '../src/lib/runtime'
import { initOfflineStorage } from '../src/lib/offlineStorage'

const chosenNames = {
  'katex-cheatsheet': 'KaTeX 公式速查',
  'typescript-utility-types': 'TypeScript 工具类型',
  'hello-starlog': '你好，Starlog',
  'oi-dp-skill-1': 'DP 优化和技巧',
  'smsky-2026冬令营-problem-set': '冬令营题目整理',
}

// Repository Markdown is immutable until the next build. Parsing it once keeps
// storage events, opening panels and typing in search off the expensive path.
let seeds = getRepoPosts()
export function toArticle(post) {
  const encrypted = Boolean(post.encryption)
  const date = hasPublicDate(post) ? post.date : ''
  const content = encrypted ? '' : post.content
  return {
    id: post.slug,
    slug: post.slug,
    title: post.title,
    starName: chosenNames[post.slug] || post.title,
    date,
    createdAt: date,
    updated: post.updated || '',
    tags: post.tags,
    category: post.tags[0] || '',
    summary: post.summary,
    excerpt: post.summary,
    author: post.author || siteConfig.author.name,
    encrypted,
    draft: post.draft,
    pinned: Boolean(post.pinned),
    source: post.source,
    path: post.path,
    wordCount: encrypted ? 0 : post.wordCount,
    readingTime: encrypted ? 0 : post.readingTime,
    content,
    bodyMarkdown: content,
    savedAt: post.savedAt,
  }
}

const helpPost = buildPost(aboutSource, {
  slug: 'about',
  source: 'repo',
  path: 'content/about.md',
})
export const about = {
  ...toArticle(helpPost),
  date: '',
  createdAt: '',
  updated: '',
}
export let articles = []
let sources
function refresh() {
  if (OFFLINE) seeds = getRepoPosts()
  sources = new Map(seeds.filter((p) => !p.draft).map((p) => [p.slug, p]))
  for (const post of getLocalPosts()) {
    if (post.draft || (sources.get(post.slug)?.encryption && !post.encryption))
      continue
    sources.set(post.slug, post)
  }
  articles = [...sources.values()]
    .map(toArticle)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.date.localeCompare(a.date) ||
        a.title.localeCompare(b.title, 'zh-CN'),
    )
}
refresh()
if (typeof window !== 'undefined') {
  window.addEventListener('starlog:posts-changed', refresh)
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === 'starlog:drafts')
      window.dispatchEvent(new Event('starlog:posts-changed'))
  })
}
export function getArticles() {
  return articles
}
export async function loadOfflineLibrary() {
  await initOfflineStorage()
  refresh()
}
export function searchArticles(query = '') {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return articles
  return articles.filter((p) => {
    const text = [p.title, p.summary, p.tags.join(' '), p.content]
      .join('\n')
      .toLocaleLowerCase()
    return terms.every((term) => text.includes(term))
  })
}
export async function loadArticle(id) {
  if (id === 'about') return about
  const source = sources.get(id)
  if (!source) return null
  if (source.encryption) {
    const { restorePostUnlock } = await import('../src/lib/crypto')
    const unlocked = await restorePostUnlock(source)
    if (unlocked) return toArticle(unlocked)
  }
  return toArticle(source)
}
export async function unlockArticle(id, password) {
  const source = sources.get(id)
  if (!source) throw new Error('未找到这篇文章。')
  const { decryptPost } = await import('../src/lib/crypto')
  return toArticle(await decryptPost(source, password))
}

export function publishedSource(id) {
  return seeds.find((p) => p.slug === id && !p.draft)
}

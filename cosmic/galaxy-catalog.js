// An article keeps its coordinates when its title, date, or neighbours change.
// Hash the URL slug independently for each of the three spatial dimensions.
function sample(slug, seed) {
  let hash = seed
  for (let i = 0; i < slug.length; i++) {
    hash = Math.imul(hash ^ slug.charCodeAt(i), 16777619)
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d)
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b)
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296
}

/** Galaxy-local XYZ coordinates. The central nucleus is reserved for navigation. */
export function articlePosition(slug) {
  const key = String(slug).normalize('NFC')
  const angle = 2 * Math.PI * sample(key, 0x811c9dc5)
  // Uniform area density across the readable portion of the stellar disc.
  const radius = Math.sqrt(0.14 + 0.68 * sample(key, 0xa54ff53a))
  const height = (sample(key, 0x3c6ef372) - 0.5) * 0.13
  return [radius * Math.cos(angle), radius * Math.sin(angle), height]
}

function timestamp(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : -Infinity
}

/** Original array indices in label priority order. Slug breaks same-day ties. */
export function getLabelOrder(articles) {
  const entries = articles.map((article, index) => ({
    index,
    slug: String(article.slug ?? article.id),
    published: timestamp(article.publishedAt ?? article.date),
    saved: timestamp(article.savedAt),
  }))
  entries.sort(
    (a, b) =>
      b.published - a.published ||
      b.saved - a.saved ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  )
  return entries.map((entry) => entry.index)
}

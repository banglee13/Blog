/** 下载固定正式服目录；不使用 version.json 的测试服 latest。Node.js >= 20。 */
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const versionIndex = process.argv.indexOf('--version')
const version = versionIndex < 0 ? '7.2.0' : process.argv[versionIndex + 1]
if (!/^\d+\.\d+\.0$/.test(version ?? '')) throw new Error('仅接受正式服版本号，例如 --version 7.2.0')
const base = 'https://api.lunaris.moe'
const directory = join(root, 'src/data/genshin')
async function get(path, image = false) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(base + path, { signal: AbortSignal.timeout(25000) })
      if (response.status === 404) return null
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + path)
      return image ? Buffer.from(await response.arrayBuffer()) : await response.json()
    } catch (error) { if (attempt >= 2) throw error }
  }
}
async function mapLimit(values, work) {
  let next = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < values.length) { const value = values[next++]; await work(value) }
  }))
}
const retrievedAt = new Date().toISOString()
const characters = await get('/data/' + version + '/charlist.json')
const weapons = await get('/data/' + version + '/weaponlist.json')
if (!characters || !weapons) throw new Error('该正式服目录不存在')
const records = { characters: {}, weapons: {} }
const missing = []
const jobs = Object.entries({ characters, weapons }).flatMap(([kind, list]) => Object.keys(list).map(id => ({ kind, id })))
await mapLimit(jobs, async ({ kind, id }) => {
  const type = kind === 'characters' ? 'char' : 'weapon'
  const data = await get('/data/' + version + '/chs/' + type + '/' + id + '.json')
  if (data) records[kind][id] = data
  else missing.push({ kind, id, status: 404, reason: '版本清单存在，但源站未提供详情文件' })
})
const imageKeys = new Set()
for (const data of Object.values(records.characters)) {
  if (data.icons?.forward) imageKeys.add('avataricon/' + data.icons.forward)
  for (const group of [data.skills, data.passives, data.constellations]) for (const skill of Object.values(group ?? {})) if (skill?.icon) imageKeys.add('skills/' + skill.icon)
}
for (const data of Object.values(records.weapons)) if (data.weaponIcon) imageKeys.add('weaponicon/' + data.weaponIcon)
const portraits = {}, skillIcons = {}
let imageBytes = 0
await mapLimit([...imageKeys], async key => {
  const bytes = await get('/data/assets/' + key + '.webp', true)
  if (!bytes) throw new Error('图标不存在：' + key)
  imageBytes += bytes.length
  const target = key.startsWith('skills/') ? skillIcons : portraits
  target[key] = 'data:image/webp;base64,' + bytes.toString('base64')
})
const rarity = { QUALITY_PURPLE: 4, QUALITY_ORANGE: 5, QUALITY_ORANGE_SP: 5 }
const catalog = [
  ...Object.entries(characters).map(([id, item]) => ({ id, kind: 'characters', name: item.chsName, enName: item.enName, element: item.element, weaponType: item.weaponType, rarity: rarity[item.qualityType] ?? 0, qualityType: item.qualityType, icon: records.characters[id]?.icons?.forward ? 'avataricon/' + records.characters[id].icons.forward : null, available: !!records.characters[id], special: item.element === 'Unknown' || id.includes('_'), gender: id.startsWith('10000005_') ? '空' : id.startsWith('10000007_') ? '荧' : null })),
  ...Object.entries(weapons).map(([id, item]) => ({ id, kind: 'weapons', name: item.chsName, enName: item.enName, weaponType: item.weaponType, rarity: Number(id[2]), qualityType: item.qualityType, icon: 'weaponicon/' + item.weaponIcon, available: !!records.weapons[id], special: false })),
]
// 完成所有网络请求后再写入，避免网络中断时覆盖现有快照。
await mkdir(directory, { recursive: true })
const files = { 'characters.json': records.characters, 'weapons.json': records.weapons, 'catalog.json': catalog, 'source-lists.json': { characters, weapons }, 'portraits.json': portraits, 'skill-icons.json': skillIcons }
const sha256 = {}
for (const [name, value] of Object.entries(files)) {
  const content = JSON.stringify(value)
  await writeFile(join(directory, name), content)
  sha256[name] = createHash('sha256').update(content).digest('hex')
}
for (const kind of ['characters', 'weapons']) {
  const name = kind + '.gz.base64'
  const content = gzipSync(Buffer.from(JSON.stringify(records[kind])), { level: 9 }).toString('base64')
  await writeFile(join(directory, name), content)
  sha256[name] = createHash('sha256').update(content).digest('hex')
}
const manifest = { schemaVersion: 1, version, language: 'chs', retrievedAt, source: base, characters: { listed: Object.keys(characters).length, downloaded: Object.keys(records.characters).length }, weapons: { listed: Object.keys(weapons).length, downloaded: Object.keys(records.weapons).length }, images: { downloaded: imageKeys.size, bytes: imageBytes }, missing, sha256 }
await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ version, characters: manifest.characters, weapons: manifest.weapons, images: manifest.images, missing }, null, 2))

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
const dir = new URL('../src/data/genshin/', import.meta.url)
const read = async name => JSON.parse(await readFile(new URL(name, dir), 'utf8'))
const [manifest, catalog, lists, characters, weapons, portraits, skills] = await Promise.all(['manifest.json', 'catalog.json', 'source-lists.json', 'characters.json', 'weapons.json', 'portraits.json', 'skill-icons.json'].map(read))
assert.equal(manifest.version, '7.2.0', '必须固定至 7.2 正式服，不能读取测试服 latest')
for (const [file, hash] of Object.entries(manifest.sha256)) assert.equal(createHash('sha256').update(await readFile(new URL(file, dir))).digest('hex'), hash, file + ' 内容与采集指纹不一致')
for (const [kind, data] of Object.entries({ characters, weapons })) {
  assert.equal(Object.keys(lists[kind]).length, manifest[kind].listed)
  assert.equal(Object.keys(data).length, manifest[kind].downloaded)
  assert.equal(catalog.filter(item => item.kind === kind).length, manifest[kind].listed)
  for (const [id, item] of Object.entries(lists[kind])) {
    const entry = catalog.find(row => row.kind === kind && row.id === id)
    assert.ok(entry, '索引缺少 ' + id)
    assert.equal(entry.name, item.chsName)
    if (!data[id]) {
      assert.equal(entry.available, false)
      assert.ok(manifest.missing.some(row => row.kind === kind && row.id === id && row.status === 404), '未记录的缺失详情 ' + id)
      continue
    }
    assert.equal(entry.available, true)
    assert.equal(kind === 'characters' ? data[id].info.name : data[id].name, item.chsName)
    if (entry.icon) assert.ok(portraits[entry.icon], '缺少本地图标 ' + entry.icon)
    if (kind === 'weapons') assert.equal(entry.rarity, Number(id[2]), '武器星级应读取 ID 第三位')
    if (kind === 'characters') for (const group of [data[id].skills, data[id].passives, data[id].constellations]) for (const skill of Object.values(group ?? {})) if (skill?.icon) assert.ok(skills['skills/' + skill.icon], '缺少技能图标 ' + skill.icon)
  }
}
for (const kind of ['characters', 'weapons']) {
  const packed = Buffer.from(await readFile(new URL(kind + '.gz.base64', dir), 'utf8'), 'base64')
  assert.equal(gunzipSync(packed).toString('utf8'), await readFile(new URL(kind + '.json', dir), 'utf8'), '压缩快照必须无损保留全部字段')
}
assert.equal(Object.keys(characters).length, 138)
assert.equal(Object.keys(weapons).length, 257)
assert.equal(manifest.missing.length, 1)
assert.equal(manifest.missing[0].id, '10000134')
assert.equal(characters['10000002'].info.name, '神里绫华')
assert.equal(weapons['11509'].passive.refinements['1'].params[0], 0.119999997317791)
assert.equal(catalog.find(item => item.id === '11201').rarity, 2)
assert.ok(characters['10000005_ANEMO'] && characters['10000007_ANEMO'], '旅行者性别和元素变体必须保留')
const images = { ...portraits, ...skills }
assert.equal(Object.keys(images).length, manifest.images.downloaded)
for (const [key, value] of Object.entries(images)) {
  assert.ok(value.startsWith('data:image/webp;base64,'), key)
  const bytes = Buffer.from(value.split(',')[1], 'base64')
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF', key)
  assert.equal(bytes.subarray(8, 12).toString(), 'WEBP', key)
}
console.log('原神数据校验通过：7.2.0，138 份角色详情、257 份武器详情、' + Object.keys(images).length + ' 个本地图标；1 条源站 404 已记录。')

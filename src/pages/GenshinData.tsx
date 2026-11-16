import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Search, Sparkles } from 'lucide-react'
import { catalog, cleanGameText, downloadGenshinJSON, elements, entryName, genshinImage, genshinManifest, label, loadGenshinDetail, loadGenshinImages, weaponTypes } from '../lib/genshin'
import type { CatalogEntry, DataObject, DataValue, GenshinKind } from '../lib/genshin'
import '../styles/genshin.css'

function isObject(value: DataValue): value is DataObject { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function text(value: DataValue): string {
  if (value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return cleanGameText(typeof value === 'string' ? label(value) : String(value))
}
function itemTitle(value: DataValue, fallback: string): string {
  if (isObject(value)) for (const key of ['name', 'storyTitle', 'quoteTitle']) if (typeof value[key] === 'string') return cleanGameText(value[key])
  return label(fallback)
}
function DataTable({ rows }: { rows: DataObject[] }) {
  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))))
  return <div className="gi-table-wrap"><table className="gi-table"><thead><tr>{columns.map(key => <th scope="col" key={key}>{label(key)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map(key => <td key={key}><DataTree value={row[key] ?? null} /></td>)}</tr>)}</tbody></table></div>
}
function Fold({ title, value, initial = false }: { title: string; value: DataValue; initial?: boolean }) {
  const [open, setOpen] = useState(initial)
  const heading = itemTitle(value, title)
  const icon = isObject(value) && typeof value.icon === 'string' ? genshinImage('skills/' + value.icon) : undefined
  return <details className="gi-fold" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{icon && <img src={icon} alt="" width="36" height="36" loading="lazy" />}<span>{heading}{heading !== label(title) && <small>{label(title)}</small>}</span></summary>
    {open && <div className="gi-fold-body"><DataTree value={value} /></div>}
  </details>
}
function DataTree({ value }: { value: DataValue }) {
  if (value === null || typeof value !== 'object') return <span className="gi-text">{text(value)}</span>
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-ink-400">无</span>
    if (value.every(isObject) && value.every(row => Object.values(row).every(cell => cell === null || typeof cell !== 'object'))) return <DataTable rows={value as DataObject[]} />
    if (value.every(item => item === null || typeof item !== 'object')) return <span className="gi-values">{value.map((item, index) => <span key={index}>{text(item)}</span>)}</span>
    return <div className="space-y-3">{value.map((item, index) => <Fold key={index} title={String(index + 1)} value={item} />)}</div>
  }
  const entries = Object.entries(value)
  if (!entries.length) return <span className="text-ink-400">无</span>
  // 倍率表：每列是天赋等级，保留百分号、多段倍率及原始字符串。
  if (entries.every(([, row]) => Array.isArray(row) && row.every(cell => cell === null || typeof cell !== 'object'))) {
    const width = Math.max(...entries.map(([, row]) => (row as DataValue[]).length))
    if (width > 0) return <div className="gi-table-wrap"><table className="gi-table"><thead><tr><th scope="col">项目</th>{Array.from({ length: width }, (_, i) => <th scope="col" key={i}>Lv. {i + 1}</th>)}</tr></thead><tbody>{entries.map(([key, row]) => <tr key={key}><th scope="row">{label(key)}</th>{Array.from({ length: width }, (_, i) => <td key={i}>{text((row as DataValue[])[i] ?? null)}</td>)}</tr>)}</tbody></table></div>
  }
  if (entries.every(([key, row]) => /^\d+$/.test(key) && isObject(row) && Object.values(row).every(cell => cell === null || typeof cell !== 'object'))) return <DataTable rows={entries.map(([key, row]) => ({ level: key, ...(row as DataObject) }))} />
  return <dl className="gi-fields">{entries.map(([key, row]) => {
    if (row !== null && typeof row === 'object') return <div key={key} className="gi-field-wide"><Fold title={key} value={row} /></div>
    return <div key={key} className={typeof row === 'string' && row.length > 55 ? 'gi-field gi-field-wide' : 'gi-field'}><dt>{label(key)}</dt><dd>{text(row)}</dd></div>
  })}</dl>
}
function EntryImage({ entry, large = false }: { entry: CatalogEntry; large?: boolean }) {
  const src = entry.icon ? genshinImage(entry.icon) : undefined
  return <div className={'gi-entry-image gi-rarity-' + entry.rarity + (large ? ' gi-entry-image-large' : '')}>
    {src ? <img src={src} alt="" width={large ? 160 : 96} height={large ? 160 : 96} loading={large ? 'eager' : 'lazy'} /> : <Sparkles size={large ? 48 : 26} aria-hidden="true" />}
  </div>
}
function Provenance() {
  return <details className="gi-provenance"><summary>数据来源与收录说明</summary><div className="mt-3 space-y-2 text-sm leading-7 text-ink-500 dark:text-ink-400">
    <p>数据源：api.lunaris.moe。固定版本 {genshinManifest.version}，简体中文，采集日期 {genshinManifest.retrievedAt.slice(0, 10)}。这是 7.2 正式服版本目录的存档，不随测试服最新版本变化。</p>
    <p>源清单有 {genshinManifest.characters.listed} 个角色条目（包含旅行者的不同元素、性别及特殊条目）和 {genshinManifest.weapons.listed} 个武器条目；已保存 {genshinManifest.characters.downloaded} 份角色完整详情、{genshinManifest.weapons.downloaded} 份武器完整详情。材料数字为物品 ID，角色与武器的原始分类保持原样。</p>
    <p>特殊旅行者条目 10000134 的详情在源站返回 404，保留清单记录并标记为缺少详情，不使用其他版本补齐。描述、倍率和战斗参数保持源站数据；静态存档也可能包含源站的特殊或任务条目。</p>
    <p>本页面的资料与图标均在本地读取，原始 JSON 可逐条下载。游戏内容及图像版权归其权利人所有，本站为非官方资料整理。</p>
  </div></details>
}
export default function GenshinData() {
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const kind: GenshinKind = params.kind === 'weapons' || (!params.kind && searchParams.get('kind') === 'weapons') ? 'weapons' : 'characters'
  const selected = params.id ? catalog.find(entry => entry.kind === params.kind && entry.id === params.id) : undefined
  const [data, setData] = useState<DataObject>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [, setImagesReady] = useState(0)
  const [exporting, setExporting] = useState(false)
  const query = searchParams.get('q') ?? ''
  const element = searchParams.get('element') ?? ''
  const weapon = searchParams.get('weapon') ?? ''
  const rarity = searchParams.get('rarity') ?? ''
  const sort = searchParams.get('sort') ?? 'id'
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key)
    setSearchParams(next, { replace: true })
  }
  useEffect(() => { let active = true; loadGenshinImages().then(() => { if (active) setImagesReady(n => n + 1) }).catch(() => {}); return () => { active = false } }, [])
  useEffect(() => {
    let active = true
    setData(undefined)
    setError('')
    setLoading(!!selected?.available)
    if (selected?.available) {
      loadGenshinDetail(selected.kind, selected.id).then(result => { if (active) { if (result) setData(result); else setError('未找到该条目的本地详情。'); setLoading(false) } }).catch(() => { if (active) { setError('本地数据加载失败，请重新加载此页面。'); setLoading(false) } })
      loadGenshinImages(true).then(() => { if (active) setImagesReady(n => n + 1) }).catch(() => {})
    }
    return () => { active = false }
  }, [selected?.kind, selected?.id, selected?.available])
  useEffect(() => { const old = document.title; document.title = (selected ? entryName(selected) : '原神数据') + ' · 百宝箱'; return () => { document.title = old } }, [selected])
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return catalog.filter(entry => entry.kind === kind && (!needle || [entryName(entry), entry.enName, entry.id].some(value => value.toLocaleLowerCase().includes(needle))) && (!element || entry.element === element) && (!weapon || entry.weaponType === weapon) && (!rarity || String(entry.rarity) === rarity))
      .sort((a, b) => sort === 'name' ? entryName(a).localeCompare(entryName(b), 'zh-CN') : sort === 'rarity' ? b.rarity - a.rarity || a.id.localeCompare(b.id) : a.id.localeCompare(b.id))
  }, [kind, query, element, weapon, rarity, sort])
  const pages = Math.max(1, Math.ceil(filtered.length / 48))
  const requestedPage = Number(searchParams.get('page'))
  const page = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1))
  const visible = filtered.slice((page - 1) * 48, page * 48)
  const listQuery = new URLSearchParams(searchParams)
  listQuery.set('kind', kind)
  async function exportAll() {
    setExporting(true)
    setError('')
    try {
      const records = await Promise.all(catalog.filter(entry => entry.available).map(async entry => ({ kind: entry.kind, id: entry.id, data: await loadGenshinDetail(entry.kind, entry.id) })))
      const sourceLists = JSON.parse((await import('../data/genshin/source-lists.json?raw')).default)
      downloadGenshinJSON('genshin-7.2.0-chs.json', { sourceLists, manifest: genshinManifest, catalog, characters: Object.fromEntries(records.filter(row => row.kind === 'characters').map(row => [row.id, row.data])), weapons: Object.fromEntries(records.filter(row => row.kind === 'weapons').map(row => [row.id, row.data])) })
    } catch { setError('数据导出失败，请重新加载后重试。') } finally { setExporting(false) }
  }
  const detailQuery = listQuery.toString()
  if (params.id) return <div className="container-page gi-page pt-12" data-yield-list>
    <Link className="gi-back" to={'/toolbox/genshin?' + detailQuery}><ArrowLeft size={16} />返回{kind === 'characters' ? '角色' : '武器'}图鉴</Link>
    {!selected ? <div className="gi-empty"><h1>未找到该条目</h1><p>请从图鉴选择一个角色或武器。</p></div> : <>
      <header className="gi-detail-header"><EntryImage entry={selected} large /><div><p className="text-sm text-ink-500">原神 · 7.2 正式服</p><h1 className="mt-2 font-serif text-3xl font-bold text-ink-900 sm:text-4xl dark:text-white">{entryName(selected)}</h1><p className="mt-2 text-sm text-ink-500">{selected.enName}</p><div className="mt-4 flex flex-wrap gap-2"><span className="gi-tag">{'★'.repeat(selected.rarity) || '特殊条目'}</span>{selected.element && <span className={'gi-tag gi-element-' + selected.element}>{label(selected.element)}元素</span>}<span className="gi-tag">{label(selected.weaponType)}</span><span className="gi-tag">ID {selected.id}</span></div></div></header>
      {loading && <p role="status" className="py-10 text-ink-500">正在读取完整详情…</p>}
      {error && <p role="alert" className="gi-error">{error}</p>}
      {!selected.available && <div className="gi-empty"><h2>源站未提供详情</h2><p>该条目在 7.2.0 清单中存在，但其详情返回 404。已保留清单记录。</p></div>}
      {data && <>
        <div className="gi-detail-tools"><p>全部资料按源站字段整理，点击下方分组展开阅读。</p><button className="btn-outline text-xs" onClick={() => downloadGenshinJSON(selected.id + '-7.2.0-chs.json', data)}><Download size={14} />下载原始 JSON</button></div>
        <div className="gi-sections" key={selected.id}>{Object.entries(data).map(([key, value], index) => <Fold key={key} title={key} value={value} initial={key === 'info' || (kind === 'weapons' && (key === 'weaponDesc' || key === 'passive')) || index === 0} />)}</div>
      </>}
    </>}
    <Provenance />
  </div>
  return <div className="container-page gi-page pt-12" data-yield-list>
    <Link to="/toolbox" className="gi-back"><ArrowLeft size={16} />百宝箱</Link>
    <header className="gi-header"><div><h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl dark:text-white">原神数据</h1><p className="mt-3 text-sm leading-7 text-ink-500 dark:text-ink-400">翻阅角色的故事与天赋，查找武器属性和养成材料。<br />收录至 7.2 正式服，支持离线阅读。</p></div><button className="btn-outline shrink-0 text-xs" disabled={exporting} onClick={exportAll}><Download size={14} />{exporting ? '正在整理…' : '导出全部数据'}</button></header>
    <nav className="gi-category" aria-label="数据类别">{(['characters', 'weapons'] as const).map(value => <button key={value} aria-pressed={kind === value} className={kind === value ? 'is-active' : ''} onClick={() => update({ kind: value, element: '', weapon: '', rarity: '' })}>{value === 'characters' ? '角色' : '武器'}<span>{catalog.filter(entry => entry.kind === value).length}</span></button>)}</nav>
    <div className="gi-filters"><label className="gi-search"><Search size={17} aria-hidden="true" /><input aria-label="搜索角色或武器" value={query} onChange={event => update({ q: event.target.value })} placeholder="名称、英文名或 ID" type="search" /></label>
      {kind === 'characters' && <label><span className="sr-only">元素</span><select aria-label="元素" value={element} onChange={event => update({ element: event.target.value })}><option value="">全部元素</option>{Object.entries(elements).map(([value, name]) => <option key={value} value={value}>{name}{value === 'Unknown' ? '条目' : '元素'}</option>)}</select></label>}
      <label><span className="sr-only">武器类型</span><select aria-label="武器类型" value={weapon} onChange={event => update({ weapon: event.target.value })}><option value="">全部武器类型</option>{Object.entries(weaponTypes).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label>
      <label><span className="sr-only">星级</span><select aria-label="星级" value={rarity} onChange={event => update({ rarity: event.target.value })}><option value="">全部星级</option>{[5, 4, 3, 2, 1].map(value => <option value={value} key={value}>{value} 星</option>)}</select></label>
      <label><span className="sr-only">排序</span><select aria-label="排序" value={sort} onChange={event => update({ sort: event.target.value })}><option value="id">默认排序</option><option value="name">名称排序</option><option value="rarity">星级优先</option></select></label>
    </div>
    <p className="gi-result-count" role="status">找到 {filtered.length} 个{kind === 'characters' ? '角色条目' : '武器条目'}{filtered.length > 48 && '，第 ' + page + ' / ' + pages + ' 页'}</p>
    {error && <p role="alert" className="gi-error">{error}</p>}
    {visible.length ? <div className="gi-catalog" data-yield-list>{visible.map(entry => <Link key={entry.id} to={'/toolbox/genshin/' + entry.kind + '/' + entry.id + '?' + detailQuery} className="gi-entry"><EntryImage entry={entry} /><div className="gi-entry-copy"><h2>{entryName(entry)}</h2><p>{entry.element ? label(entry.element) + ' · ' : ''}{label(entry.weaponType)}</p><span className="gi-stars" aria-label={entry.rarity + ' 星'}>{'★'.repeat(entry.rarity)}</span>{!entry.available && <small>详情暂缺</small>}</div></Link>)}</div> : <div className="gi-empty"><h2>没有匹配的条目</h2><p>尝试其他名称，或清除筛选条件。</p><button className="btn-outline mt-4" onClick={() => update({ q: '', element: '', weapon: '', rarity: '' })}>清除筛选</button></div>}
    {pages > 1 && <nav className="gi-pagination" aria-label="图鉴分页"><button className="btn-outline" disabled={page === 1} onClick={() => { const next = new URLSearchParams(searchParams); next.set('page', String(page - 1)); setSearchParams(next) }}><ChevronLeft size={16} />上一页</button><span>{page} / {pages}</span><button className="btn-outline" disabled={page === pages} onClick={() => { const next = new URLSearchParams(searchParams); next.set('page', String(page + 1)); setSearchParams(next) }}>下一页<ChevronRight size={16} /></button></nav>}
    <Provenance />
  </div>
}

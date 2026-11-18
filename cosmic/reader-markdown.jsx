import React, {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeSlug from 'rehype-slug'
import { Check, Copy, FileCode2 } from 'lucide-react'
import 'katex/dist/katex.min.css'
import {
  parseArticleDirectives,
  articleFontStyle,
  stripArticleDirectives,
} from '../src/lib/articleDirectives'
import {
  buildUiValueLookup,
  createInitialWidgetState,
  evaluateUiCondition,
  expandInlineIfDirectives,
  extractUiWidgetDefs,
  substituteUiPlaceholdersInLine,
  parseUiWriteToken,
  resolveEffectiveRealString,
} from '../src/lib/uiWidgets'
import { OFFLINE, resolveOfflineImageSrc } from '../src/lib/runtime'
import { resolvePendingImageSrc } from '../src/lib/updateQueue'
import Plot from './reader-plot.jsx'
import {
  clampShowVariable,
  initialShowValues,
  parseShowMappings,
  parseShowVariables,
  renderShowContent,
} from '../src/lib/showBox'

const schema = {
  ...defaultSchema,
  tagNames: [...defaultSchema.tagNames, 'starlog-field', 'starlog-select'],
  attributes: {
    ...defaultSchema.attributes,
    'starlog-field': ['title'],
    'starlog-select': ['title'],
    code: [
      ...(defaultSchema.attributes.code || []),
      ['className', /^language-./, 'math-inline', 'math-display'],
    ],
  },
}
const rehype = [
  rehypeRaw,
  [rehypeSanitize, schema],
  [rehypeKatex, { trust: false, strict: 'ignore' }],
  [rehypeHighlight, { detect: false }],
  rehypeSlug,
]
const remark = [remarkGfm, remarkMath]

function CodeBox({ children }) {
  const ref = useRef(null),
    [copied, setCopied] = useState(false)
  const lang =
    children?.props?.className?.match(/language-([^\s]+)/)?.[1] || '代码'
  async function copy() {
    const text = ref.current?.textContent
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      const range = document.createRange()
      range.selectNodeContents(ref.current)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }
  return (
    <div className="cr-code">
      <div className="cr-code-head">
        <FileCode2 size={14} />
        {lang}
        <button
          type="button"
          title={copied ? '已复制' : '复制代码'}
          aria-label={copied ? '已复制' : '复制代码'}
          onClick={copy}
          onBlur={() => setCopied(false)}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  )
}

const ArticleControls = createContext(null)
const attributeText = (value) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
function InlineSelect({ title }) {
  const context = useContext(ArticleControls)
  return context.defs.some((d) => d.kind === 'select' && d.id === title) ? (
    <Widget block={{ id: title }} context={context} />
  ) : null
}
function WriteField({ title }) {
  const context = useContext(ArticleControls)
  const def = context.defs.find((d) => d.kind === 'write' && d.id === title)
  if (!def) return null
  const { value } = context.states[def.id] ?? createInitialWidgetState(def)
  const numeric = def.real && resolveEffectiveRealString(value, def.real)
  const label = def.name || def.id
  const hint =
    numeric?.hint ||
    (def.len && value.length < def.len.down
      ? '至少输入 ' + def.len.down + ' 个字符'
      : '')
  const update = (e) =>
    context.update(def.id, { kind: 'write', value: e.target.value })
  return (
    <label
      className={'cr-write' + (def.isNew && !def.merge ? ' cr-write-row' : '')}
    >
      {def.name && <span>{label}</span>}
      <input
        type="text"
        inputMode={def.real ? 'decimal' : undefined}
        aria-label={label}
        aria-invalid={!!hint}
        title={hint}
        value={value}
        maxLength={def.len?.up}
        onChange={update}
      />
      {def.faster && def.real && (
        <input
          type="range"
          aria-label={label + '滑块'}
          min={def.real.down}
          max={def.real.up}
          step={10 ** -def.real.bit}
          value={numeric.effective}
          onChange={update}
        />
      )}
      {hint && <small>{hint}</small>}
    </label>
  )
}
function ReaderImage({ node, src, srcSet, alt = '', ...props }) {
  const url = resolveOfflineImageSrc(resolvePendingImageSrc(src || ''))
  return url ? (
    <img
      {...props}
      src={url}
      srcSet={OFFLINE ? undefined : srcSet}
      loading="lazy"
      decoding="async"
      alt={alt}
    />
  ) : (
    <span>{alt}（离线文件未收录此图）</span>
  )
}
function Prose({ text, articles, onArticle }) {
  const components = useMemo(
    () => ({
      pre: CodeBox,
      table: ({ node, ...props }) => (
        <div className="cr-table">
          <table {...props} />
        </div>
      ),
      img: ReaderImage,
      'starlog-field': WriteField,
      'starlog-select': InlineSelect,
      p: ({ node, children }) =>
        node.children.some((child) => child.tagName === 'starlog-select') ? (
          <div className="cr-inline-paragraph">{children}</div>
        ) : (
          <p>{children}</p>
        ),
      ...(OFFLINE
        ? { source: () => null, video: () => null, audio: () => null }
        : {}),
      a: ({ node, href = '', children, ...props }) => {
        const link = href.match(
          /^(?:\.{0,2}\/|#\/)?(?:posts?\/|content\/posts\/)([^#?]+)|^(?:\.\/)?([^/?#]+)\.md(?:$|#)/,
        )
        let slug = link && (link[1] || link[2]).replace(/\.md$/, '')
        try {
          if (slug) slug = decodeURIComponent(slug)
        } catch {}
        const item =
          slug &&
          articles.find(
            (a) => a.id === slug || a.path?.endsWith('/' + slug + '.md'),
          )
        if (item)
          return (
            <a
              href={'#/post/' + encodeURIComponent(item.id)}
              onClick={(e) => {
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault()
                  onArticle(item)
                }
              }}
              {...props}
            >
              {children}
            </a>
          )
        if (/^#(?!\/)/.test(href))
          return (
            <a
              href={href}
              {...props}
              onClick={(e) => {
                e.preventDefault()
                let id = href.slice(1)
                try {
                  id = decodeURIComponent(id)
                } catch {}
                ;(
                  document.getElementById(id) ||
                  document.getElementById('user-content-' + id)
                )?.scrollIntoView({ block: 'start' })
              }}
            >
              {children}
            </a>
          )
        return (
          <a
            href={href}
            {...props}
            {...(/^https?:\/\//i.test(href)
              ? { target: '_blank', rel: 'noopener noreferrer' }
              : {})}
          >
            {children}
          </a>
        )
      },
    }),
    [articles, onArticle],
  )
  return (
    <div className="cr-prose">
      <Markdown
        remarkPlugins={remark}
        rehypePlugins={rehype}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  )
}

const foldNames = {
  info: '提示',
  warning: '注意',
  success: '完成',
  error: '提醒',
  note: '笔记',
  tip: '提示',
  danger: '警告',
}
function parseBlocks(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  let pos = 0
  function read(end) {
    const out = []
    let buf = [],
      fence = null
    const flush = () => {
      const text = buf.join('\n')
      if (text.trim()) out.push({ kind: 'md', text })
      buf = []
    }
    while (pos < lines.length) {
      const line = lines[pos++],
        trimmed = line.trim()
      let m
      const mark = trimmed.match(/^([\u0060]{3,}|~{3,})(.*)$/)
      if (fence) {
        buf.push(line)
        if (
          mark &&
          mark[1][0] === fence[0] &&
          mark[1].length >= fence.length &&
          !mark[2].trim()
        )
          fence = null
        continue
      }
      if (mark) {
        fence = mark[1]
        buf.push(line)
        continue
      }
      if (end && trimmed === end) break
      if (
        (m = trimmed.match(
          /^(:{3,})(info|warning|success|error|note|tip|danger)(?:\[(.*)\])?(?:\{(open)\})?$/i,
        ))
      ) {
        flush()
        out.push({
          kind: 'fold',
          title: m[3] || foldNames[m[2]],
          open: !!m[4],
          children: read(m[1]),
        })
      } else if ((m = trimmed.match(/^::IF\[(.*)\]$/))) {
        flush()
        out.push({
          kind: 'condition',
          formula: m[1],
          children: read('::IF_END'),
        })
      } else if (
        (m = trimmed.match(/^::begin_ui-(ccs|graph|choose|select|if)(.*)$/))
      ) {
        const kind = m[1],
          block = []
        while (pos < lines.length && lines[pos].trim() !== '::end_ui-' + kind)
          block.push(lines[pos++])
        if (pos < lines.length) pos++
        const id = m[2]
          .trim()
          .match(/^\[([^\]]+)\]/)?.[1]
          ?.trim()
        if (kind === 'select' && id) {
          const markup =
            '<starlog-select title="' +
            attributeText(id) +
            '"></starlog-select>'
          if (buf.length && buf.at(-1).trim())
            buf[buf.length - 1] += ' ' + markup
          else buf.push(markup)
        } else {
          flush()
          out.push({ kind, header: m[2], id, text: block.join('\n') })
        }
      } else if ((m = trimmed.match(/^::show_begin\{([^}]*)\}\{(.*)\}$/))) {
        const block = []
        while (pos < lines.length && lines[pos].trim() !== '::show_end')
          block.push(lines[pos++])
        if (pos < lines.length) pos++
        flush()
        out.push({
          kind: 'show',
          title: m[1],
          spec: m[2],
          text: block.join('\n'),
        })
      } else if (!/^::cute-table\{[^}]*\}$/.test(trimmed)) buf.push(line)
    }
    flush()
    return out
  }
  return read(null)
}

function Show({ block, context }) {
  const variables = useMemo(
    () => parseShowVariables(block.spec, block.text),
    [block],
  )
  const mappings = useMemo(() => parseShowMappings(block.text), [block])
  const [values, setValues] = useState(() => initialShowValues(variables))
  const text = renderShowContent(block.text, values, mappings)
  const nested = useMemo(() => parseBlocks(text), [text])
  return (
    <section className="cr-show">
      <strong>{block.title}</strong>
      {variables.map((v) => (
        <label key={v.name}>
          {v.name}
          <input
            aria-label={v.name}
            type={v.type === 'string' ? 'text' : 'number'}
            min={v.min}
            max={v.max}
            step={v.step}
            value={values[v.name]}
            onChange={(e) =>
              setValues({
                ...values,
                [v.name]: clampShowVariable(v, e.target.value),
              })
            }
          />
          {v.fastSet && (
            <input
              aria-label={v.name + '滑块'}
              type="range"
              min={v.min}
              max={v.max}
              step={v.step}
              value={values[v.name]}
              onChange={(e) =>
                setValues({
                  ...values,
                  [v.name]: clampShowVariable(v, e.target.value),
                })
              }
            />
          )}
        </label>
      ))}
      <Blocks blocks={nested} context={context} />
    </section>
  )
}
function Widget({ block, context }) {
  const [query, setQuery] = useState('')
  const def = context.defs.find((d) => d.id === block.id)
  if (!def) return <Prose text={block.text} {...context} />
  const state = context.states[def.id] ?? createInitialWidgetState(def)
  const options = def.options || def.items || []
  function choose(index) {
    if (def.kind === 'if') {
      const checked = state.checked.slice()
      checked[index - 1] = !checked[index - 1]
      context.update(def.id, { ...state, checked })
    } else {
      const selected = state.selected.includes(index)
        ? state.selected.filter((n) => n !== index)
        : def.maxSelect === 1
          ? [index]
          : [...state.selected, index].slice(0, def.maxSelect)
      context.update(def.id, { ...state, selected })
    }
  }
  if (def.kind === 'select') {
    const selected = options.filter((o) => state.selected.includes(o.index))
    return (
      <details className="cr-select">
        <summary>
          {selected.map((o) => o.content).join('、') || '选择项目'}
        </summary>
        {def.search && (
          <input
            type="search"
            aria-label={'搜索 ' + def.id}
            placeholder="筛选选项"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {options
          .filter((o) => o.content.toLowerCase().includes(query.toLowerCase()))
          .map((o) => (
            <label key={o.index}>
              <input
                type={def.maxSelect === 1 ? 'radio' : 'checkbox'}
                name={def.id}
                checked={state.selected.includes(o.index)}
                onChange={(e) => {
                  choose(o.index)
                  if (def.maxSelect === 1)
                    e.target.closest('details').open = false
                }}
              />
              <Prose text={o.content} {...context} />
            </label>
          ))}
      </details>
    )
  }
  return (
    <fieldset className={'cr-widget' + (def.lined ? ' cr-lined' : '')}>
      {def.name && <legend>{def.name}</legend>}
      {options.map((o) => (
        <label key={o.index}>
          <input
            type={def.maxSelect === 1 ? 'radio' : 'checkbox'}
            name={def.id}
            checked={
              state.checked
                ? state.checked[o.index - 1]
                : state.selected.includes(o.index)
            }
            onChange={() => choose(o.index)}
            aria-label={o.content || o.label || String(o.index)}
          />
          {o.label && <span>{o.label}</span>}
          <Prose text={o.content || o.label} {...context} />
        </label>
      ))}
    </fieldset>
  )
}
function expandProse(text, lookup) {
  const inline = (part) => {
    const expanded = expandInlineIfDirectives(
      substituteUiPlaceholdersInLine(part, lookup),
    )
    let out = '',
      from = 0
    while (true) {
      const at = expanded.indexOf('::ui-write[', from)
      if (at < 0) return out + expanded.slice(from)
      out += expanded.slice(from, at)
      const after = at + '::ui-write'.length,
        field = parseUiWriteToken(expanded.slice(after))
      if (!field) {
        out += '::ui-write'
        from = after
        continue
      }
      const id = attributeText(field.def.id)
      out += '<starlog-field title="' + id + '"></starlog-field>'
      from = after + field.consumedLength
    }
  }
  let fence = null
  return text
    .split('\n')
    .map((line) => {
      const mark = line.match(/^\s*([\u0060]{3,}|~{3,})(.*)$/)
      if (mark) {
        if (!fence) fence = mark[1]
        else if (
          mark[1][0] === fence[0] &&
          mark[1].length >= fence.length &&
          !mark[2].trim()
        )
          fence = null
        return line
      }
      if (fence) return line
      // Literal widget syntax inside an inline code span stays an example.
      // Its value references still update, as the article language specifies.
      return line.split(/(([\u0060]+).*?\2)/g).reduce((s, part, i) => {
        if (i % 3 === 0) return s + inline(part)
        if (i % 3 === 1) return s + substituteUiPlaceholdersInLine(part, lookup)
        return s
      }, '')
    })
    .join('\n')
}
function Blocks({ blocks, context }) {
  const { lookup } = context
  return blocks.map((b, i) => {
    if (b.kind === 'md') {
      const text = expandProse(b.text, lookup)
      return <Prose key={i} text={text} {...context} />
    }
    if (b.kind === 'condition')
      return evaluateUiCondition(
        substituteUiPlaceholdersInLine(b.formula, lookup),
      ) ? (
        <Blocks key={i} blocks={b.children} context={context} />
      ) : null
    if (b.kind === 'fold')
      return (
        <details key={i} open={b.open || undefined}>
          <summary>{b.title}</summary>
          <Blocks blocks={b.children} context={context} />
        </details>
      )
    if (b.kind === 'ccs' || b.kind === 'graph')
      return <Plot key={i} block={b} />
    if (b.kind === 'show') return <Show key={i} block={b} context={context} />
    return <Widget key={i} block={b} context={context} />
  })
}
export function ArticleBody({ source, articles = [], onArticle }) {
  const defs = useMemo(() => extractUiWidgetDefs(source), [source])
  const blocks = useMemo(
    () => parseBlocks(stripArticleDirectives(source)),
    [source],
  )
  const style = useMemo(
    () => articleFontStyle(parseArticleDirectives(source)),
    [source],
  )
  const [states, setStates] = useState({})
  const lookup = useMemo(() => buildUiValueLookup(defs, states), [defs, states])
  const context = {
    articles,
    onArticle,
    states,
    defs,
    lookup,
    update: (id, state) => setStates((prev) => ({ ...prev, [id]: state })),
  }
  return (
    <ArticleControls.Provider value={context}>
      <div style={style}>
        <Blocks blocks={blocks} context={context} />
      </div>
    </ArticleControls.Provider>
  )
}

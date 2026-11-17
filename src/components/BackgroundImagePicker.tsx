import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Image as ImageIcon, Link2, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react'
import {
  BACKGROUND_IMAGE_DIR,
  backgroundImageSrc,
  listRepoBackgroundImages,
  normalizeBackgroundImageUrl,
  readBackgroundImage,
  readLocalBackgroundImage,
  repoImageUrl,
  useBackgroundImage,
  writeBackgroundImage,
  type BackgroundImageChoice,
} from '../lib/backgroundImage'
import { useToast } from './Toast'
import { OFFLINE } from '../lib/runtime'

/**
 * 固定背景图选择器（issue #126）。
 *
 * 三条来路：仓库 `user_upload/background_image/` 里的图片、本机文件（压完只存在浏览器里）、
 * 以及直接粘贴一个图片地址。选定后立刻生效，并作为账号偏好的一项被自动同步（issue #129）。
 */
export function BackgroundImagePicker() {
  const pref = useBackgroundImage()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [choices, setChoices] = useState<BackgroundImageChoice[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const [showUrlInput, setShowUrlInput] = useState(false)

  const apply = useCallback(
    (next: Partial<Parameters<typeof writeBackgroundImage>[0]>) => {
      const current = readBackgroundImage()
      writeBackgroundImage({ ...current, ...next, updatedAt: Date.now() })
    },
    [],
  )

  const load = useCallback(async () => {
    if (OFFLINE) return
    setLoading(true)
    setLoadError('')
    try {
      const list = await listRepoBackgroundImages()
      setChoices(list)
      if (list.length === 0) setLoadError(`仓库的 ${BACKGROUND_IMAGE_DIR}/ 下还没有图片`)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '读取仓库背景图列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!OFFLINE && choices.length === 0) void load()
    // 只在挂载时读一次：设置页来回切会重复打 API
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeSrc = backgroundImageSrc(pref)

  const onPickFile = async (file: File) => {
    setBusy(true)
    try {
      const dataUrl = await readLocalBackgroundImage(file)
      const url = normalizeBackgroundImageUrl(dataUrl)
      if (!url) throw new Error('这张图片的格式暂不支持，请换 png / jpg / webp / gif')
      apply({ enabled: true, url, label: file.name.slice(0, 80), source: 'local' })
      toast('已应用本机图片作为背景', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '读取本机图片失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 border-t border-ink-200/70 pt-5 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-medium text-ink-800 dark:text-ink-100">
          <ImageIcon size={15} className="mr-1.5 inline-block align-[-2px] text-brand-500" />
          固定背景图
        </p>
        {pref.enabled && activeSrc ? (
          <button type="button" className="btn-outline h-8 text-xs" onClick={() => apply({ enabled: false })}>
            <Trash2 size={13} />
            不使用背景图
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
        可以选仓库 <code className="font-mono">{BACKGROUND_IMAGE_DIR}/</code> 下的任意图片，也可以用本机图片。
        {OFFLINE
          ? '离线版不联网：这里只能用本机图片。'
          : '本机图片会压缩后只保存在这个浏览器里，不会上传到仓库。'}
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <div className="h-20 w-32 shrink-0 overflow-hidden rounded-xl border border-ink-200 bg-ink-50 dark:border-white/12 dark:bg-white/[0.04]">
          {pref.enabled && activeSrc ? (
            <img src={activeSrc} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[11px] text-ink-400">未选择</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-ink-500 dark:text-ink-400">
            {pref.enabled && activeSrc ? `当前：${pref.label || '自定义图片'}` : '背景仍由「配色主题 + 渐变强度」决定'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-outline h-8 text-xs"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              选择本机图片
            </button>
            {!OFFLINE && (
              <button type="button" className="btn-outline h-8 text-xs" disabled={loading} onClick={() => void load()}>
                {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                重新读取仓库列表
              </button>
            )}
            <button
              type="button"
              className="btn-outline h-8 text-xs"
              onClick={() => setShowUrlInput((v) => !v)}
            >
              <Link2 size={13} />
              粘贴图片地址
            </button>
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void onPickFile(file)
          e.target.value = ''
        }}
      />

      {showUrlInput && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://…/picture.jpg"
            className="input flex-1 font-mono text-xs"
            spellCheck={false}
          />
          <button
            type="button"
            className="btn-primary h-10 shrink-0"
            onClick={() => {
              const url = normalizeBackgroundImageUrl(urlDraft)
              if (!url) {
                toast('请输入 http(s) 开头的图片地址或 data: URI', 'error')
                return
              }
              apply({ enabled: true, url, label: '自定义地址', source: 'url' })
              setShowUrlInput(false)
              setUrlDraft('')
              toast('已应用背景图', 'success')
            }}
          >
            <Check size={15} />
            应用
          </button>
        </div>
      )}

      {!OFFLINE && (
        <div className="mt-3">
          {loadError && <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">{loadError}</p>}
          {choices.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {choices.map((choice) => {
                const active = pref.enabled && (pref.url === choice.url || pref.url === repoImageUrl(choice.name))
                return (
                  <button
                    key={choice.name}
                    type="button"
                    title={choice.label}
                    onClick={() =>
                      apply({
                        enabled: true,
                        url: choice.url,
                        label: choice.label,
                        source: 'repo',
                      })
                    }
                    className={`group relative aspect-[4/3] overflow-hidden rounded-lg border transition ${
                      active
                        ? 'border-brand-500 ring-2 ring-brand-500/25'
                        : 'border-ink-200 hover:border-brand-400 dark:border-white/12 dark:hover:border-brand-400/60'
                    }`}
                  >
                    <img
                      src={choice.url}
                      alt={choice.label}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-ink-950/55 px-1.5 py-0.5 text-[10px] text-white">
                      {choice.label}
                    </span>
                    {active && (
                      <span className="absolute right-1 top-1 rounded-full bg-brand-500 p-0.5 text-white">
                        <Check size={11} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {pref.enabled && activeSrc && (
        <div className="mt-4 grid gap-4 rounded-xl bg-ink-50/70 p-4 sm:grid-cols-2 dark:bg-white/[0.03]">
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-500">铺法</p>
            <div className="flex gap-2">
              {(['cover', 'contain'] as const).map((fit) => (
                <button
                  key={fit}
                  type="button"
                  onClick={() => apply({ fit })}
                  className={`btn h-8 text-xs ${
                    pref.fit === fit ? 'btn-primary' : 'btn-outline'
                  }`}
                >
                  {fit === 'cover' ? '铺满裁切' : '完整显示'}
                </button>
              ))}
            </div>
            <p className="mb-1.5 mt-3 text-xs font-medium text-ink-500">滚动时</p>
            <div className="flex gap-2">
              {[
                { value: true, label: '固定在视口' },
                { value: false, label: '随页面滚动' },
              ].map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  onClick={() => apply({ fixed: option.value })}
                  className={`btn h-8 text-xs ${pref.fixed === option.value ? 'btn-primary' : 'btn-outline'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label htmlFor="background-image-dim" className="text-xs font-medium text-ink-500">
                压暗程度
              </label>
              <span className="font-mono text-xs font-bold text-brand-600 dark:text-brand-300">{pref.dim}%</span>
            </div>
            <input
              id="background-image-dim"
              type="range"
              min="0"
              max="80"
              step="1"
              value={pref.dim}
              onChange={(e) => apply({ dim: Number(e.target.value) })}
              className="h-2 w-full cursor-pointer accent-brand-500"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
              在图片上叠一层深色蒙版，保证正文与公式仍看得清。{pref.dim === 0 ? '当前为 0%，图片很亮时文字会吃力。' : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

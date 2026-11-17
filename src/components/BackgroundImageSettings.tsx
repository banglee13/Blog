import { useRef, useState } from 'react'
import { Ban, CheckCircle2, HardDrive, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import {
  BACKGROUND_IMAGE_BLUR_MAX,
  BACKGROUND_IMAGE_DIM_MAX,
  REPO_BACKGROUND_IMAGES,
  prepareLocalBackgroundImage,
  removeLocalBackgroundImage,
  saveLocalBackgroundImage,
  updateBackgroundImage,
  useBackgroundImage,
} from '../lib/backgroundImage'
import { OFFLINE } from '../lib/runtime'
import { useToast } from './Toast'

/** 一张可选的背景：缩略图 + 名称，选中时描边并打勾。 */
function ImageTile({
  selected,
  label,
  hint,
  onSelect,
  children,
}: {
  selected: boolean
  label: string
  hint?: string
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      title={hint ?? label}
      className={`group relative overflow-hidden rounded-xl border text-left transition ${
        selected
          ? 'border-brand-500/70 ring-2 ring-brand-500/25'
          : 'border-ink-200 hover:-translate-y-0.5 hover:border-brand-300 dark:border-white/12 dark:hover:border-brand-400/40'
      }`}
    >
      <span className="flex h-24 w-full items-center justify-center overflow-hidden bg-ink-100/70 text-ink-400 dark:bg-white/[0.04]">
        {children}
      </span>
      <span className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-700 dark:text-ink-200">{label}</span>
        {selected && <CheckCircle2 size={14} className="shrink-0 text-brand-600 dark:text-brand-300" />}
      </span>
    </button>
  )
}

/**
 * 设置页「固定背景图片」（issue #126）：
 * 从仓库 `user_upload/background_image/` 里的图片中任选一张，或选一张本机图片；
 * 另有遮罩浓度与模糊两项调节。所有改动即时生效并自动保存。
 */
export function BackgroundImageSettings() {
  const { pref, localImage, missing } = useBackgroundImage()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  const pickLocalFile = async (file: File) => {
    setImporting(true)
    try {
      const blob = await prepareLocalBackgroundImage(file)
      const saved = await saveLocalBackgroundImage(blob, file.name)
      updateBackgroundImage({ source: 'local', localName: file.name })
      toast(
        saved.persisted
          ? `已把「${file.name}」设为背景，图片只保存在这台设备上`
          : `已把「${file.name}」设为背景；当前浏览器无法保存图片，关闭页面后需要重新选择`,
        saved.persisted ? 'success' : 'info',
      )
    } catch (error) {
      toast(error instanceof Error ? error.message : '无法使用这张图片', 'error')
    } finally {
      setImporting(false)
    }
  }

  const removeLocal = async () => {
    await removeLocalBackgroundImage()
    if (pref.source === 'local') updateBackgroundImage({ source: 'none', localName: '' })
    else updateBackgroundImage({ localName: '' })
    toast('已移除这台设备上保存的本地背景图片', 'info')
  }

  const active = pref.source !== 'none'

  return (
    <>
      <div role="radiogroup" aria-label="固定背景图片" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <ImageTile
          selected={pref.source === 'none'}
          label="不使用图片"
          hint="使用默认的渐变背景或动态背景"
          onSelect={() => updateBackgroundImage({ source: 'none' })}
        >
          <Ban size={22} />
        </ImageTile>

        {REPO_BACKGROUND_IMAGES.map((image) => (
          <ImageTile
            key={image.file}
            selected={pref.source === 'repo' && pref.file === image.file}
            label={image.name}
            hint={`user_upload/background_image/${image.file}`}
            onSelect={() => updateBackgroundImage({ source: 'repo', file: image.file })}
          >
            <img src={image.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          </ImageTile>
        ))}

        {localImage ? (
          <ImageTile
            selected={pref.source === 'local'}
            label={`本地 · ${localImage.name}`}
            hint="这张图片只保存在这台设备上"
            onSelect={() => updateBackgroundImage({ source: 'local', localName: localImage.name })}
          >
            <img src={localImage.url} alt="" decoding="async" className="h-full w-full object-cover" />
          </ImageTile>
        ) : (
          <ImageTile
            selected={false}
            label="选择本地图片…"
            hint="从这台设备上选一张图片作为背景"
            onSelect={() => fileRef.current?.click()}
          >
            {importing ? <Loader2 size={22} className="animate-spin" /> : <ImagePlus size={22} />}
          </ImageTile>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void pickLocalFile(file)
          event.target.value = ''
        }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="btn-outline h-9"
        >
          {importing ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
          {localImage ? '更换本地图片' : '选择本地图片'}
        </button>
        {localImage && (
          <button type="button" onClick={() => void removeLocal()} className="btn-ghost h-9 text-rose-600 dark:text-rose-400">
            <Trash2 size={14} />
            移除本地图片
          </button>
        )}
        <span className="flex items-center gap-1 text-xs text-ink-400">
          <HardDrive size={12} />
          本地图片只保存在这台设备的浏览器里，不会上传
        </span>
      </div>

      {missing && (
        <p className="mt-3 rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/[0.06] dark:text-amber-300">
          {pref.source === 'local'
            ? `这个账号在另一台设备上选用了本地图片${pref.localName ? `「${pref.localName}」` : ''}，图片文件不会随账号同步：请在这台设备上重新选择，或改用上面的仓库图片。在此之前显示默认背景。`
            : `原先选用的「${pref.file}」已经不在仓库的背景图片目录里了，暂时显示默认背景。`}
        </p>
      )}

      <div className={`mt-5 space-y-5 ${active ? '' : 'opacity-60'}`}>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-4">
            <label htmlFor="background-image-dim" className="text-xs font-medium text-ink-500">
              遮罩浓度
            </label>
            <span className="font-mono text-xs font-bold text-brand-600 dark:text-brand-300">{pref.dim}%</span>
          </div>
          <input
            id="background-image-dim"
            type="range"
            min="0"
            max={BACKGROUND_IMAGE_DIM_MAX}
            step="5"
            value={pref.dim}
            onChange={(event) => updateBackgroundImage({ dim: Number(event.target.value) })}
            className="h-2 w-full cursor-pointer accent-brand-500"
          />
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            在图片上叠一层页面底色：0% 显示原图，数值越大图片越淡、文字越清楚；会跟随深浅色模式换成对应的底色。
          </p>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-4">
            <label htmlFor="background-image-blur" className="text-xs font-medium text-ink-500">
              模糊
            </label>
            <span className="font-mono text-xs font-bold text-brand-600 dark:text-brand-300">{pref.blur}px</span>
          </div>
          <input
            id="background-image-blur"
            type="range"
            min="0"
            max={BACKGROUND_IMAGE_BLUR_MAX}
            step="1"
            value={pref.blur}
            onChange={(event) => updateBackgroundImage({ blur: Number(event.target.value) })}
            className="h-2 w-full cursor-pointer accent-brand-500"
          />
          <p className="mt-1 text-xs leading-relaxed text-ink-400">0 为不模糊；细节太多的图片模糊一点更不抢正文。</p>
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-400">
        {OFFLINE
          ? '离线版不内置仓库里的背景图片（否则每张图都会让这个文件再大一两 MB），可以选择本地图片。'
          : REPO_BACKGROUND_IMAGES.length > 0
            ? `上面列出的是仓库 user_upload/background_image/ 目录里的全部图片（共 ${REPO_BACKGROUND_IMAGES.length} 张）；往该目录新增图片并推送，站点重新部署后就会出现在这里。`
            : '仓库的 user_upload/background_image/ 目录里还没有图片；往该目录新增图片并推送，站点重新部署后就会出现在这里。'}
        {' '}启用固定背景图片后动态背景暂不显示；文章用 ::set-background 指定了背景时，阅读该文章期间以文章为准。
      </p>
    </>
  )
}

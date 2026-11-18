// The reading engine and its math fonts are requested only after opening a post.
export function mountReader(container, options) {
  let alive = true
  let dispose
  const notice = document.createElement('div')
  notice.className = 'cr-loading'
  notice.setAttribute('role', 'status')
  notice.textContent = '正在打开文章…'
  container.replaceChildren(notice)
  import('./reader-view.jsx')
    .then(({ renderReader }) => {
      if (alive) dispose = renderReader(container, options)
    })
    .catch(() => {
      if (!alive) return
      notice.textContent = '阅读组件未能加载。'
      const back = document.createElement('button')
      back.type = 'button'
      back.textContent = '返回星图'
      back.onclick = options.onBack
      notice.append(back)
    })
  return () => {
    alive = false
    dispose?.()
  }
}

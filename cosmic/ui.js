import { icon } from './icons.js'
export { icon }
export const escapeHTML = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  )
export const dateText = (a) => (a.date || '').slice(0, 10).replaceAll('-', '.')
export const tool = (action, n, title) =>
  `<button class="icon-tool" type="button" data-action="${action}" aria-label="${escapeHTML(title)}" title="${escapeHTML(title)}">${icon(n)}</button>`
export const command = (action, n, title, kind = '') =>
  `<button type="button" class="command ${kind}" data-action="${action}">${icon(n)}${escapeHTML(title)}</button>`
export const download = (name, text, type = 'text/plain') => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
export function notice(msg) {
  let n = document.querySelector('.app-notice')
  if (!n) {
    n = document.createElement('div')
    n.className = 'app-notice'
    n.setAttribute('role', 'status')
    document.body.append(n)
  }
  n.textContent = msg
  clearTimeout(n.timer)
  n.timer = setTimeout(() => n.remove(), 4200)
}

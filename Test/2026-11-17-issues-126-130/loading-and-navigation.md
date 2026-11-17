# issue #128-2 · 加载与站内跳转（原始输出）

## 限速网络下的耗时

方法：真实 Chromium，每个场景全新的浏览器上下文（冷缓存），用 CDP 限速；每项跑 3 次取中位数。
流程：打开首页 → 停留 6 秒 → 依次点「归档」「标签」「百宝箱」→ 回到归档点开《hello-starlog》。
站内跳转的耗时从点击前计时到目标页面的标题 / 正文出现，其中含自动化点击约 60 ms 的固定开销。
本地静态服务器对文本资源做 gzip，「传输量」是压缩后的字节数。
### 快速 4G（9 Mbps / 60 ms）
| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| 首屏传输量（首页，冷缓存） | 261 KB | 249 KB |
| 最大内容绘制 LCP | 500 ms | 476 ms |
| 点「归档」到页面出现 | 168 ms | 86 ms |
| 点「标签」到页面出现 | 125 ms | 56 ms |
| 点「百宝箱」到页面出现 | 120 ms | 65 ms |
| 点开一篇文章到正文出现 | 526 ms | 140 ms |

### 慢速 4G（1.6 Mbps / 150 ms）
| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| 首屏传输量（首页，冷缓存） | 261 KB | 249 KB |
| 最大内容绘制 LCP | 1704 ms | 1628 ms |
| 点「归档」到页面出现 | 245 ms | 87 ms |
| 点「标签」到页面出现 | 220 ms | 57 ms |
| 点「百宝箱」到页面出现 | 217 ms | 65 ms |
| 点开一篇文章到正文出现 | 1958 ms | 139 ms |

## 首屏请求与空闲预取（不限速）

## 改动前
首屏（首页，load 事件时）：4 个请求，传输 261.4 KB，其中 JS 212.4 KB
  (document) 3.4KB
  assets/index.js 212.4KB
  assets/index.css 28.5KB
  assets/logo-venti.jpg 17.1KB
首屏之后空闲 6 秒内的后台请求：0 个，0 KB
点「归档」：新增请求 1 个（1.3 KB），出现加载圈：否
点「标签」：新增请求 3 个（2.2 KB），出现加载圈：否
点「百宝箱」：新增请求 1 个（1.1 KB），出现加载圈：否

## 改动后
首屏（首页，load 事件时）：5 个请求，传输 248.6 KB，其中 JS 199.1 KB
  (document) 3.5KB
  assets/index.js 103.0KB
  assets/vendor.js 96.0KB
  assets/index.css 28.9KB
  assets/logo-venti.jpg 17.1KB
首屏之后空闲 6 秒内的后台请求：13 个，307.2 KB
  assets/PostPage.js 16.7KB
  assets/Markdown.js 269.7KB
  assets/rotate-ccw.js 0.5KB
  assets/chevron-right.js 0.4KB
  assets/LatexPicker.js 11.9KB
  assets/loader-circle.js 0.4KB
  assets/refresh-cw.js 0.6KB
  assets/external-link.js 0.5KB
  assets/eye.js 0.5KB
  assets/trash-2.js 0.5KB
  assets/DiffView.js 2.7KB
  assets/crypto.js 2.4KB
  assets/arrow-up.js 0.5KB
点「归档」：新增请求 0 个（0 KB），出现加载圈：否
点「标签」：新增请求 0 个（0 KB），出现加载圈：否
点「百宝箱」：新增请求 0 个（0 KB），出现加载圈：否

## 构建产物（`npm run build` 的输出，minify 后 / gzip 后）

| 文件 | 改动前 | 改动后 |
| --- | --- | --- |
| `index.js`（主包） | 558.24 kB / 217.18 kB | 217.67 kB / 105.19 kB |
| `vendor.js`（React 全家桶 + js-yaml，可长期缓存） | —（在主包里） | 306.58 kB / 98.07 kB |
| `AnimatedBackdrop.js`（动态背景渲染器，选了场景才加载） | —（在主包里） | 43.99 kB / 16.59 kB |
| `settingsSync.js`（设置同步，登录后才加载） | — | 11.38 kB / 4.61 kB |
| `Archive.js` / `TagsPage.js` / `Toolbox.js` / `NotFound.js` | 各 1.3–2.5 kB，各自单独请求 | 并入主包 |
| `index.css` | 164.30 kB / 28.90 kB | 166.84 kB / 29.35 kB |

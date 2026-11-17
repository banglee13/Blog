import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 部署说明：
 * - GitHub Pages 项目主页（https://<user>.github.io/<repo>/）：BASE_PATH 为 "/<repo>/"，本仓库默认 "/Blog/"
 * - 用户主页（https://<user>.github.io/）：环境变量 VITE_BASE_PATH 设为 "/"
 * - Cloudflare Pages（https://<project>.pages.dev/）：构建环境自带 CF_PAGES，自动使用 "/"
 * 以上均可用环境变量 VITE_BASE_PATH 覆盖（GitHub Actions 中已自动注入仓库名）。
 */
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = command === 'serve' ? '/' : env.VITE_BASE_PATH || (process.env.CF_PAGES ? '/' : '/Blog/')

  return {
    base,
    define: {
      // 线上站点版：运行时的所有 `OFFLINE` 分支在这里被静态关掉（离线版见 vite.offline.config.ts）
      __STARLOG_OFFLINE__: 'false',
    },
    plugins: [
      react(),
      {
        // SPA 在 GitHub Pages 上刷新子路由会 404，复制一份 index.html 作为 404.html 兜底
        name: 'spa-404-fallback',
        closeBundle() {
          const dist = path.resolve(process.cwd(), 'dist')
          const index = path.join(dist, 'index.html')
          if (fs.existsSync(index)) {
            fs.copyFileSync(index, path.join(dist, '404.html'))
            fs.writeFileSync(path.join(dist, '.nojekyll'), '')
          }
        },
      },
    ],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: false,
      allowedHosts: true,
    },
    preview: {
      host: '0.0.0.0',
      allowedHosts: true,
    },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          /**
           * React 全家桶与 js-yaml 单独成包（issue #128）。
           * 文章正文打在主包里，每发布一篇文章主包的文件名（hash）就会变，回访的读者要把它整个重新下载；
           * 这几个依赖占了主包的大半却几乎不变，拆出去之后可以一直命中浏览器缓存。
           */
          manualChunks(id: string) {
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|js-yaml)[\\/]/.test(id)) {
              return 'vendor'
            }
          },
        },
      },
    },
  }
})

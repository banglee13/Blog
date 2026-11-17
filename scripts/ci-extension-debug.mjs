/**
 * 临时诊断脚本（只为把 CI 里 `extension:test` 的失败原因打到注解上）。
 *
 * Actions 的日志在部分沙箱里取不到（日志正文放在 Azure Blob 上，网络不可达），
 * 而 `::error::` / `::notice::` 这类 workflow command 会进 annotation，能通过 API 读到。
 * 用完请连同 `package.json` 里 `extension:test` 的临时指向一起删掉。
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extDir = join(repoRoot, 'vscode_extensions/v1')

const run = spawnSync('npm', ['run', 'test'], { cwd: extDir, encoding: 'utf8', maxBuffer: 64 << 20 })
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
try {
  writeFileSync('/tmp/extension-test.log', out)
} catch {
  // 写不了临时文件也要继续报注解
}

const lines = out.split('\n')
const keep = []
lines.forEach((line, index) => {
  if (/^(not ok|# (tests|pass|fail|cancelled|skipped))/.test(line)) {
    keep.push(...lines.slice(index, index + 26))
  }
})
const digest = (keep.length ? keep : lines.filter((line) => /error|Error|assert|✖|✗/.test(line)).slice(0, 40))
  .join('\n')
  .replace(/%/g, '%25')
  .replace(/\r/g, '')
  .replace(/\n/g, '%0A')
  .slice(0, 6000)

if ((run.status ?? 1) !== 0) {
  console.log(`::error::extension:test 失败摘要（exit ${run.status}）%0A${digest}`)
}
process.exit(run.status ?? 1)

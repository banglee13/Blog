# issue #127 · 编辑区行号与「末行置顶」（原始输出）

## 行号栏、状态栏与滚动到底

真实 Chromium（1440×900，双栏视图）。测试稿 141 行，其中 24 行是会自动折行的长段落。

- 载入 141 行测试稿之后（光标在文末）：编辑区滚动 4622/5195px，底部留白 568px，最后一行距编辑区顶部 592px；状态栏「行 141/141 · 列 9」，高亮第 141 行；预览区滚动 5568/6214px，最后一个内容块距预览区顶部 663.1px
- 把光标移到第 37 行：编辑区滚动 1347/5195px，底部留白 568px，最后一行距编辑区顶部 3867px；状态栏「行 37/141 · 列 5」，高亮第 37 行；预览区滚动 1667/6214px，最后一个内容块距预览区顶部 4564.1px
- 编辑区滚到最底：编辑区滚动 5195/5195px，底部留白 568px，最后一行距编辑区顶部 19px；状态栏「行 37/141 · 列 5」，高亮第 37 行；预览区滚动 6214/6214px，最后一个内容块距预览区顶部 17.1px
- 编辑区滚到中间（scrollTop = 1500）：编辑区滚动 1500/5195px，底部留白 568px，最后一行距编辑区顶部 3714px；状态栏「行 37/141 · 列 5」，高亮第 37 行；预览区滚动 1866/6214px，最后一个内容块距预览区顶部 4365.1px
- 改为把预览区滚到最底：编辑区滚动 5195/5195px，底部留白 568px，最后一行距编辑区顶部 19px；状态栏「行 37/141 · 列 5」，高亮第 37 行；预览区滚动 6214/6214px，最后一个内容块距预览区顶部 17.1px

行号栏宽 46px，正文左缩进 58px；镜像层宽度 533px = textarea 可视宽度 533px。页面报错 0 个。

## 其它行为

真实 Chromium。测试稿 60 行，每三行有一行是会自动折行的长段落。

文末输入一个字符后： {"scrollTop":1364,"maxScroll":1936,"caretLineTop":592,"clientHeight":612,"status":"行 60/60 · 列 8","mirrorMatches":true}
  → 光标所在行在可视区内： true
再回车 5 次并输入： {"lines":65,"scrollTop":1486,"maxScroll":2059,"caretLineTop":592,"status":"行 65/65 · 列 9","mirrorMatches":true,"transform":"translateY(-1486px)"}
  → 光标所在行在可视区内： true ；整页没有被带着滚动： true
退格 9 次（删掉 8 个字符 + 1 个换行）： {"lines":64,"status":"行 64/64 · 列 1","mirrorMatches":true}
视图按钮： 仅编辑 | 双栏 | 仅预览 | 全屏编辑 (Esc 退出)
当前视图滚到底： {"hasPreview":false,"scrollTop":1544,"maxScroll":1544,"lastLineTop":20,"clientWidth":1076,"mirrorWidth":1076,"numbered":true}
全屏滚到底： {"clientHeight":807,"paddingBottom":763,"scrollTop":1544,"maxScroll":1544,"lastLineTop":20,"mirrorWidth":1430,"clientWidth":1430,"gutterAttr":"auto"}
关闭「显示行号」「末行置顶」后滚到底： {"numbered":false,"gutter":false,"numberContent":"none","paddingLeft":20,"paddingBottom":20,"lastLineTop":568,"clientHeight":612,"status":"行 64/64 · 列 1"}
手机 390px： {"clientWidth":328,"paddingLeft":50,"numbered":true,"mirrorMatches":true,"mirrorWidth":328}
page errors: 0 []

## 长文里的按键耗时（改动前 4701 / 改动后 4702）

方法：载入 300 行 / 1000 行文稿，光标放在文稿中间，由脚本连续输入 25 个普通字符、8 个换行；
每次从改写 textarea 到 React 更新完成并强制一次布局为止计时（毫秒）。改动后每次按键多了「镜像层同步」这一步。

4701 · 300 行： {"chars":{"median":7,"min":6,"max":26.9},"enters":{"median":6,"min":5.2,"max":10.3}}
4702 · 300 行： {"chars":{"median":7.7,"min":6.4,"max":28.1},"enters":{"median":9,"min":7.9,"max":13.2}}
4701 · 1000 行： {"chars":{"median":19.8,"min":16.4,"max":43.6},"enters":{"median":21.1,"min":17.1,"max":25}}
4702 · 1000 行： {"chars":{"median":22.4,"min":17.9,"max":51},"enters":{"median":25.1,"min":24,"max":29.4}}

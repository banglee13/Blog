# issue #129 / #130 · 设置同步端到端检查（原始输出）

真实 Chromium + 站点的生产构建。GitHub 接口由测试脚本里的内存「假 GitHub」应答（实现了设置同步用到的
Discussions GraphQL 操作，并记录每一个请求）——**没有碰真实的仓库与 Discussions**。
A、B 是同一账号 alice 的两台设备（两个互相隔离的浏览器上下文），C 是另一个账号 bob，V 是未登录的访客。

✓ A 登录后尚未修改任何设置：不创建讨论、不发表评论 —— 请求：alice:SettingsDiscussion；状态：synced · 所有设置已保存到 @alice
✓ A 修改后自动保存：首次保存创建「设置同步」讨论并发表本人的评论 —— alice:SettingsDiscussion, alice:CreateSettingsDiscussion, alice:AddSettingsComment, alice:SettingsComments
✓ 评论里的 JSON 含有刚改的四项设置 —— {"colorTheme":"ocean","size":110,"lineNumbers":false,"bg":"Venti1.jpg"}
✓ 设置页显示已保存到账号 —— synced · 所有设置已保存到 @alice
✓ 讨论建在 General 分类、正文带识别标记
✓ B（另一台设备）登录同一账号后自动恢复全部设置 —— {"colorTheme":"ocean","fontSize":110,"themeMode":null,"lineNumbers":false,"backgroundImage":"repo:Venti1.jpg:","scene":null,"repository":null,"applied":{"theme":"ocean","dark":false,"fontSize":"110%","image":true}}
✓ B 只是读取，没有再写一遍 —— alice:SettingsDiscussion, alice:SettingsComments
✓ 账号里同时保留了 B 的明暗模式与 A 的字号 —— {"themeMode":"dark","size":120}
✓ A 在保存自己改动的同一轮里取回了 B 的明暗模式 —— {"themeMode":"dark","dark":true,"size":120}
✓ B 点「立即同步」后取回 A 的字号，自己的明暗模式不受影响 —— {"size":120,"applied":"120%","themeMode":"dark"}
✓ 选用本地图片后账号里只有 source=local，文件名不上传 —— {"source":"local","file":"Venti1.jpg","localName":"","dim":45,"blur":0,"updatedAt":1794908501637}
✓ A 本机仍然记得文件名并显示这张图片
✓ B 得知账号用的是本地图片，但本机没有该文件：显示默认背景并提示重新选择 —— "local:Venti1.jpg:"
✓ bob 登录后没有套用 alice 的设置 —— {"colorTheme":null,"fontSize":null,"themeMode":null,"lineNumbers":null,"backgroundImage":null,"scene":null,"repository":null,"applied":{"theme":null,"dark":false,"fontSize":null,"image":false}}
✓ bob 有自己的一条评论，alice 的评论原样不动 —— 讨论里的评论作者：alice, bob
✓ GitHub 出错时设置页显示同步失败（设置本身已在本机生效） —— error · 同步失败，稍后会自动重试
✓ 恢复后重新同步成功，账号里是最新的字号 —— synced · 所有设置已保存到 @bob
✓ 退出登录后修改设置：只保存在本机，不再请求 GitHub —— 退出后的请求：无
✓ 访客修改设置：即时生效并保存在本机，不发任何 GitHub 请求 —— 状态卡片：登录 GitHub 后，这一页上的所有设置都会自动保存到你的
✓ 全程没有向仓库写入任何内容（没有 Contents / Git Data / PR 请求，REST 只有 GET） —— REST 请求：GET /user
GraphQL 操作统计： {"SettingsDiscussion":5,"CreateSettingsDiscussion":1,"AddSettingsComment":2,"SettingsComments":5,"SettingsComment":7,"UpdateSettingsComment":4,"SettingsComment (500)":1}
alice 的评论被编辑次数： 3 ；正文长度： 865
alice 的评论正文开头： "<!-- starlog-settings:v1 -->\n这条评论由博客站点自动维护，用来在 @alice 的多台设备之间同步站点设置（配色、字号、字体、背景等）。\n请不要手动修改。删除它不会影响任何设备上已有的设置，下次修改设置时会重新创建。\n\n```json\n{\n  \"version\": 1,\n"
page errors: 0 []

全部检查通过

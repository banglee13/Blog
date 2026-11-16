# 原神数据：7.2 正式服

来源：https://api.lunaris.moe/data/7.2.0/，语言 chs，采集于 2026-11-16。

- catalog.json：页面检索索引；武器星级取 ID 第三位，避免 QUALITY_GREEN 同时对应一星和二星的歧义。
- source-lists.json：源站 charlist.json 和 weaponlist.json 的完整内容。
- characters.json / weapons.json：以原始 ID 为键的完整详情，保留所有嵌套字段和原始数值/字符串。
- characters.gz.base64 / weapons.gz.base64：上述 JSON 的无损 gzip 快照，供页面按需加载和离线内联。
- portraits.json / skill-icons.json：头像、武器、技能图标的 WebP data URI，共 1,821 个。并不包含全部立绘、服装大图或语音音频；这些字段的原始资源标识仍保留在数据中。
- manifest.json：来源、采集时间、数量、缺失项与 SHA-256。

139 个角色条目中包含旅行者的 14 个性别/元素变体、特殊角色记录；不等于 139 位独立可招募角色。138 个条目有详情，10000134（Unknown 元素、WEAPON_CROSSBOW 的特殊旅行者）的详情返回 HTTP 404，未用测试服数据替代。257 个武器条目均有完整详情，包括源站任务等特殊条目。

本快照完全采用 7.2.0 目录，不导入 7.2.50 / 7.2.51。源站没有逐项可获取性标记，因此不对目录中每个特殊条目的玩家获取途径作额外推断。语音部分为返回的语音文本，未抓取音频文件。

在仓库根目录运行 npm run genshin:verify 校验；npm run genshin:sync 可重新抓取固定正式服快照。游戏资料与图片版权归原权利人所有。

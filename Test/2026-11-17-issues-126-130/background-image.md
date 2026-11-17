# issue #126 · 固定背景图片（原始输出）

真实 Chromium（1280×800）。每行是一个步骤之后读到的状态：`pref` 是保存的偏好，`shown` / `src` / `covers` 是背景图层是否存在、
图片地址与铺满的尺寸，`scrimOpacity` / `scrimColor` 是遮罩，`canvas` 表示是否存在动态背景画布。

初始: {"pref":null,"shown":false,"src":null,"natural":null,"covers":null,"opacity":null,"filter":null,"scrimOpacity":null,"scrimColor":null,"canvas":false,"position":null}
可选项: ["不使用图片","Venti1","选择本地图片…"]
选择仓库图片 Venti1 后: {"pref":{"source":"repo","file":"Venti1.jpg","localName":"","dim":45,"blur":0},"shown":true,"src":"/Blog/assets/Venti1-CkU5ETGU.jpg","natural":"4000x2794","covers":"1270x800","opacity":"1","filter":"none","scrimOpacity":"0.45","scrimColor":"rgb(251, 251, 253)","canvas":false,"position":"fixed"}
刷新后（深色）仍然启用: {"pref":{"source":"repo","file":"Venti1.jpg","localName":"","dim":45,"blur":0},"shown":true,"src":"/Blog/assets/Venti1-CkU5ETGU.jpg","natural":"4000x2794","covers":"1270x800","opacity":"1","filter":"none","scrimOpacity":"0.45","scrimColor":"rgb(13, 16, 23)","canvas":false,"position":"fixed"}
页面下滚后背景图片的位置: {"before":0,"after":{"top":0,"scrollY":600}}
同时选了动态背景「樱花」: {"pref":{"source":"repo","file":"Venti1.jpg","localName":"","dim":45,"blur":0},"shown":true,"src":"/Blog/assets/Venti1-CkU5ETGU.jpg","natural":"4000x2794","covers":"1270x800","opacity":"1","filter":"none","scrimOpacity":"0.45","scrimColor":"rgb(13, 16, 23)","canvas":false,"position":"fixed"}
遮罩 20% · 模糊 8px: {"pref":{"source":"repo","file":"Venti1.jpg","localName":"","dim":20,"blur":8},"shown":true,"src":"/Blog/assets/Venti1-CkU5ETGU.jpg","natural":"4000x2794","covers":"1346x848","opacity":"0.994342","filter":"blur(8px)","scrimOpacity":"0.2","scrimColor":"rgb(251, 251, 253)","canvas":false,"position":"fixed"}
改回「不使用图片」: {"pref":{"source":"none","file":"Venti1.jpg","localName":"","dim":20,"blur":8},"shown":false,"src":null,"natural":null,"covers":null,"opacity":null,"filter":null,"scrimOpacity":null,"scrimColor":null,"canvas":true,"position":null}
选择本机图片后: {"pref":{"source":"local","file":"Venti1.jpg","localName":"Venti1.jpg","dim":20,"blur":8},"shown":true,"src":"blob:/f1913bdc-e4c2-4a05-9c71-f536ffbfe742","natural":"2880x2012","covers":"1346x848","opacity":"1","filter":"blur(8px)","scrimOpacity":"0.2","scrimColor":"rgb(251, 251, 253)","canvas":false,"position":"fixed"}
可选项: ["不使用图片","Venti1","本地 · Venti1.jpg ✓"]
浏览器存储（IndexedDB）里的本机图片: {"name":"Venti1.jpg","type":"image/jpeg","kb":770}
刷新后本机图片仍然显示: {"pref":{"source":"local","file":"Venti1.jpg","localName":"Venti1.jpg","dim":20,"blur":8},"shown":true,"src":"blob:/47932183-3623-434d-b553-b3cc8bf03bcd","natural":"2880x2012","covers":"1346x848","opacity":"1","filter":"blur(8px)","scrimOpacity":"0.2","scrimColor":"rgb(251, 251, 253)","canvas":false,"position":"fixed"}
移除本机图片后: {"pref":{"source":"none","file":"Venti1.jpg","localName":"","dim":20,"blur":8},"shown":false,"src":null,"natural":null,"covers":null,"opacity":null,"filter":null,"scrimOpacity":null,"scrimColor":null,"canvas":false,"position":null}
偏好为本地图片但本机没有文件: {"pref":{"source":"local","file":"","localName":"holiday.jpg","dim":45,"blur":0},"shown":false,"src":null,"natural":null,"covers":null,"opacity":null,"filter":null,"scrimOpacity":null,"scrimColor":null,"canvas":false,"position":null,"hint":"这个账号在另一台设备上选用了本地图片「holiday.jpg」，图片文件不会随账号同步：请在这台设备上重新选择，或改用上"}
page errors: 0 []

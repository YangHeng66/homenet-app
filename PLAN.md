# HomeNet：通用家庭网络控制 App（安卓）

> 状态（2026-11-11）：M0 已完成（第 11 节）；M1 的连接器（第 12 节）和向导、多配置、Keystore、扫码导入导出（第 13 节）都已完成，**还没连过真实设备**。界面以 [设计稿 v2](../tr3000-dash/design/control-v2.html) 为准（已和用户逐页确认）。
> 取代 [tr3000-dash/IMPLEMENTATION.md](../tr3000-dash/IMPLEMENTATION.md) 里“网页放在路由器上”的方案。

## 1. 目标

- **通用**：别人装上 APK，在设置向导里填自己的地址和密码就能用。App 里不内置任何人的 IP、节点名、订阅地址。
- **支持的设备**：
  - OpenWrt 路由器：用系统自带的 rpcd，免安装
  - mihomo 内核：nikki、OpenClash 或任何开了控制接口的 mihomo
  - 可选：装了 UFI-TOOLS 的中兴 F50，以及同类随身 WiFi
- **只做安卓**，iOS 以后再说。
- **省内存、流畅**：中端机上冷启动和切页都不卡，放在后台时几乎不耗电。

## 2. 技术栈

| 部分 | 选择 | 理由 |
|---|---|---|
| 外壳 | Capacitor（安卓） | 用系统 WebView 渲染，设计稿的 HTML/CSS/SVG 可以原样还原；提供原生网络请求、安全存储、通知 |
| 界面 | **Svelte 5 + TypeScript + Vite** | Svelte 编译成原生 DOM 操作，没有虚拟 DOM 运行时。在各框架里包最小、占内存最少，同时又能拆组件，比纯原生 JS 好维护 |
| 网络请求 | CapacitorHttp（原生请求） | 绕开 WebView 的跨域限制，才能直连路由器、mihomo、F50 |
| 密码存储 | 安卓 Keystore（安全存储插件，实现时再选具体插件） | 密码和密钥不以明文落盘 |
| 图表和插画 | 手写 SVG（沿用设计稿） | 不引入图表库，体积和内存都小 |
| 字体 | Bricolage Grotesque + Geist Mono 子集 woff2，打包进 APK | 不依赖外网，只放用到的字 |
| 测试 | Vitest 测连接器和签名算法；浏览器里用 mock 点界面；MuMu 模拟器或真机装 APK 验证 | |

**本机要先装的东西（每项装之前都先征得同意）**：
- Node 20 以上（现在是 18）
- JDK 21（现在是 1.8）
- Android SDK 命令行工具，或 Android Studio

可以用现有的 MuMu 模拟器（自带 adb）装 APK 测试。

## 3. 设计还原和适配

- **还原度**：WebView 就是 Chromium，和设计稿在 Chrome 里看到的一样。颜色、字体、动效、磁贴、SVG 都能做到 1:1。
- **屏幕尺寸**：
  - 手机（360–430dp）：单列，底部悬浮导航
  - 平板、折叠屏展开（600dp 以上）：两列加左侧导航，沿用设计稿的宽屏布局
  - 横屏同样走宽屏布局
- **安卓特有的处理**：
  - 全面屏手势条和刘海：开启 edge-to-edge，用安全区域内边距
  - 返回键/手势：依次关闭弹窗 → 退回上一页 → 再按一次退出
  - 状态栏颜色跟着深浅色变化
  - 系统深浅色：WebView 的 `prefers-color-scheme` 跟随系统；关闭强制深色，避免系统二次反色
  - 系统字体放大：限制在 85%–130% 之间按比例缩放，避免磁贴被撑破
  - 软键盘：弹出时输入框不被遮挡
- **触感**：危险操作长按时伴随震动，成功或失败也有轻微震动反馈。

## 4. 性能和内存

| 指标 | 目标 |
|---|---|
| APK 体积 | < 10 MB |
| JS 包（gzip） | < 120 KB |
| 冷启动到首页出数据 | 中端机 < 1.5 秒 |
| 内存 | 以 Android Studio Profiler 实测为准；WebView 类 App 通常在 100 MB 上下，用下面的做法尽量压低 |
| 后台耗电 | 退到后台立即停止所有轮询和动画 |

做法：
- **只渲染当前页**：切页时销毁其他页面的 DOM 和定时器，不把四页都留在内存里。
- **一个定时器统一轮询**：回到前台才启动，间隔可设（2/5/10 秒），页面隐藏或 App 进后台时停止。
- **图表原地更新**：网速曲线只改 SVG 的 path 数据，点数固定（48 个），不重建节点。
- **动画只用 transform/opacity**：
  - 链路光点、雷达波纹用 CSS 动画，屏幕外自动暂停
  - 系统开启“减少动画”时全部关闭
- **毛玻璃要节制**：只用在底部导航一个元素上；设置里提供“省电模式”，关掉毛玻璃和装饰动画。
- **长列表只渲染可见部分**：实时连接、节点列表超过 100 条时用虚拟列表。
- **不引入大依赖**：没有 UI 组件库、图表库、moment 之类。

## 5. 架构

```
Svelte 界面
  └─ store（当前配置、各模块状态、轮询）
       └─ 连接器（同一套接口，各自实现）
            ├─ OpenWrtRpc   POST http://<路由器>/ubus  （rpcd JSON-RPC，session.login）
            ├─ Mihomo       http://<地址>:<端口>  Bearer <secret>
            ├─ Ufi          http://<F50>:2333  （UFI 签名：sha256 口令 + kano-sign）
            ├─ Plugin       可选：路由器装了 homectl 插件时启用进阶功能
            └─ Mock         ?mock=1 / 演示模式，用设计稿里的假数据
```

### 免安装能做到的（M1 的范围）

| 功能 | 怎么做 |
|---|---|
| 代理：模式、分组切换、测速、实时连接、断开连接、订阅（provider）更新 | mihomo 控制接口 |
| 重点线路卡（原“Claude 出口卡”，通用化） | 用户选一个分组，填期望出口 IP 和核对地址；经 mihomo 测试 |
| 网址走哪里 | 用 mihomo 的规则列表在 App 里匹配常见规则类型（DOMAIN / SUFFIX / KEYWORD / GEOSITE 名称），匹配不了的提示“需要插件实测” |
| 路由器：状态、在线设备、Wi-Fi 开关和信道、重启、重启网络 | rpcd（ubus / uci） |
| 改 Wi-Fi、信道时自动回滚 | OpenWrt 自带的“改完不确认就回滚”（rpcd 的 uci apply rollback + confirm，就是 LuCI 保存时的倒计时） |
| F50：信号、温度、流量、锁频、Wi-Fi、USB 模式、制式、重启 | UFI-TOOLS 接口；具体参数要在真机上抓包确认（见第 8 节） |
| F50 锁频、制式改坏时自动恢复 | 没装插件：App 用 root 会话经 rpcd 在路由器 `/tmp` 起一个一次性看门狗（到点检测，不通就写回），重启即消失、不留痕迹，**要先验证可行**；行不通就退回“没装插件时要二次确认，且提示无法自动恢复” |

### 需要可选插件的（M3）

单设备限速和暂停、我的规则写进订阅、告警和定时任务（要求手机关了也在跑）、流量日历落盘、备份恢复。

插件就是 `tr3000-dash/rpcd/` 里已经写了一部分的 `homectl`，改成通用可安装包：配置放进它自己的 uci 配置，不写死任何 IP 或分组名。没装插件时，App 里这些功能显示“需要在路由器上安装 HomeNet 插件”，并附安装说明。

## 6. 配置和通用化

- **首次设置向导**：
  1. 填路由器地址和 root 密码（或自建的受限账号）
  2. App 自动检测：rpcd 能否登录、有没有 nikki/OpenClash（读 uci 拿到 mihomo 地址和密钥）、有没有 F50/UFI-TOOLS、有没有装插件
  3. 只显示检测到的模块，没有的整块隐藏
- **多套配置**：家里、公司等可以切换。
- **扫码导入导出**：配置生成二维码，方便发给别人。默认不包含密码；要包含时用口令加密。
- **原来只适合用户自己的功能改成可配置**：
  - Claude 出口卡 → 重点线路卡（可以有多张）
  - DMIT 线路链 → 任意 fallback 分组的切换链可视化
  - 场景 → 用户自定义，几个内置模板可选
  - EEE、WAN 看门狗 → 放进插件里的“网口”设置
- **演示模式**：没有设备的人也能先看看界面（mock 数据）。

## 7. 安全

- 密码、密钥只存在 Keystore；导出的配置默认不带密码。
- 默认只允许局域网和 Tailscale 地址（10/8、172.16/12、192.168/16、100.64/10）。填公网地址时警告：明文 HTTP，密码会被看到。
- 危险操作：界面上长按确认，App 内同一时间只允许一个回滚事务。
- 不收集任何数据，不连接开发者的服务器。

## 8. 回家后才能做的验证

| 项目 | 验证内容 |
|---|---|
| F50 新接口 | Wi-Fi 开关、USB 模式、制式、指示灯、ADB、漫游、飞行模式，抓 UFI 前端实际发的请求 |
| rpcd 回滚 | `uci apply` 带 rollback、`uci confirm` 在 25.12 上是否可用 |
| 临时看门狗 | root 会话能否 `file.exec` 起后台进程 |
| 原生请求 | 是否能直连 UFI 的 2333 端口、mihomo 9090 端口和 `/ubus` |

## 9. 里程碑和会话拆分

| 阶段 | 内容 | 需要设备 |
|---|---|---|
| **M0 工程和界面** | 搭 Capacitor + Svelte 工程；四页按设计稿 1:1 还原（mock 数据）；适配和性能做法落实；打出 debug APK，在 MuMu 里能装能点 | 否 |
| **M1 连接器和向导** | 写 Mihomo / OpenWrtRpc / Ufi 三个连接器和单测（UFI 签名用 `tr3000-dash/www/cgi-bin/dash` 的结果对照）；完成设置向导和多配置 | 写代码不需要，联调需要 |
| **M1 联调** | 第 8 节的验证，逐个功能真机测试 | 是 |
| **M2 回滚和提醒** | 回滚事务、前台通知、后台定期检查（WorkManager 最短 15 分钟一次） | 是 |
| **M3 插件** | homectl 改成通用可选包，App 接进阶功能 | 是 |
| **发布** | 签名 APK、使用说明；放到哪里分发先问用户 | 否 |

M0 和 M1 的连接器部分可以并行：M0 负责 `src/ui/` 和工程，M1 只写 `src/lib/connectors/`（纯 TypeScript，不碰界面）。连接器的接口类型由 M0 先在 `src/lib/types.ts` 定好。

## 10. 已有代码怎么处理

- `tr3000-dash/www/dash/` 里前端会话写的半成品：`app.css` 可以拿来参考设计稿样式；`index.html`、`js/` 不再用。原来的只读面板已改名为 `legacy.*`，路由器上那份不受影响。
- `tr3000-dash/rpcd/homectl.uc` 等：留着，M3 时改成通用插件。

## 11. M0 进度（2026-11-10）

### 做了什么

- **环境**（都没有改系统环境变量）：
  - Node 用本机 nvm 里已有的 22.14（Capacitor 8 要求 ≥ 22，不是方案里写的 20）
  - JDK：Temurin 21.0.13，解压在 `D:\JDKjava\jdk-21.0.13+9`，只在 `android/gradle.properties` 里用 `org.gradle.java.home` 指过去
  - Android SDK：`D:\Android\Sdk`（cmdline-tools、platform-tools、platforms;android-36、build-tools 36.0.0；Gradle 构建时又自动装了 build-tools 35.0.0），路径写在 `android/local.properties`
  - Gradle 8.14.3：GitHub 下载 504，改从腾讯云镜像下载，sha256 和官方一致后放进 `~/.gradle` 缓存；工程里的下载地址仍是官方的
- **工程**：Capacitor 8.6（只有 android）+ Svelte 5.57 + TypeScript 6.0 + Vite 8.3。运行时依赖只有 `@capacitor/core`、`android`、`app`（返回键、前后台）、`haptics`（震动）。状态栏用 Capacitor 8 核心自带的 SystemBars，没装 `@capacitor/status-bar`。
- **接口类型**：[src/lib/types.ts](src/lib/types.ts) 定了 `MihomoConnector` / `OpenWrtRpcConnector` / `UfiConnector` / `PluginConnector` / `MockConnectors` 和全部返回类型，以及 `Rollback`（可回滚事务）、`Profile`、`KeyLine`（重点线路）。单位约定写在文件头。错误统一抛 [src/lib/errors.ts](src/lib/errors.ts) 的 `ConnectorError`。
- **mock**：[src/lib/mock/index.ts](src/lib/mock/index.ts) 实现全部四个接口。IP 用文档保留网段（203.0.113.x、198.51.100.x）和 192.168.1.x，节点名、订阅名、Wi-Fi 名都是示例。
- **界面**：四页（首页 / 代理 / 设备含 F50 和路由器 / 更多）、长按确认面板、回滚倒计时坞、设备详情和新建任务底部面板、toast。样式直接取自设计稿的 CSS（[src/app.css](src/app.css)），和设计稿并排比对过，375 宽下各区块的位置和高度一致。
- **通用化**：Claude 出口卡 → 重点线路卡（读 `profile.keyLines`）；DMIT 链 → 重点线路当前所选 fallback 分组的切换链；“这个网址走哪里”改成用 mihomo 规则在 App 里匹配（[src/lib/rules.ts](src/lib/rules.ts)），GEOSITE / RULE-SET 只能按分类名推测，界面上会标出来；没有 F50、没有插件时相应的卡片和控件整块不渲染。
- **适配**：
  - edge-to-edge + 安全区（Capacitor 注入的 `--safe-area-inset-*`）
  - 返回键：关面板 → 回首页 → 再按一次退出
  - 状态栏图标随深浅色；主题用 DayNight，关闭了系统强制深色
  - 系统字体放大：WebView 的 textZoom 固定 100，页面按 0.85–1.3 整体缩放；窄屏再收紧，保证等效宽度不低于 340dp
  - 600dp 以上（平板、折叠屏、横屏）走左侧导航 + 两列
  - 软键盘 `adjustResize`
- **性能做法**：
  - 只渲染当前页（DOM 里始终只有一个 `main.page`）
  - 全 App 一个轮询定时器（[src/lib/poll.ts](src/lib/poll.ts)），间隔 2/5/10 秒可设，进后台即停、回前台立刻补一拍
  - 网速和信号曲线只改 `path` 的 `d`，点数固定
  - 设计稿里的 SMIL 动画改成只动 transform/opacity 的 CSS 动画，滚出屏幕和进后台时暂停
  - 毛玻璃只留在底部导航；设置里有省电模式（关毛玻璃和装饰动画）
  - 快照用 `$state.raw`
  - 实时连接最多渲染 100 条
- **兼容**：MuMu 的系统 WebView 是 Chromium 110，不支持 `color-mix()`，已把设计稿里的 17 处预先算成颜色变量。构建目标 chrome100。
- **字体**：Bricolage Grotesque（可变字重 + opsz）和 Geist Mono 裁成只含 ASCII 和几个符号的子集，42 KB + 8 KB，打包在 APK 里，不引用外网。许可（OFL 1.1）在 `public/fonts-OFL.txt`。重新裁剪：`npm run fonts`（源字体在 `scripts/fonts-src/`）。

### 实测

| 指标 | 目标 | 实测 |
|---|---|---|
| debug APK | < 10 MB | **3.96 MB**（4,155,151 字节，未混淆未签名） |
| JS（gzip） | < 120 KB | **67.8 KB**（原始 188 KB）；CSS 8.8 KB gzip；字体 50.8 KB |
| 冷启动到首页出数据 | < 1.5 秒 | 手机竖屏 5 次：**718–926 ms**；平板横屏 5 次：585–807 ms（其中 Activity 首帧 490–780 ms） |
| 内存 | 以实测为准 | 见下 |

冷启动的量法：`am force-stop` 后记下设备时间再 `am start -W`，页面在首页数据画出的那一帧打 `performance.mark('homenet-first-data')`，两者相减。数据是 mock，真实设备还要加上网络请求的时间。

内存（PSS，1080×2340 深色，首页停留 30 秒）：

| 进程 | PSS | 其中私有脏页 |
|---|---|---|
| App 主进程 | 约 115 MB | 49 MB |
| WebView 渲染进程 | 约 120–130 MB | 43–56 MB |

- 四页都逛一遍后没有上涨（主进程 114 MB、渲染进程 120 MB），退到后台 20 秒后 110 + 115 MB。
- 页面自己的 JS 堆 9.5 MB，DOM 约 350 个节点。
- **两个进程合计约 230–245 MB，比方案里估的“100 MB 上下”高。** 大头是 WebView 本身（共享的 Chromium 代码和 x86 模拟器上的图形缓冲），页面自己占得很少。没有量空白 WebView 的基线，所以还分不清有多少是固定开销；真机（ARM）上的数字要另测。
- 注意：在这台模拟器上对渲染进程执行 `adb shell dumpsys meminfo <渲染进程 pid>` 会让它直接崩溃（WebView 110 的问题，复现过两次，App 空闲时不崩）。渲染进程的内存要 `adb root` 后读 `/proc/<pid>/smaps_rollup`。

### 验证过什么

- 浏览器（`npm run dev`，端口 5180）：四页所有按钮、开关、分段控件逐个点过，包括长按（短按和提前松手都不触发）、回滚坞的保留 / 立即恢复 / 自动确认 / 同时只允许一个事务、底部面板、轮询间隔、后台暂停。截图在 [docs/screens/](docs/screens/)：手机 375 深浅色各页、平板 768 深浅色。
- MuMu（Android 15，WebView 110）：装 debug APK，用 `adb shell input` 真实触摸点了四页的主要控件、长按确认、返回键三级行为；试了平板横屏、手机竖屏、手机横屏、系统深浅色、字体放大 1.3 和 2.0、退后台再回来。截图在 [docs/emulator/](docs/emulator/)。测完已把模拟器的分辨率、密度、旋转、深浅色、字体大小改回原样并关机。
- `npm run check`（svelte-check）0 错误 0 警告。

### 没做的

- 真机没测；震动在模拟器上验证不了。
- 这些按钮现在只弹提示：场景“编辑”、设备“改名”、套餐“修改”、网速和信号的历史曲线、访客网络、Tailscale“查看步骤”、设置里的“切换配置”。
- 设置向导、多配置、Keystore 存密码、扫码导入导出：M1。
- “提醒方式”三个选项只是界面，通知和后台检查是 M2。
- 实时连接超过 100 条时是截断显示，还不是虚拟列表；节点列表没做虚拟化。
- 没装 Vitest，[src/lib/rules.ts](src/lib/rules.ts) 的规则匹配还没有单测，建议 M1 写连接器时一起补。
- 应用图标和启动图还是 Capacitor 默认的；包名暂定 `app.homenet.control`，发布前要定。
- release 构建（混淆、签名）没做。
- `npm audit` 有 2 个低危告警，都在开发依赖 deepmerge 上（`@sveltejs/vite-plugin-svelte` 带进来的，不进 APK），上游暂无修复。

### 给 M1 的说明

- 连接器写在 `src/lib/connectors/`，实现 [src/lib/types.ts](src/lib/types.ts) 的接口即可，界面不用改。[src/lib/store.svelte.ts](src/lib/store.svelte.ts) 里 `export const conn: Connectors = mock` 这一行换成按当前配置创建的连接器。
- 界面按 `conn.router / mihomo / ufi / plugin` 是否存在、以及 `plugin.features()` 的返回来决定显示哪些模块。
- 会断网的操作返回 `Rollback`，界面拿到后显示回滚坞；`autoConfirmAfter` 表示由 App 检测网络后自动确认。
- 界面传给连接器的参数可能是 Svelte 的状态代理，连接器里要用 `structuredClone` 的地方先拷成普通对象（`applyBands` 踩过）。
- 常用命令：`npm run dev`、`npm run check`、`npm run build`、`npm run apk`（构建 + 同步 + 打 debug APK，产物在 `android/app/build/outputs/apk/debug/app-debug.apk`）。

## 12. M1 连接器进度（2026-11-10）

状态：三个真实连接器、共用 HTTP 封装和单测已完成，**没有连过任何真实设备**，联调是下一步。界面和 `src/lib/store.svelte.ts` 里的 `conn = mock` 没动。

### 文件

| 文件 | 内容 |
|---|---|
| [src/lib/connectors/http.ts](src/lib/connectors/http.ts) | 共用 HTTP 封装：原生端 `CapacitorHttp`，浏览器 dev 下 `fetch`；统一超时（默认 8 秒）；错误映射；地址白名单 |
| [src/lib/connectors/mihomo.ts](src/lib/connectors/mihomo.ts) | `createMihomo(endpoint, http, opts)` |
| [src/lib/connectors/openwrt.ts](src/lib/connectors/openwrt.ts) | `createOpenWrt(endpoint, http, opts)` |
| [src/lib/connectors/ufi.ts](src/lib/connectors/ufi.ts) | `createUfi(endpoint, http, opts)`，以及 `ufiSign` / `ufiAuth` / `zteAd` / `ztePassword` |
| [src/lib/connectors/hash.ts](src/lib/connectors/hash.ts) | 手写的 MD5 / SHA-256 / HMAC-MD5（`crypto.subtle` 没有 MD5） |
| [src/lib/connectors/index.ts](src/lib/connectors/index.ts) | 工厂 `createConnectors(profile, opts)`：按 `Profile` 里填了的模块创建连接器，返回 `Connectors` |

接入时把 store 里的 `conn` 换成 `profile.demo ? createMockConnectors() : createConnectors(profile)`。`Endpoint.secret` 的含义：路由器是登录密码（配合 `username`），mihomo 是 API secret，UFI 是 UFI-TOOLS 口令；填了就不用再手动调 `login()`，会话过期会自动重新登录一次。

### HTTP 封装

- 错误一律是 `ConnectorError`：连不上 `network`、超时 `timeout`、401/403 `auth`、其他非 2xx `http`（带 `status`）、地址被拦 `blocked`。
- 地址白名单（第 7 节）：IPv4 的 10/8、172.16/12、192.168/16、100.64/10，IPv6 的 fc00::/7 和 fe80::/10。**主机名没法从字面判断，按惯例放行这几种**：单标签名（`router`）、`.lan`、`.local`、`.home.arpa`、`.internal`、Tailscale 的 `.ts.net`；其他一律当公网拦下，请求不会发出去。设置向导可以用导出的 `addressScope(url)` 判断要不要弹“公网地址”警告，用户确认后传 `allowPublic: true`。
- 原生端的两个坑已处理：没有 `Content-Type` 时安卓不会把请求体发出去（封装里总会补上）；响应头名大小写不定（统一转小写）。
- 没用 Capacitor 的 `params`，查询串都自己拼好，避免原生端二次编码。

### mihomo：实现的方法

全部 15 个方法都实现了：`version`、`getMode`、`setMode`、`getProxies`、`select`、`testGroup`、`testNode`、`traffic`、`getConnections`、`closeConnection`、`closeAllConnections`、`getProviders`、`updateProvider`、`getRules`、`checkExit`。

- `traffic()` 和每条连接的 `rate` 都由连续两次 `/connections` 快照相减得出（`/traffic` 是流式接口，普通请求读不到一次采样）。第一次调用速率为 0；内核重启后累计值变小时不出负数。
- `getProxies()`：分组顺序取自 `GLOBAL` 的成员表（`/proxies` 本身是无序对象），`GLOBAL` 自己不返回。分组成员不在 `/proxies` 里时到 proxy-provider 里找，“节点 → provider”缓存 10 分钟，平时只拉用到的 provider。`region` 只从节点名里的国旗 emoji 推出。
- `getRules()`：把接口返回的类型名（`DomainSuffix`、`GeoSite`、`RuleSet`…）换成配置文件写法（`DOMAIN-SUFFIX`…），这样 [src/lib/rules.ts](src/lib/rules.ts) 才能匹配；已禁用的规则不返回。
- `testGroup` / `testNode`：mihomo 用 408/503/504 表示测不通，返回 `null` 而不是抛错。
- **`checkExit` 和任务描述有出入**：mihomo 的控制接口没有“经某个分组请求一个地址并返回正文”的能力。现在的做法是手机自己请求 `checkUrl`（公网地址，单次放行，不带任何凭据），再解析出口 IP。只有手机的流量经过这台 mihomo（连着家里 Wi-Fi 的透明代理），并且规则把 `checkUrl` 的域名分到该分组时结果才对；`group` 参数目前只传给可选的 `opts.fetchExit` 钩子。远程（Tailscale）使用时要换成在路由器上请求（例如经 rpcd 在路由器上跑 `curl -x 127.0.0.1:<mixed-port>`），留到联调时定。支持的响应格式：JSON（`ip` / `query` / `origin` 等常见字段名）、`cdn-cgi/trace`、纯文本 IP。

### OpenWrt：实现的方法

全部 18 个方法都实现了：`login`、`sessionTtl`、`logout`、`board`、`status`、`clients`、`setStaticLease`、`renameClient`、`wifi`、`setWifiEnabled`、`setWifiChannel`、`detectMihomo`、`serviceAction`、`serviceRunning`、`resetWan`、`restartNetwork`、`reboot`、`backup`。

- 依赖路由器上的 `uhttpd-mod-ubus`、`rpcd-mod-file`、`rpcd-mod-iwinfo`、`rpcd-mod-rc`（装了 LuCI 就都有），账号要有 root 等效权限。
- `status()` 一次批量请求（JSON-RPC 数组）；CPU 占用读 `/proc/stat`、WAN 速率读 `network.device status`，都是两次采样相减；温度读 `thermal_zone0`，没有就是 `undefined`。
- `clients()` 两次请求：dnsmasq 租约文件 + `dhcp` 的 host 段 + 无线关联表 + `ip -4 neigh`。无线设备在关联表里就算在线；有线设备看邻居表，读不到邻居表时退回“租约没过期”。**没有插件时拿不到每台设备的速率和今日流量**（`rate` 恒为 0、`todayBytes` 不返回），`isSelf` 也不判断。
- `setWifiEnabled` / `setWifiChannel`：`uci set` → `uci apply {rollback: true, timeout: 90}`，返回的 `Rollback.confirm()` 调 `uci confirm`、`revert()` 调 `uci rollback`；90 秒不确认由 rpcd 自己回滚。确认和回滚不会自动重新登录（rpcd 只认发起 apply 的那个会话）。
- `detectMihomo()`：nikki 读 `nikki.mixin.api_listen` / `api_secret` 和 `nikki.config.enabled`；OpenClash 读 `openclash.config.cn_port` / `dashboard_password` / `enable`。两个都装了选启用的那个。地址用路由器的主机名加控制端口。
- `renameClient()`：名字写进 DHCP 的 host 段，所以只接受合法主机名；中文备注抛 `unsupported`，等 M3 插件。
- `backup()`：`sysupgrade -b /tmp/backup-<主机名>-<日期>.tar.gz`，只返回文件名，没有把文件下载到手机。

### UFI-TOOLS：实现的和待抓包的

签名对照：`ufiSign` / `ufiAuth` / 登录口令算法和 [tr3000-dash/www/cgi-bin/dash](../tr3000-dash/www/cgi-bin/dash) 一致，测试里的期望值由 [scripts/ufi-sign-vectors.mjs](scripts/ufi-sign-vectors.mjs)（Node 自带 crypto，按 dash 的步骤写）算出，和手写哈希互相独立。

接口参数的来源：UFI-TOOLS 公开仓库（`kanoqwq/UFI-TOOLS`）的 `API_Doc.md` 3.13 节和未混淆的前端源码 `app/frontEnd/public/script/main.js`、`requests.js`。第 8 节列的 F50 新接口大部分都能从这里确认：

| 方法 | 状态 | 依据 / 说明 |
|---|---|---|
| `login`、`status`、`bands`、`lockBands`、`redial`、`reboot`、`setData` | 已实现 | dash 和 f50-band-optimizer 在真机上用过的接口 |
| `wifi`、`setWifi({on})`、`setWifi({band})`（2.4 或 5） | 已实现 | `switchWiFiModule` `SwitchOption=0`；`switchWiFiChip` `ChipEnum=chip1/chip2` |
| `usbMode`、`setUsbMode` | 已实现 | `usb_network_protocal` 0/1/2 = 自动/RNDIS/CDC-ECM，`SET_USB_NETWORK_PROTOCAL`（前端提示重启后生效） |
| `rat`、`setRat` | 已实现 | `net_select` / `SET_BEARER_PREFERENCE`：`WL_AND_5G`、`LTE_AND_5G`、`Only_5G`、`Only_LTE` |
| `setRoaming` | 已实现 | `SET_CONNECTION_MODE`，`roam_setting_option` 和 `dial_roam_setting_option` 一起写 |
| `toggles`、`setToggle`（`led`、`adb`） | 已实现 | `INDICATOR_LIGHT_SETTING`、`USB_PORT_SETTING` |
| `sms` | 已实现 | `sms_data_total`，正文 base64；只返回收到的短信 |
| `setToggle('fotaBlock', true)` | 已实现 | `GET /api/disable_fota`（要 ADB 就绪） |
| `setAirplane` | **待抓包**，抛 `unsupported` | 前端和文档里都没有飞行模式接口 |
| `setWifi({band: 'dual'})` | **不支持**，抛 `unsupported` | 前端只有 关 / 2.4G / 5G 三选一 |
| `setWifi({hidden})` | **待抓包**，抛 `unsupported` | 要用 `setAccessPointInfo` 重写整份热点配置（含密码），字段取值没确认 |
| `setToggle('fotaBlock', false)` | **待抓包**，抛 `unsupported` | UFI-TOOLS 只有禁用这一个方向 |
| `speedTest` | **待抓包**，抛 `unsupported` | `/api/speedtest` 是流式下载，只测手机到设备的局域网，没有上行；蜂窝测速走 `/api/proxy`，参数没确认 |

读不到、只能给固定值的字段（代码里都标了“待真机抓包”或说明了来源）：

- `status().airplane` 恒为 `false`；`toggles().fotaBlock` 恒为 `false`（没有读接口）。
- `status().temps.throttleAt` 来自配置项 `throttleAt`，默认 60（F50 的 thermal.conf 第 1 档限速门限），接口读不到。
- `bands().supported.lte` 来自配置项 `lteBands`，默认是 F50 插卡版的频段表（1、3、5、8、34、38、39、40、41）；UFI-TOOLS 只能查 NR 的支持频段。
- `rat()`：接口类型里没有 3G，`WCDMA_AND_LTE`、`Only_WCDMA` 都归到 `lte`。

行为说明：

- 中兴后台会话：先取 UFI-TOOLS 保存的 cookie（`/api/get_cookie`），30 秒内不重复检查登录状态。都失效时用 UFI-TOOLS 里保存的后台密码（`/api/get_official_web_password`）以 `LOGIN_MULTI_USER` 登录一次，并把新 cookie 存回去；登录失败后 10 分钟内不再尝试，避免把账号锁住。
- 写 goform 都带 `AD = SHA256(SHA256(wa_inner_version + cr_version) + RD)`，**十六进制大写**（以公开前端为准；tr3000-dash/rpcd 里那份没验证过的实现是小写）。写操作排队执行。
- `lockBands` / `setRat` / `setData(false)` 返回的 `Rollback` **没有设备端自动恢复**（第 5 节说的路由器看门狗还没验证）。现在由 App 计时，到点没确认就把旧值写回去，只在手机还连得上 F50 的局域网时有效；没有设 `autoConfirmAfter`，“检测到网络通了就自动确认”留给 M2。

### 接口类型改了什么

- [src/lib/types.ts](src/lib/types.ts) 和 [src/lib/mock/index.ts](src/lib/mock/index.ts) **没有改**。
- [src/lib/errors.ts](src/lib/errors.ts)：`ConnectorErrorKind` 加了 `'blocked'`（地址不在允许范围）。
- 建议以后动界面时一起调整的类型（这次没动，因为界面在用）：`UfiDeviceToggles.fotaBlock` 和 `UfiStatus.airplane` 改成可选；`UfiWifiBand` 去掉 `'dual'`；`MihomoConnector.checkExit` 的 `group` 语义按上面说的重新定。

### 测试

`npm test`（Vitest 5.1，node 环境，[vitest.config.ts](vitest.config.ts)）：7 个文件 133 个用例全绿；`npm run check` 0 错误；`npm run build` 通过，包体积没变（连接器还没被界面引用）。

- 假的 HTTP 层在 [src/lib/connectors/__tests__/fake-net.ts](src/lib/connectors/__tests__/fake-net.ts)：把样例响应喂给真实的 `createHttp`，错误映射也一起测到。
- 样例响应按文档和源码里的结构手写，**不是从真机录的**；字段名对不对要靠联调确认。
- [src/lib/rules.test.ts](src/lib/rules.test.ts) 补了规则匹配的单测。顺带发现 `normalizeHost` 对带用户名的网址（`https://user@example.com`）会取到 `user`，没有改。

### 联调时要验证

原生请求

- 安卓上 `CapacitorHttp` 能否直连 `/ubus`、mihomo 9090、UFI 2333；`PATCH`（改模式）和 `DELETE`（断开连接）能否发出去。
- 超时和断网时原生端报的错误能否被认成 `timeout` / `network`（现在按 Java 异常类名里有没有 timeout 判断）。
- mihomo 分组名带中文和 emoji 时，URL 编码后的路径原生端有没有被二次编码。

mihomo

- `/providers/proxies` 的 `subscriptionInfo`（`Upload` / `Download` / `Total` / `Expire`）和 `updatedAt` 实际长什么样。
- 分组成员不在 `/proxies` 里的情况（dash 里遇到过）用 provider 补全是否正确，整份 provider 有多大。
- `checkExit` 在家里 Wi-Fi 下的结果对不对；定下远程时的方案。

OpenWrt（25.12）

- `uci apply` 带 rollback、`uci confirm`、`uci rollback` 是否如预期；关掉手机正连着的那个射频时，90 秒后是否自动恢复。
- root 会话能否 `file read` `/proc/stat`、`/tmp/dhcp.leases`，能否 `file exec` `/sbin/ip` 和 `/sbin/sysupgrade`。
- `iwinfo freqlist` 用射频名（`radio0`）当 `device` 是否可用（射频关闭时没有接口名）；`network.wireless status` 里 `band`、`disabled`、`interfaces[].ifname` 的实际字段。
- `rc init` 能否重启 nikki；`service list` 里 nikki / OpenClash 的实例名；`detectMihomo` 读到的端口和 secret 能否直接连上。
- 会话过期时的返回是不是 JSON-RPC 错误 `-32002`（自动重新登录靠它判断）。
- `network restart` / `system reboot` 发出后，请求是返回还是断开（两种都当成功处理）。

UFI-TOOLS / F50

- 写 goform 的 `AD` 大写是否被接受（第一个要验证的，所有写操作都靠它）。
- 表里“已实现”但真机没用过的写操作逐个试：Wi-Fi 开关和切频段、USB 模式、制式、漫游、指示灯、有线 ADB、`disable_fota`。
- `queryWiFiModuleSwitch,queryAccessPointInfo` 返回的字段名（`ResponseList[].ChipIndex` / `AccessPointSwitchStatus` / `SSID` / `ApBroadcastDisabled`）。
- `cpu_temp_list` 里各温区的名字（现在按 board / soc / nr / pa 模糊匹配，匹配不上就用 `cpu_temp`）和单位。
- 中兴后台登录用 `LOGIN_MULTI_USER` 还是 `LOGIN`；登录成功时 `result` 的值。
- 短信时间最后一段时区的单位（现在按手机本地时区解释）。
- 抓包补上：飞行模式、隐藏 SSID、蜂窝测速。
- 第 5 节的一次性看门狗能否做成；做成后 `lockBands` / `setRat` 的 `Rollback` 改成设备端恢复。

### 没做的

- 设置向导、多配置、Keystore、store 接入真实连接器：M1 的后半部分。
- `PluginConnector`（M3）。
- `backup()` 的文件下载、每台设备的速率和流量（要插件）。

## 13. M1 后半进度（2026-11-11）

状态：不需要设备的部分都做完了——多配置和 Keystore、store 接入真实连接器、错误和空状态、设置向导、切换配置、改名、扫码导入导出。**仍没有连过真实设备**，真实连接器只在单测（假 HTTP 层）和本机假服务里跑过。

### 做了什么

- **配置存储**（[src/lib/profiles.ts](src/lib/profiles.ts)）：地址、账号、重点线路存 localStorage；密码和 secret 按 `homenet.secret.<配置 id>.<router|mihomo|ufi>` 存进 SecretStore，普通存储里没有任何密码。演示配置是内置的一套（不能改、不能删）。删掉当前配置回到欢迎页。
- **安全存储**（[src/lib/secure.ts](src/lib/secure.ts)）：安卓上用插件写 Keystore；浏览器 dev 下只放内存（**不用**插件自带的明文 localStorage 退路），向导和配置页会提示“刷新后要重新填写”。
- **store 接入真实连接器**（[src/lib/store.svelte.ts](src/lib/store.svelte.ts)）：`conn` / `keyLine` 改成随当前配置替换的 `export let`；`activate(profile)` 按 `profile.demo ? createMockConnectors() : createConnectors(profile, { allowPublic })` 创建，`mock.tick()` 只在演示模式挂上。切换时：
  - 旧连接器用 [src/lib/session.ts](src/lib/session.ts) 的 `fence()` 包一层，切走后还没回来的请求结果作废（抛 `StaleError`），不会写进新配置的快照；
  - 清空所有快照，App 用 `{#key store.session}` 整页重建，旧页面登记的轮询随之注销；
  - 有回滚事务在等确认时不允许切换。
- **错误和空状态**：
  - 每个模块的最近一次结果记在 `store.health`（`track()` 包住所有刷新函数，失败只记录不往外抛，一个模块挂了不影响别的模块）。
  - `describeError()` 把 `ConnectorError` 翻译成标题 + 建议：连不上 / 没有响应 / 密码（secret、口令）不对 / 地址被拦 / 设备返回错误（带 HTTP 状态码）/ 设备报错 / 暂不支持。
  - 首页顶部错误卡（第一张完整、其余紧凑），设备页、代理页在没数据时显示错误卡或“正在连接”；标题栏的状态行跟着变红。错误卡上有“重试 / 修改配置 / 切换配置”。
  - 连续失败的模块退避重试（5 秒起翻倍，最长 60 秒，点“重试”或切换配置立即清零），离线时不会每 2 秒等满 8 秒超时、也不刷屏日志。
  - 配置里没有的模块：代理页、设备页显示“这套配置没有填 …”和“修改配置”。
- **暂不支持的 F50 操作**：`UfiConnector.limits` 列出原因，界面据此把飞行模式、隐藏 Wi-Fi 名称显示为灰掉的开关 + 原因；“测速”磁贴显示“暂不支持”，点了提示原因；读不到“拦截系统更新”状态时改成“拦截”按钮，取消拦截给出原因。频段只剩 2.4G / 5G 二选一。
- **设置向导**（[src/ui/screens/Wizard.svelte](src/ui/screens/Wizard.svelte)，表单逻辑在 [src/lib/wizard.ts](src/lib/wizard.ts)）：欢迎页（连接设备 / 扫码或粘贴导入 / 先看演示）→ 路由器（地址、账号、密码，`board()` 验证）→ 代理（连上路由器后自动 `detectMihomo()`，也可手动填，`version()` 验证）→ F50（可选，`status()` 验证）→ 重点线路（只在有代理时出现；从 `getProxies()` 的分组里选，填期望出口、核对地址、域名）→ 保存。只填 IP 时自动补 `http://` 和默认端口（mihomo 9090、UFI 2333）。任何一步的地址不在局域网 / Tailscale 时，输入框下先提示，连接前再弹长按确认的“公网地址，明文 HTTP 密码会被看到”，确认后才 `allowPublic`；保存前再查一遍。改了地址或密码之前的测试结果作废。编辑现有配置和导入配置也走这个向导（预填）。
- **切换配置**（[src/ui/screens/Profiles.svelte](src/ui/screens/Profiles.svelte)）：设置里“当前配置 · 切换”打开；列表里点一下切换，每套可编辑、分享、删除；新建、导入。返回键先让向导退一步，再关页面（页面栈：从配置页进导出、向导，返回回到配置页）。
- **设备改名**：详情面板里的输入框，只允许合法主机名（字母、数字、连字符，最长 63），中文直接禁用“保存”并说明“名字会写进 DHCP 主机名，中文备注要等路由器插件”；调 `router.renameClient`。
- **扫码导入导出**（编解码在 [src/lib/share.ts](src/lib/share.ts)，二维码在 [src/lib/qr.ts](src/lib/qr.ts)）：
  - 不带密码：`homenet:1:<base64url(JSON)>`；带密码：`homenet:1e:<base64url(盐 16 | IV 12 | 密文)>`，PBKDF2-SHA256 15 万次派生 AES-256-GCM 密钥，口令至少 6 位。都不带配置 id、演示标记和公网放行（导入后要重新确认）。
  - 导入是系统边界：逐字段校验、只取认识的字段，地址必须是 http/https，mihomo 类型只认三种，至少要有一个模块。
  - 导出页：二维码（白底黑块、M 级纠错）+ 文本 + 复制；导入页：扫码、粘贴、口令。导入后进向导预填，用户补密码、测试后才保存。
  - 扫码插件只在点“扫描”时动态加载（它的入口顶层就引了约 400 KB 的 html5-qrcode），首屏包不变大太多。
- **顺手修**：`normalizeHost('https://user@example.com')` 取到 `user` 的问题（先补了 4 个失败用例再修）。

### 选了哪些依赖，为什么（都经用户同意后安装）

| 依赖 | 版本 | 用途 | 理由 |
|---|---|---|---|
| `capacitor-secure-storage-plugin` | 0.13.0 | Keystore 存密码 | MIT，只依赖 `@capacitor/core`，字符串 API 正好够用。安卓实现：AndroidKeyStore 里生成 RSA 密钥对（私钥不可导出），值用 RSA/ECB/PKCS1 加密后存 SharedPreferences，**单个值上限约 245 字节**，密码和 secret 够用。`@aparajita/capacitor-secure-storage` 8.x 把 `@capacitor/ios`、`@capacitor/keyboard` 写成了硬依赖，没选 |
| `@capacitor/barcode-scanner` | 3.1.3 | 扫码 | Capacitor 官方，原生全屏扫码界面；安卓用 ZXing 模式，不依赖 Google Play 服务（MuMu 能用）。代价：要求 minSdk 26（[android/variables.gradle](android/variables.gradle) 已从 24 改成 26，即安卓 8.0 起），原生依赖里带了 ML Kit、CameraX、Compose，APK 变大（见下） |
| `uqr` | 0.1.3 | 生成二维码 | unjs 出品，MIT，零依赖，直接输出 SVG，进包几 KB |

### 接口类型改了什么

- `Profile` 加 `allowPublic?: boolean`（用户确认过公网地址）。
- `UfiWifiBand` 去掉 `'dual'`（F50 只能二选一）；mock 的初始频段改成 `'5'`。
- `UfiStatus.airplane`、`UfiDeviceToggles.fotaBlock` 改成可选，真实连接器读不到就不返回（原来恒为 `false`）。
- `UfiConnector` 加只读的 `limits?: Partial<Record<UfiLimit, string>>`（`'airplane' | 'hidden' | 'fotaUnblock' | 'speedTest'` → 给用户看的原因）；真实 UFI 连接器填了这四项，mock 不填。对应改了 [ufi.ts](src/lib/connectors/ufi.ts) 和它的单测。其余连接器逻辑没动。
- `MihomoConnector.checkExit` 的 `group` 语义没动（见第 12 节）。

### 测试和验证

- `npm test`：12 个文件 209 个用例全绿（新增 profiles 12、share 11、session 13、validate 27、wizard 8，ufi 改 3 个，rules 加 4 个）。`npm run check` 0 错误 0 警告。`npm run build` 通过：主包 282 KB（gzip 101.8 KB，原来 67.8 KB，增加的主要是三个真实连接器——以前没被界面引用、被摇树摇掉了——和新页面）；扫码插件单独一个 372 KB 的懒加载块。
- 浏览器（375 宽，深浅色）逐个点过：欢迎页 → 演示模式；重启后记住当前配置；新建配置填 `192.168.250.250` → 8 秒后“路由器没有响应”；填 `203.0.113.10` → 输入框提示 + 长按确认面板，取消则不连接、确认后才发请求；保存后首页三张错误卡、标题栏变红；错误卡“修改配置”进向导且预填；切到演示模式后旧请求没串进来；设备页、代理页的错误卡和空状态；导出（不带密码 / 口令太短 / 带密码加密）→ 用 ZXing 把页面上的二维码解回来和原文一致 → 导入（非 HomeNet 文本、要口令、口令错、口令对 → 进向导预填）；删除当前配置回欢迎页；改名（中文禁用、合法名字保存成功）；F50 的四个暂不支持项（在 dev 页里给演示连接器临时挂上 `limits` 看渲染）。
- 为了在浏览器里看到“密码不对”“HTTP 错误”和一次完整的成功路径，在会话草稿目录起过两个本地假服务（一律回 401 / 404 的，和只回 `/version`、`/proxies` 等基本 JSON 的假 mihomo），没有放进仓库。
- 宽屏（1200 宽、MuMu 横屏平板）下全屏页面原来跟着 `.page` 分成两列，进度条跑到右栏，已改成始终单列。
- **MuMu（Android 15，WebView 110）装 debug APK 验证过**：
  - Keystore：向导里填路由器和 F50 密码保存后，`shared_prefs` 里只有 `homenet.secret.<id>.router/ufi` 两条密文，整个 App 数据目录（含 WebView 的 localStorage）里搜不到明文密码；强制停止再打开，编辑配置时两个密码都读回来了。
  - 原生请求下离线地址被识别为“没有响应”（超时），错误卡正常。
  - 扫码：点“扫描”弹出相机权限 → 原生全屏扫码界面（ZXing）；点关闭回到导入页、不报错。**模拟器没有真实摄像头，实际识别没验证**（同一个 ZXing 引擎在浏览器里把我们生成的二维码解对了）。
  - 发现并修了：首屏原来要等所有模块请求结束才渲染，设备离线时白屏 8 秒；现在最多等 1.2 秒就先渲染，“正在连接”和错误卡随后出来。
  - 测完已清掉 App 数据、关掉模拟器。

### APK 体积

加了扫码插件后 debug APK 从 3.96 MB 涨到 35.7 MB，原因是插件硬带的 ML Kit 原生库 `libbarhopper_v3.so`（四个架构共约 20 MB）和 Compose / CameraX / Kotlin 让 dex 涨到 32 MB。处理（用户让我自行选方法）：

- [android/app/build.gradle](android/app/build.gradle)：所有构建都在 `packaging.jniLibs` 里排除 `libbarhopper_v3.so`。App 固定用 ZXing 模式（[src/lib/qr.ts](src/lib/qr.ts)），不会加载它；**以后要改成 MLKIT 模式，得先去掉这条排除**。
- release 构建打开 R8 混淆（`minifyEnabled`）和资源压缩（`shrinkResources`）。暂时用**调试证书签名**，方便和 debug 包互相覆盖安装；正式发布前要换成自己的签名。
- [android/app/proguard-rules.pro](android/app/proguard-rules.pro)：扫码库的参数类引用了 Gson 注解但没带 Gson，加 `-dontwarn`，并保留 `com.outsystems.plugins.barcode.model.**`。
- 新脚本 `npm run apk:release`，产物 `android/app/build/outputs/apk/release/app-release.apk`。

| 包 | 体积 | 说明 |
|---|---|---|
| release | **3.87 MB**（3,871,942 字节） | dex 3.4 MB，剩下的原生库只有 CameraX 的几十 KB |
| debug | 35.7 MB | 不混淆，dex 不压缩存放，只在开发时用 |

release 包在 MuMu 上回归过：向导保存 → Keystore 写入 → 强制停止再打开读回密码；FontScale、SecureStorage、App、Haptics 四个原生插件都能调用；扫码界面能打开、开相机后停留 8 秒、取消，logcat 里没有缺类或缺 so 的报错。**模拟器没有摄像头画面，ZXing 是否真的拿到帧并识别，要在真机上确认**；万一真机扫码时崩溃，先用“粘贴文本”导入，再去掉排除规则查原因。

### 要等联调验证的（新增，第 12 节的清单仍然有效）

- 向导里路由器 `board()`、`detectMihomo()`、mihomo `version()` / `getProxies()`、UFI `status()` 对真机的结果，以及“测试”失败时显示的原因是否贴切（比如 rpcd 密码错时是 JSON-RPC 错误还是 HTTP 403）。
- `detectMihomo()` 给出的地址（路由器主机名 + 端口）在手机上能否直接连上；不能时向导里要能手动改。
- 退避重试在真实断网 / 恢复时的体验（恢复后最多 60 秒才自动重连，点“重试”立即重连）。
- 真机扫码：相机识别、取消、拒绝权限后的提示；确认排除 ML Kit 原生库后 ZXing 模式正常。
- Keystore 在真机（尤其国产 ROM）上的表现；卸载重装后密码应该一起消失。

### 没做的

- 首页拓扑图在没有路由器或代理时仍画路由器和 mihomo 节点（M0 的设计，没改）。
- 第二条及以后的重点线路向导不编辑，原样保留；界面只展示第一条。
- 属于插件（M3）的按钮保持“只弹提示”：场景编辑、套餐修改、历史曲线、访客网络、Tailscale 步骤说明。

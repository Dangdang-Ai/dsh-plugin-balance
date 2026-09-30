# dsh-plugin-balance

在 [DeepSeek Harness](https://github.com/Dangdang-Ai/dsh-plugin-balance) 桌面端左侧边栏的左下角，把账户**总余额**显示在账户头像右侧、与头像同一行。悬停看明细，点 `⟳` 手动刷新，**余额低于自定义阈值时整块变红**。

```
┌──────────────────────────────────────┐
│  …                                   │
│                                      │
│  ( 头像 )  用户名      余额 ¥12.34 ⟳  │   ← 本插件，整块贴右
└──────────────────────────────────────┘
```

## English

A tiny client plugin for DeepSeek Harness: it shows the signed-in account's total balance in the sidebar footer, on the same line as the account avatar, right-aligned, with a one-click refresh button, a hover breakdown (recharge + bonus) and a low-balance warning — click the amount to set the value below which the whole chip turns red. Install it from the in-app **Plugins** page by pasting this repository's URL (or an absolute local path); no npm registry and no dependencies are involved. Built against DSH `0.2.0-rc.2`.

> **Note on the name:** there is an unrelated plugin published on npm under the same package name, `dsh-plugin-balance` (by [Andrew111888](https://github.com/Andrew111888/dsh-plugin-balance)) — that one is a floating quota/usage widget above the composer. This plugin is distributed **only through this repository** (and local paths), not npm. DSH identifies a browser module by its package name, so the two cannot be installed at the same time.

## 特性

- 余额 + `⟳` 整块用 `margin-left:auto` 贴到账户行最右边；名字很长时先是名字省略号收缩。
- 垂直方向按**墨迹中心**对齐，不是按行盒中心：12px 文字的字形视觉中心比行盒中心低约 1.75px，所以 `⟳` 下沉 2px 贴住文字的视觉中线，整块再上提 1px 与头像/名字那条线对齐。
- 悬停在金额上显示明细：`总余额 ¥12.34（充值 ¥10.00 · 赠送 ¥2.34）`。
- 右侧 `⟳` 是手动刷新：点一下立即重新读取余额，读取期间图标旋转，点它不会打开账户菜单。
- 自动刷新：每 60 秒、页面重新可见、窗口重新获得焦点时各读一次。
- 侧边栏收起为窄栏时自动隐藏；未登录时显示为空；读取失败时保留上一次金额并淡化，同时仍可点 `⟳` 重试（若从未读到过金额，则只显示 `⟳`）。
- 金额按币种分别合计（`¥` / `$`，多币种用 ` + ` 连接），格式化规则与「设置 → 账号」页一致（向下截断到两位、不足一分显示 `<0.01`）；全程整数运算（精确到 1e-6），不会出现 `0.29` 显示成 `0.28` 这类浮点截断错误。
- **低于阈值整体变红**：点金额就地输入阈值（回车或点别处保存，`Esc` 取消，清空则关闭提醒），金额与 `⟳` 一起变成主题的 error 色。阈值存在浏览器 `localStorage`（键 `dsh.balance.alertBelow`），多币种时任一币种低于阈值即报警。

## 余额提醒阈值

1. 点一下账户行里的**金额文字**（`余额 ¥12.34`）→ 原地出现输入框（提示语 `阈值`）。
2. 输入金额，例如 `10`，按 **回车**（或点别处）保存；按 `Esc` 取消。
3. 余额低于该值时，**金额和 `⟳` 整体变红**（用主题的 `--dsw-alias-state-error-primary`，明/暗主题自动适配）；悬停提示里会写明当前阈值。
4. 想改：再点一次金额。想关掉：把输入框清空后回车。

阈值是浏览器本地偏好，不写进 profile 配置，所以不同浏览器/不同机器各存各的；DSH 自己的一些偏好（例如插件页记住的安装源）也是这么存的。

## 安装

`desktop` profile 由应用自身独占管理，命令行改不了；用应用内的 **插件（Plugins）** 页面安装：

### 方式一：从 GitHub 安装

1. 侧边栏底部打开 **插件** 页面。
2. 点 **添加插件**，在「包名或地址」里填仓库地址：
   ```
   https://github.com/Dangdang-Ai/dsh-plugin-balance
   ```
3. 点 **安装**，完成后点 **立即启用**。
4. 刷新页面（⌘R）。

### 方式二：从本地目录安装（开发时）

在「包名或地址」里改填本目录的绝对路径，例如 `/path/to/dsh-plugin-balance`。以本地路径安装得到的是链接依赖，改完源码刷新页面（必要时重启应用）即可看到效果，不用重装。

装好后若界面没有立刻出现金额，刷新一次页面；仍没有就退出应用重开。

## 卸载

同一个 **插件** 页面里把 `dsh-plugin-balance` 关掉或卸载，然后刷新页面。

## 它做了什么

- 这是一个 bundle 包：`package.json` 里声明了 `dsh.bundle.patch`（`cordis.patch.yml`）与 `dsh.client`。
  - bundle patch 只插入一行 Loader entry（`ui-balance` → `dsh-plugin-balance`），Host 半边（`lib/index.js`）是空座位，只为让 Loader 有一行、让 client 模块扫描能发现这个包。
  - 浏览器半边（`lib/client.js`）通过 `window.__ModuleLoader__.load({...})` 注册，`require` 只用平台种子模块（`react`、`react-dom`），因此本包没有任何 `dependencies` / `peerDependencies`。
- 浏览器半边占用了 `sidebar.footer.action` 这个 list 槽位（`id: account-balance`）以获得一个渲染位置，但自身不渲染任何可见内容；它在槽位里放一个隐藏的 marker，再从这个 marker 向上找到包含「头像位于按钮内」的最近祖先，也就是账户菜单按钮。
- 金额通过 `ctx.remote.account.getBalance({ version, locale, timezoneOffsetSeconds })` 读取，把充值钱包与赠送钱包按币种合计成总余额；挂载时读一次，之后每 60 秒、页面重新可见、窗口重新获得焦点时各读一次，`⟳` 按钮另有一次按需读取。读取失败时保留上一次的数值并淡化显示（不会误显示为 0）。
- 金额与 `⟳` 被 portal 进账户按钮的末尾，因此沿用按钮自身的 flex 布局：`头像 → 用户名 → …… → 余额 → 刷新`；金额文字 `pointer-events:none`，所以点金额仍然是打开账户菜单，只有 `⟳` 拦截点击（`stopPropagation`）。样式只用 DSH 自己的主题变量（`--dsw-alias-*`）与一小段注入样式表，自动跟随明/暗主题。

## 为什么用 portal 而不是纯槽位

`sidebar.footer.action` 渲染在侧边栏底部区域的**上一行**（账户行在它下面），槽位系统里没有任何槽位位于账户行*内部*；`settings.launcher` 又是 `single` 类型，已被账号插件占用。要让金额真正落在头像右边同一行，只能在运行时挂到账户按钮上。插件不依赖任何 hash 过的类名，靠的是结构（按钮里含头像）与隐藏 marker 的祖先回溯，因此在 DSH 升级、类名 hash 变化或侧边栏折叠/展开、登录/登出、账户行重新挂载后都能重新定位。

## 兼容性与维护

- 目标环境：DeepSeek Harness 桌面端 / Web 端 `0.2.0-rc.2`（`dsh.client.platform: web`，服务依赖 `slots`、`remote`、`remote.account`、`locale`）。
- `lib/client.js` 顶部的 `CLIENT_VERSION` 只用于账号 Remote 调用的客户端标识（会变成 Platform 请求头），与 DSH 版本不一致也不会影响功能；DSH 自己的插件同样把该常量内联进产物。
- 本包不声明 `peerDependencies`：插件运行时不 import 任何 DSH 包（Host 半边是空的，浏览器半边走平台种子模块表），声明 peer 只会平添安装期的版本兼容检查。
- 若 DSH 之后改了账户行的 DOM 结构（例如头像不再位于按钮内），插件会安静地什么都不显示，不会报错影响其它界面。

## 文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包声明：`dsh.bundle.patch`、`dsh.client`、`exports` |
| `cordis.patch.yml` | bundle 的 patch 层，`- insert` 一行 `ui-balance` |
| `lib/index.js` | Host 半边（空座位） |
| `lib/client.js` | 浏览器半边（槽位占用 + 余额 chip + `⟳`） |

## License

[MIT](LICENSE)

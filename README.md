# UEModManager

UE Mod Manager 是一个基于 Electron 的桌面工具，用于管理多款游戏的 Mod（启用/禁用、排序、标签、预设、分组、预览、背景、下载安装等）。

## 主要功能

- 多游戏支持
  - 游戏选择页
  - 新增游戏（可在选择页直接添加）
  - 游戏配置独立（每个游戏独立 `settings_id`）
- Mod 管理
  - 启用/禁用、批量操作
  - 拖拽排序与优先级调整
  - 重命名、删除、打开目录
- 子模块与分组
  - 子模块关系管理（联动启用/禁用）
  - 同类互斥分组管理
  - 冲突提示
- 标签与筛选
  - 标签编辑与批量标签操作
  - 按状态/标签筛选
- 预设系统
  - 保存当前启用状态为预设
  - 应用预设（批量启用/禁用）
- 媒体与界面
  - 背景图管理（上传/删除/透明度/模糊）
  - Mod 预览图管理
  - 服装图列表（按游戏特性开关）
- 下载与安装
  - 处理常见压缩包格式（zip/7z/rar）
  - 下载文件选择安装
- 国际化
  - `zh-CN` / `en` / `ja`
  - 语言切换入口位于“界面设置”

## 技术栈

- Electron 28
- Node.js + npm
- SQLite（`better-sqlite3`）
- `fs-extra`、`adm-zip`、`node-7z`、`node-unrar-js`

## 环境要求

- Windows 10/11（当前打包目标为 NSIS）
- Node.js 18+（建议 LTS）
- npm 9+

## 快速开始

```bash
npm install
npm start
```

> `start` 脚本包含 `chcp 65001`，用于确保 Windows 终端 UTF-8 输出。

## 打包发布

```bash
npm run dist
```

构建产物默认输出到 `dist/`。

## 项目结构

```text
src/main/         Electron 主进程
src/renderer/     渲染进程页面、样式与前端逻辑
data/             运行时数据（数据库、游戏配置、封面、预设等）
dist/             打包输出
```

## 数据与配置说明

- 主数据库：`data/mod_manager.db`
- 游戏配置目录：`data/game/*.json`
- 游戏封面目录：`data/game_cover/`
- 预设目录：`data/preset/<gameId>/`

### 游戏配置示例

```json
{
  "id": "StellarBlade",
  "name": "剑星",
  "description": "Stellar Blade",
  "executable": "SB.exe",
  "settings_id": 1,
  "displayName": "StellarBlade",
  "nexusUrl": "https://www.nexusmods.com/stellarblade/mods/",
  "features": {
    "clothingList": true
  },
  "uiConfig": {
    "windowTitle": "StellarBlade Mod Manager",
    "launchButtonText": "启动游戏",
    "gamePathLabel": "StellarBlade 游戏根目录:"
  }
}
```

## 开发说明

- 入口文件：`src/main/main.js`
- 渲染主页面：`src/renderer/index.html`
- 游戏选择页：`src/renderer/game-selector.html`
- 本地化文件：`src/renderer/js/locales/*.js`

### 常用脚本

```bash
npm start   # 本地运行
npm run pack
npm run dist
```

## 常见问题

- 启动后无游戏可选
  - 检查 `data/game/` 下是否存在有效 JSON 配置。
- 游戏路径自动检测失败
  - 手动在设置中填写游戏根目录并保存。
- 打包后资源缺失
  - 检查 `package.json -> build.files` 配置与目录结构是否匹配。

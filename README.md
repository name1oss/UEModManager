# UEModManager

UE Mod Manager 是一个基于 Electron 的桌面应用，用于管理 UE 游戏 Mod（启用/停用、预设、标签、分组等）。

## 功能

- Mod 启用/停用、批量操作
- 子 Mod 管理与联动
- 标签系统与筛选
- 预设保存/应用
- 相似 Mod 分组与冲突提示
- 多语言支持（`zh-CN` / `en` / `ja`）
- 自动检测游戏路径（Windows）
- 压缩包处理（zip / 7z / rar）

## 环境要求

- Node.js 18+（建议 LTS）
- npm 9+
- Windows 10/11（发行目标为 Windows NSIS）

## 本地运行

```bash
npm install
npm start
```

## 打包发行版

```bash
npm run dist
```

构建产物默认输出到 `dist/` 目录。

## 项目结构

```text
src/main/      Electron 主进程
src/renderer/  前端页面与交互逻辑
data/          运行时数据（默认不提交）
dist/          打包输出（默认不提交）
```

## GitHub 发布建议流程

1. 更新版本号（`package.json`）
2. 提交代码并推送到 `main`
3. 运行 `npm run dist` 生成安装包
4. 创建并推送标签（如 `v1.0.0`）
5. 在 GitHub Release 页面选择该标签并上传 `dist/` 中安装包

## 许可证

MIT

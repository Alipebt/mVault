# 记忆库

```bash
npm install
npm run build:pwa    # 打包 PWA → dist-pwa/
npm test             # 单元测试
```

## 部署

推送到 `dev` 分支后自动构建并部署到 GitHub Pages（见 `.github/workflows/deploy.yml`），访问 `https://alipebt.github.io/mVault/`。

手机首次使用：打开页面 → 在“设置”里填 GitHub 仓库 URL 和 Token → 连接仓库。

本项目只保留 PWA 前端；发布前请执行 `npm run build:pwa`，部署 `dist-pwa/` 目录。
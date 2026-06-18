# AIToPhone 本地部署与连通性排查

本文档记录 Windows 本地部署、CodeX WebSocket 连接、手机访问和常见问题排查流程。

## 1. 推荐部署方式

优先使用桌面控制面板：

```powershell
.\AIToPhone-Control-Panel.cmd
```

控制面板可以完成：

- 编辑 `.env` 基础配置。
- 保存访问口令、端口、CodeX 命令和权限模式。
- 一键启动或重启 AIToPhone 网关。
- 自动触发 CodeX app-server WebSocket 连接。
- 展示手机访问链接。
- 检测 CodeX 是否已连接。

## 2. 手动部署命令

如果不使用桌面控制面板，可以手动执行：

```powershell
npm.cmd install
npm.cmd run test:web
npm.cmd run check
powershell -ExecutionPolicy Bypass -File .\scripts\restart-server.ps1
```

部署成功后，脚本会输出类似链接：

```text
http://电脑虚拟IP:8787/?token=你的访问口令
```

手机和电脑通过蒲公英、Tailscale、EasyTier、ZeroTier 或同一 Wi-Fi 互通后，在手机浏览器打开该链接。

## 3. 关键配置

`.env` 推荐配置：

```text
HOST=0.0.0.0
PORT=8787
AUTH_TOKEN=换成你自己的长随机口令
CODEX_COMMAND=codex.cmd
CODEX_APP_SERVER_PORT=4500
CODEX_APPROVAL_POLICY=never
CODEX_SANDBOX=danger-full-access
```

说明：

- `PORT=8787` 是 AIToPhone 网关端口。
- `CODEX_APP_SERVER_PORT=4500` 是本机 CodeX app-server WebSocket 端口。
- `CODEX_APPROVAL_POLICY=never` 适合手机远程操作，避免电脑端确认弹窗卡住。
- `CODEX_SANDBOX=danger-full-access` 允许远程会话执行写文件和 git 操作。只想允许项目目录内写入时，可改为 `workspace-write`。

## 4. CodeX WebSocket 连接检查

手机端显示「CodeX 未连接」时，先在电脑上检查：

```powershell
Get-NetTCPConnection -LocalPort 8787,4500 -ErrorAction SilentlyContinue
```

正常状态应该看到：

- `8787` 正在监听：AIToPhone 网关在线。
- `4500` 正在监听：CodeX app-server WebSocket 在线。

也可以通过 API 检查：

```powershell
$token=(Get-Content .env | Select-String '^AUTH_TOKEN=' | ForEach-Object { $_.Line -replace '^AUTH_TOKEN=', '' })
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/status" -Headers @{Authorization="Bearer $token"} | ConvertTo-Json -Depth 6
```

正常结果应包含：

```json
{
  "connected": true,
  "initialized": true,
  "url": "ws://127.0.0.1:4500"
}
```

## 5. 手动启动 CodeX app-server

如果 8787 在线但 4500 不在线，可以手动启动：

```powershell
Start-Process -FilePath "codex.cmd" -ArgumentList @("app-server", "--listen", "ws://127.0.0.1:4500") -WorkingDirectory "." -WindowStyle Hidden
```

最新版本已修复 Windows 下自动启动 `codex.cmd` 的兼容问题。AIToPhone 网关会在需要时自动拉起：

```text
codex.cmd app-server --listen ws://127.0.0.1:4500
```

## 6. 手机连通性测试步骤

1. 在电脑上运行 `AIToPhone-Control-Panel.cmd`。
2. 点击「一键连接」。
3. 确认状态显示「CodeX 已连接」。
4. 复制控制面板中的手机访问链接。
5. 在手机 Safari 打开该链接。
6. 如果使用蒲公英/Tailscale，优先选择虚拟网卡 IP。
7. 进入页面后，新建一个对话，发送一句测试消息。

## 7. 常见问题

### 手机能打开页面，但显示 CodeX 未连接

通常是 4500 端口没有监听。点击控制面板「一键连接」，或手动运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restart-server.ps1
```

然后刷新手机页面。

### 电脑能访问，手机不能访问

检查：

- 手机和电脑是否在同一个蒲公英/Tailscale/EasyTier/ZeroTier 网络。
- Windows 防火墙是否允许 Node.js 或端口 `8787`。
- 手机访问的是否是电脑虚拟 IP，而不是 `127.0.0.1`。

### 手机端能读不能写

确认 `.env`：

```text
CODEX_APPROVAL_POLICY=never
CODEX_SANDBOX=danger-full-access
```

修改后重启网关，并在手机端新建一个对话。旧对话可能仍保留之前权限。

### 页面仍是旧版本

Safari 或 PWA 可能缓存旧脚本。处理方式：

- Safari 下刷新页面。
- 从 iPhone 主屏幕删除旧 PWA，再重新添加。
- 确认 HTML 加载的是最新 `/app.js?v=27` 或更高版本。

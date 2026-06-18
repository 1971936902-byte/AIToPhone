# AIToPhone

把本地 AI 编程助手安全地带到手机上。

AIToPhone 是一个极简的 iPhone 远程客户端方案：Windows 电脑运行本地网关，手机通过蒲公英、Tailscale、EasyTier、ZeroTier 或 Cloudflare Tunnel 访问这个网关，从而在手机上选择项目目录、发送指令给 Windows 本地 Codex，并接收实时输出。

它适合这样的场景：

- 出门在外时，想用手机继续操控家里或办公室 Windows 电脑上的 Codex。
- 不想把整个远程桌面搬到手机上，只想要一个轻量的 AI 对话入口。
- 希望按项目目录启动 Codex 会话，让 AI 在指定代码仓库中工作。
- 希望在不暴露本机文件系统的前提下，只开放白名单项目目录。
- 希望通过私有组网或安全隧道访问本地 AI 工具。

## 核心能力

- **网页/PWA 使用**：iPhone Safari 或其他手机浏览器打开后可添加到主屏幕，像轻量 App 一样使用。
- **远程发送指令**：手机输入文本，Windows 本地 Codex 接收并执行。
- **实时接收输出**：支持 Codex 流式输出，并自动聚合为完整回答气泡。
- **多项目目录**：通过 `projects.json` 配置项目白名单，手机端可选择不同项目开启对话。
- **会话同步**：服务端保存项目、对话和消息历史，手机刷新后仍可切换已有对话。
- **短信式体验**：用户消息靠右，AI 回复靠左，更适合手机阅读。
- **Markdown 展示**：AI 回复中的段落、列表、行内代码和代码块会被格式化展示。
- **账户与额度卡片**：侧边栏可展示 Codex 账户状态、额度使用、剩余比例、更新时间和累计 token 信息；如果当前 Codex 版本暂未返回，则自动降级显示。
- **微信式附件入口**：输入框旁边提供加号按钮，可上传图片和文件；图片会作为本地图片输入交给 Codex，普通文件会以本地路径附到提示词里。
- **文件访问**：上传文件和 Codex 回复中可识别的本地文件路径会生成可打开/下载链接。
- **用量查看**：内置 Codex rate limits / goal token 信息查看入口。
- **本地优先**：Codex、代码仓库、执行环境都留在 Windows 本机。
- **网络灵活**：支持蒲公英、Tailscale、EasyTier、ZeroTier、Cloudflare Tunnel 等连接方式。

## 架构

```text
iPhone PWA
   |
   |  蒲公英 / Tailscale / EasyTier / Cloudflare Tunnel
   |
Windows AIToPhone Gateway
   |
   |  WebSocket / JSON-RPC
   |
Codex app-server
   |
Windows 本地项目目录
```

AIToPhone 不直接把任意文件系统暴露给手机。手机只能选择 `projects.json` 中声明过的项目目录。

## 快速开始

### Windows 桌面控制面板

推荐在 Windows 上直接双击：

```text
AIToPhone-Control-Panel.cmd
```

这个小工具可以在图形界面里保存 `.env` 配置、一键连接本地 CodeX、检测 WebSocket 状态，并复制手机访问链接。完整部署与排障说明见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

### 1. 安装依赖

```powershell
cd AIToPhone
npm.cmd install
```

### 2. 配置环境变量

复制示例配置：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`，设置一个足够长的访问口令：

```text
AUTH_TOKEN=change-this-long-random-token
```

Windows PowerShell 下建议使用：

```text
CODEX_COMMAND=codex.cmd
```

手机远程使用时建议打开写权限和免确认模式，否则 CodeX 可能只能读项目或等待电脑端确认，手机端会表现为无法写入代码、无法执行 git commit/push：

```text
CODEX_APPROVAL_POLICY=never
CODEX_SANDBOX=danger-full-access
```

如果你只想允许项目目录内写文件，可以把 `CODEX_SANDBOX` 改回 `workspace-write`。权限配置只会在新建 CodeX 会话时生效；修改 `.env` 后请重启 AIToPhone 网关，并在手机端新建对话。

### 3. 配置项目白名单

编辑 `projects.json`：

```json
{
  "projects": [
    {
      "id": "my-project",
      "name": "My Project",
      "cwd": "C:\\path\\to\\my-project"
    }
  ]
}
```

### 4. 启动 Codex app-server

```powershell
codex.cmd app-server --listen ws://127.0.0.1:4500
```

如果没有安装 Codex CLI，可以先运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-codex-cli.ps1
```

### 5. 启动 AIToPhone 网关

```powershell
npm.cmd start
```

也可以使用重启脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restart-server.ps1
```

### 6. 获取手机访问地址

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\show-url.ps1
```

同一 Wi-Fi 下可以使用 `192.168.x.x` 地址。  
人在外面时，建议使用蒲公英、Tailscale、EasyTier 或 ZeroTier 分配的虚拟 IP。

手机访问格式：

```text
http://电脑虚拟IP:8787/?token=你的AUTH_TOKEN
```

## 推荐联网方式

### 国内优先：贝锐蒲公英

蒲公英在国内可用性较好，Windows 和 iOS 都有客户端。电脑和手机加入同一个蒲公英网络后，用蒲公英分配给 Windows 的虚拟 IP 访问：

```text
http://蒲公英虚拟IP:8787/?token=你的AUTH_TOKEN
```

### 开源方案：EasyTier

EasyTier 适合喜欢开源和自控网络的用户。Windows 有 GUI 和命令行版本；手机端请按官方当前可用客户端或组网方案配置。

### 公网域名：Cloudflare Tunnel

如果希望通过公网 HTTPS 域名访问，推荐 Cloudflare Tunnel，并配合 Cloudflare Access 做二次身份验证。详见 [公网访问方案.md](./公网访问方案.md)。

## 安全建议

- 不要把 `.env` 提交到 GitHub。
- 不要公开分享带 `token=` 的访问链接。
- `projects.json` 只放你愿意远程操作的项目目录。
- 如果走公网域名，建议使用 Cloudflare Access 或同类身份验证。
- 不建议直接做路由器端口映射暴露 `8787`。

## 常用命令

```powershell
# 检查 Codex CLI
powershell -ExecutionPolicy Bypass -File .\scripts\check-codex-cli.ps1

# 启动网关
npm.cmd start

# 重启网关并打印访问地址
powershell -ExecutionPolicy Bypass -File .\scripts\restart-server.ps1

# 打印手机访问地址
powershell -ExecutionPolicy Bypass -File .\scripts\show-url.ps1
```

## 项目结构

```text
server/                 Windows 本地网关服务和会话存储逻辑
public/                 手机网页/PWA 前端
scripts/                Windows 辅助脚本
projects.json           可远程访问的项目目录白名单
.env.example            环境变量示例
使用说明.md             中文使用说明
公网访问方案.md         公网访问与隧道方案
```

运行时会话历史保存在 `data/conversations.json`，上传文件保存在 `uploads/`，这些目录默认不会提交到 GitHub。

## 项目定位

AIToPhone 不是远程桌面，也不是云 IDE。它是一个更轻、更直接的手机入口：让你在外面也能把一句话发给家里的 Windows Codex，让本地 AI 在本地代码仓库里继续工作。

电脑仍然是主战场，手机只是你的遥控器。

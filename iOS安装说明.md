# AIToPhone iOS 安装说明

## 先说明：iOS 不能安装 APK

APK 是 Android 安装包。iPhone/iPad 不能安装 APK。

iOS 可安装的形式通常是：

- PWA：Safari 添加到主屏幕。
- TestFlight：需要 Apple 开发者账号发布测试版。
- IPA：需要 macOS + Xcode + Apple 签名证书构建和安装。
- 企业签名：需要企业开发者资质。

本项目已经提供 Capacitor iOS 原生壳工程，可以在 macOS 上用 Xcode 构建 IPA。

## 已生成的 iOS 工程

工程路径：

```text
ios/App/App.xcodeproj
```

App 信息：

```text
App Name: AIToPhone
Bundle ID: com.aitophone.app
Web Dir: public
```

## Windows 上可以做什么

Windows 可以维护网页代码、同步 Capacitor 工程：

```powershell
cd C:\Users\19719\Documents\CallCodeX
powershell -ExecutionPolicy Bypass -File .\scripts\sync-ios.ps1
```

但 Windows 不能直接编译和签名 iOS IPA。

## macOS 上构建 IPA

在 Mac 上拉取仓库：

```bash
git clone https://github.com/1971936902-byte/AIToPhone.git
cd AIToPhone
npm install
npx cap sync ios
open ios/App/App.xcodeproj
```

然后在 Xcode 中：

1. 选择 `App` target。
2. 设置 Team。
3. 确认 Bundle Identifier，例如 `com.aitophone.app`。
4. 连接 iPhone。
5. 点击 Run 安装到手机。

如果要导出 IPA：

1. Xcode 菜单选择 `Product -> Archive`。
2. 打开 Organizer。
3. 选择 `Distribute App`。
4. 选择 Ad Hoc、Development、TestFlight 或 App Store。

## iPhone App 首次使用

原生 iOS App 不是从 Windows 网页地址启动的，所以需要在侧边栏里填写网关地址：

```text
http://电脑的蒲公英虚拟IP:8787
```

例如：

```text
http://10.x.x.x:8787
```

然后填写访问口令，也就是 Windows `.env` 里的：

```text
AUTH_TOKEN=...
```

保存后即可连接 Windows 本地 AIToPhone 网关。

## 为什么还保留 PWA

PWA 是最快、最不折腾的 iPhone 安装方式。原生 iOS 壳更像 App，但必须经过 Apple 的签名链路。

如果只是自己使用，建议优先：

```text
Safari -> 打开 AIToPhone 地址 -> 添加到主屏幕
```

如果要分发给多台 iPhone，建议使用：

```text
TestFlight
```

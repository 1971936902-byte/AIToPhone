# AIToPhone Android APK 安装说明

Android 可以安装 APK。本项目已经提供 Capacitor Android 工程，可以构建可安装的 debug APK。

## Android 工程路径

```text
android/
```

App 信息：

```text
App Name: AIToPhone
Application ID: com.aitophone.app
```

## Windows 构建 APK

需要先安装：

- Android Studio
- Android SDK
- Java JDK，一般 Android Studio 会附带或提示安装

然后在项目目录运行：

```powershell
cd C:\Users\19719\Documents\CallCodeX
powershell -ExecutionPolicy Bypass -File .\scripts\build-android-apk.ps1
```

构建成功后，APK 路径通常是：

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

把这个 APK 发送到安卓手机，允许“安装未知来源应用”，即可安装。

## 只同步 Android 工程

如果只想同步网页代码到 Android 工程：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-android.ps1
```

## App 首次使用

Android 原生 App 不是从 Windows 网页地址启动的，所以首次打开后需要在侧边栏填写网关地址：

```text
http://电脑的蒲公英虚拟IP:8787
```

例如：

```text
http://10.x.x.x:8787
```

然后填写 Windows `.env` 中的访问口令：

```text
AUTH_TOKEN=...
```

保存后即可连接 Windows 本地 AIToPhone 网关。

## 本机当前状态

当前 Windows 环境未检测到 `java` 命令，因此我已经生成 Android 工程，但这台机器暂时不能直接编译 APK。

安装 Android Studio/JDK 后，重新运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-android-apk.ps1
```

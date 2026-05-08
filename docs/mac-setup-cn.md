# Xtream macOS 设置指南

本页是 Xtream 用户指南的中文设置页。它面向需要在 macOS 上安装、打开或从源码运行 Xtream 的新用户。

## 适用场景

当你需要完成下面任一事情时，请使用本页：

- 第一次在 Mac 上打开 Xtream。
- 从 GitHub 下载源码并运行测试版或 nightly 版本。
- 为摄像头、屏幕采集、窗口采集或音频输出检查权限。
- 打开已有演出项目或创建新项目。

## 使用打包应用

如果发布页提供了 macOS 打包应用，请优先使用打包应用。

1. 下载对应版本的 Xtream 应用。
2. 按照 macOS 的正常应用安装方式打开。
3. 如果系统提示安全确认，请确认应用来源，并按你的团队安全流程处理。
4. 打开后，你会看到 Xtream 的启动面板，可以创建新演出、打开已有演出或打开最近项目。

如果当前没有打包应用，请使用下面的源码运行方式。

## 从源码运行

从源码运行适合开发、测试和 nightly 文档版本。

你需要先安装：

- Git。
- Node.js LTS。
- npm，通常会随 Node.js 一起安装。

打开 Terminal 后运行：

```bash
git clone https://github.com/XiaoTianFan/Xtream.git
cd Xtream
npm install
npm start
```

`npm start` 会构建应用、运行类型检查和测试，然后用 Electron 打开 Xtream。

## 打开 Terminal

1. 按 `Command + Space` 打开 Spotlight。
2. 输入 `Terminal`。
3. 回车打开终端。

如果你不熟悉 Terminal，只需要逐行复制本页命令，并在每行后按回车。

## 检查 Git

在 Terminal 中运行：

```bash
git --version
```

如果显示版本号，说明 Git 已安装。如果 macOS 提示安装 Xcode Command Line Tools，请按提示安装，然后再次运行上面的命令确认。

## 检查 Node.js

在 Terminal 中运行：

```bash
node -v
npm -v
```

如果没有版本号，请安装 Node.js LTS。安装完成后，重新打开 Terminal，再检查一次。

## macOS 权限

根据演出内容，Xtream 可能需要：

- 摄像头权限，用于 webcam live visual。
- 屏幕录制权限，用于屏幕、区域或窗口采集。
- 麦克风或媒体权限，用于某些采集设备。
- 音频输出设备访问权限，用于路由和监听。

如果你刚刚授予了系统权限，可能需要重新启动 Xtream。

## 打开或创建演出

Xtream 打开后会显示启动面板：

- **Create New**：创建新演出项目。
- **Open Existing**：打开已有项目。
- **Open Default**：打开默认项目。
- **Recent Shows**：打开最近使用过的项目。

Xtream 的演出项目是一个文件夹，核心文件是 `show.xtream-show.json`。如果移动项目，请移动整个项目文件夹，而不是只移动这个 JSON 文件。

## 常见问题

**npm start 很慢。** 第一次运行会安装依赖、构建、检查类型并运行测试，耗时较长是正常的。

**摄像头或屏幕采集不可用。** 检查 macOS 系统设置里的隐私与安全权限，授权后重启 Xtream。

**音频输出不对。** 连接音频设备后，在 Xtream 中刷新输出，并检查虚拟输出的物理设备选择。

**移动项目后媒体丢失。** 被复制进项目的媒体会跟随项目文件夹移动；链接媒体仍然指向原始路径，需要用 **Relink media...** 重新链接。

## 相关页面

- [用户指南入口](user-guide/index.md)
- [安装和打开](user-guide/getting-started/install-and-open.md)
- [第一个演出](user-guide/getting-started/first-show.md)
- [项目文件和媒体](user-guide/getting-started/project-files-and-media.md)


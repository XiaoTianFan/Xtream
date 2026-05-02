**Terminal 新手指南：克隆 GitHub 仓库并启动 Electron 项目**

本指南将带你走过使用 Mac 上的 Terminal 来获取和运行一个 Electron 项目的基本步骤。无需担心，我们会尽量简化！

---

### **第一步：打开 Terminal**

Terminal 是你与电脑直接沟通的工具。

1. **打开 Launchpad** (Dock 栏上的火箭图标) 或在 Spotlight 搜索 (快捷键 `Command + 空格键`) 中输入 `Terminal`。
2. 点击搜索结果中的 **Terminal** 图标。

现在你面前应该出现一个黑色的窗口，里面显示着一些文字，比如 `你的电脑名:~ 你的用户名$`。这就是 Terminal。

---

### **第二步：安装 Git (如果尚未安装)**

Git 是一个版本控制工具，用于从 GitHub 等平台下载代码。

1. 在 Terminal 中输入以下命令，然后按回车键：
  ```bash
    git --version
  ```
  - 如果显示一个版本号 (例如 `git version 2.30.1`)，说明 Git 已经安装了，你可以跳到下一步。
  - 如果出现提示让你安装 `Xcode Command Line Tools`，请点击 **“安装”**。系统会下载并安装 Git 及其他开发工具。这个过程可能需要几分钟，请耐心等待。
  - 安装完成后，再输入 `git --version` 确认一遍。

---

### **第三步：克隆 GitHub 仓库**

现在我们要把项目代码从 GitHub “复制”到你的电脑中。

1. **找到你要克隆的 GitHub 仓库页面。**`https://github.com/XiaoTianFan/Xtream`
2. 在仓库页面的右上方，找到绿色的 `**Code`** 按钮，点击它。
3. 在弹出的菜单中，选择 `**HTTPS**` 标签页，然后点击旁边的 **剪贴板图标** 复制仓库的 URL (链接)。它看起来像这样：`https://github.com/XiaoTianFan/Xtream.git`
4. 回到 Terminal，输入 `git clone`，然后粘贴你刚刚复制的 URL。确保 `git clone` 和 URL 之间有一个空格。
  ```bash
    git clone https://github.com/XiaoTianFan/Xtream.git
  ```
5. 按回车键。Terminal 会开始下载项目文件。完成后，你会看到类似 `Receiving objects: 100% (X/X), done.` 的提示。

现在，项目代码已经下载到了你的电脑里，通常在你的用户主目录 (Home Directory) 下。

---

### **第四步：进入项目目录**

我们需要进入刚刚下载的项目文件夹，才能执行里面的命令。

1. 每个项目都有一个名字，通常是仓库链接的最后一部分。例如，`Xtream.git` 对应的文件夹名是 `Xtream`。
2. 在 Terminal 中输入 `cd` (Change Directory 的缩写)，然后输入项目文件夹的名字。
  ```bash
    cd Xtream
  ```
3. 按回车键。你会发现 Terminal 的提示符变了，现在可能显示 `你的电脑名:Xtream 你的用户名$`，这表示你已经进入了项目目录。

---

### **第五步：安装 Node.js (如果尚未安装)**

Electron 项目通常需要 Node.js 来运行。

1. 在 Terminal 中输入以下命令，然后按回车键：
  ```bash
    node -v
  ```
  - 如果显示一个版本号 (例如 `v18.12.1`)，说明 Node.js 已经安装了。
  - 如果提示 `command not found` 或版本过旧，你需要安装 Node.js。最简单的方法是访问 Node.js 官网：`https://nodejs.org/zh-cn/`。下载并安装 **LTS (长期支持版)**。按照安装程序提示一步步完成即可。
  - 安装完成后，重新打开 Terminal (很重要！)，再输入 `node -v` 确认一遍。

---

### **第六步：根据项目文档安装依赖并启动项目**

在 `docs\project-setup-and-manual-testing.md` 文件中，你会看到关于如何安装和运行项目的说明。

对于大多数 Electron 项目，会包含以下两个步骤：

- **安装依赖包：** Electron 项目依赖许多模块，需要先下载它们。
在 Terminal 中 (确保你还在项目目录下 `electron-quick-start`) 输入：
`bash npm install` 
​    按回车键。这会开始下载并安装项目所需的所有依赖包。这个过程可能需要一些时间，取决于你的网络速度。
- **启动项目：** 安装完成后，就可以运行项目了。
在 Terminal 中输入：
  ```bash
  npm start
  ```
  按回车键。

---

### **大功告成！**

如果一切顺利，一个 Electron 应用程序窗口应该会弹出来，显示项目的内容。

当你想要停止项目时，回到 Terminal 窗口，按 `Control + C` 组合键即可。

---

**恭喜你！** 你已经成功地使用 Terminal 学习了如何克隆 GitHub 仓库并启动一个 Electron 项目。随着你对 Terminal 越来越熟悉，你会发现它是一个非常强大的工具！
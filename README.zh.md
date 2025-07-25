# DolphinDB Visual Studio Code Extension

<p align='center'>
    <img src='./images/ddb.png' alt='DolphinDB VS Code Extension' width='256'>
</p>

<p align='center'>
    <a href='https://marketplace.visualstudio.com/items?itemName=dolphindb.dolphindb-vscode' target='_blank'>
        <img alt='vscode extension version' src='https://img.shields.io/visual-studio-marketplace/v/dolphindb.dolphindb-vscode?style=flat-square&color=39aaf2' />
    </a>
    <a href='https://marketplace.visualstudio.com/items?itemName=dolphindb.dolphindb-vscode' target='_blank'>
        <img alt='vscode extension installs' src='https://img.shields.io/visual-studio-marketplace/i/dolphindb.dolphindb-vscode?style=flat-square&color=39aaf2' />
    </a>
    <a href='https://github.com/dolphindb/api-javascript' target='_blank'>
        <img alt='dolphindb api version' src='https://img.shields.io/npm/v/dolphindb?color=brightgreen&label=api-javascript&style=flat-square' />
    </a>
</p>

## [English](./README.md) | 中文

VS Code 是微软开发的一款轻量、高性能又有极强扩展性的代码编辑器。它提供了强大的插件框架，开发者可以通过编写插件拓展 VS Code 编辑器的功能，甚至支持新的编程语言。

DolphinDB 公司开发了这个针对 DolphinDB 数据库的 VS Code 插件，在 VS Code 中增加了对自研的 DolphinDB 脚本语言的支持，让用户可以编写并执行脚本来操作数据库，或查看数据库中的数据。

## 功能
- 代码高亮
- 关键字、常量、内置函数的代码补全
- 内置函数的文档提示、参数提示
- 终端可以展示代码执行结果以及 print 函数输出的消息
- 在底栏中展示执行状态，点击后可取消作业
- 在底部面板中以表格的形式展示表格、向量、矩阵等数据结构
- 在侧边面板中管理多个数据库连接，展示会话变量
- 在浏览器弹窗中显示表格

更多功能介绍，请参考 DolphinDB 官网 [VS Code 插件](https://docs.dolphindb.cn/zh/db_distr_comp/vscode.html)。

<img src='./images/demo.png' width='1200'>

## 使用说明

具体使用说明请参考 DolphinDB 官网 [VS Code 插件](https://docs.dolphindb.cn/zh/db_distr_comp/vscode.html)。

## 开发说明

打开下面的链接，在机器上安装最新版的 node.js 及浏览器。  
https://nodejs.org/en/download/current

```shell
# 安装 pnpm 包管理器
npm install -g pnpm

git clone https://github.com/dolphindb/vscode-extension.git

cd vscode-extension

# 国内网络推荐配置 registry 
pnpm config set registry https://registry.npmmirror.com

# 安装项目依赖
pnpm install

# 参考 package.json 中的 scripts

# 启动开发
# 需要先卸载已安装的 dolphindb 插件

pnpm run dev

# 格式化代码并自动修复代码错误
pnpm run fix

# 扫描词条
pnpm run scan
# 手动补全未翻译词条
# 再次运行扫描以更新词典文件 dict.json
pnpm run scan

# 构建
# pnpm run build
```

# DolphinDB VS Code Extension

<p align='center'>
    <img src='./images/ddb.png' alt='DolphinDB VSCode Extension' width='256'>
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

## English | [中文](./README.zh.md)

Microsoft Visual Studio Code (VS Code) is a powerful and lightweight code editor with a rich extensibility model. VS Code extensions let you add languages, debuggers, and tools to your installation to support your development workflow.

Install the DolphinDB Extension for VS Code to add the DolphinDB scripting language in VS Code, which enables you to write and execute scripts in VS Code to operate the DolphinDB database and access its data.

## Features
- Code highlighting
- Code completion for keywords, constants, built-in functions
- Documentation and parameter hints for built-in functions
- Displays code execution results and `print()` output in the integrated terminal
- Displays running script status in bottom status bar with option to click to cancel
- Displays data structures like tables, vectors, matrices in browser pop-up windows
- Displays connections, databases and session variables in the sidebar
- Displays tables, vectors, and matrices in browser pop-up windows 
- Exports DolphinDB tables to disk (.csv file)

<img src='./images/demo.png' width='1200'>

## Use

For information on how to use this extension, see [official documentation](https://docs.dolphindb.cn/en/Tutorials/vscode_extension.html) at the DolphinDB website.

## Development Instructions

Open the link below and install the latest version of node.js and browser on your machine.
https://nodejs.org/en/download/current

```shell
# Install pnpm package manager
npm install -g pnpm

git clone https://github.com/dolphindb/vscode-extension.git

cd vscode-extension

# Recommended registry configuration for domestic networks
pnpm config set registry https://registry.npmmirror.com

# Install project dependencies
pnpm install

# Refer to scripts in package.json

# Start development
# You need to uninstall the installed dolphindb plugin first

pnpm run dev

# Format code and automatically fix code errors
pnpm run fix

# Scan entries
pnpm run scan
# Manually complete untranslated entries
# Run scan again to update the dictionary file dict.json
pnpm run scan

# Build
# pnpm run build
```

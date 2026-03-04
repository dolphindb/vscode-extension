# AGENTS.md

## 构建与开发命令

```bash
# 开发模式（构建并启动 VSCode 调试扩展）
node ./commands.ts dev

# 生产构建
node ./commands.ts build

# 运行测试（先构建再测试）
node ./commands.ts build test

# ESLint 检查与修复
pnpm lint
pnpm fix

# i18n 字典扫描
pnpm scan
```

## 架构概述

DolphinDB VSCode 扩展，包含三个独立构建入口：

| 入口 | 输出 | 说明 |
|------|------|------|
| `src/index.ts` | `out/index.cjs` | 扩展主入口 |
| `src/debugger/index.ts` | `out/debugger.cjs` | Debug Adapter Protocol 实现 |
| `src/languageserver/index.ts` | `out/languageserver.cjs` | Language Server Protocol 实现 |
| `src/dataview/*.tsx` | `out/dataview/*.js` | React Webview UI (数据视图) |

### 核心模块

- **connector** - 连接管理与 TreeView Provider
- **databases/variables** - 数据库和变量的 TreeView Provider
- **dataview** - 基于 React + antd + echarts 的数据可视化 Webview
- **formatter** - DolphinDB 代码格式化
- **debugger** - Debug Adapter，支持断点、单步调试

## 路径别名

```typescript
// tsconfig.json paths
'@i18n' → './i18n/index.ts'
'@theme' → './src/dataview/theme.ts'
'@components/*' → './src/dataview/components/*'
'@test/*' → './test/*'
'@/*' → './src/*'
```

## 代码风格

### 命名规范

- **变量/函数/成员**: 下划线命名法 (`fpd_root`, `fpd_out`, `table_actions`)
- **类型/类/接口**: PascalCase (`DdbConnection`, `DdbDebugSession`)

### 格式化

- 字符串优先使用单引号
- 空对象: `{ }`，空数组: `[ ]`
- 函数声明名称后有空格: `function foo ()`
- `if/else` 单语句时省略大括号但换行缩进
- 多行字符串用 `+` 拼接，变量用模板字符串插值

### 导入顺序

```typescript
// 1. Node.js 内置模块
import os from 'os'

// 2. VSCode API
import { window, commands } from 'vscode'

// 3. 第三方库
import { check, delay } from 'xshell'
import { DDB, DdbType } from 'dolphindb'

// 4. 路径别名导入
import { t } from '@i18n'
import { connector } from '@/connector.ts'
```

## 测试

- 测试入口: `test/index.ts`
- 使用 Node.js 原生 `assert/strict`
- 测试触发机制: 在 `out/` 目录创建 `test-dolphindb-extension` 文件，插件激活后自动执行测试

## 关键依赖

- `xshell` - 内部工具库，提供 `Bundler` 构建器、`call` 进程调用、文件操作等
- `dolphindb` - DolphinDB JavaScript SDK
- `vscode-languageclient/languageserver` - LSP 实现
- `@vscode/debugadapter` - DAP 实现

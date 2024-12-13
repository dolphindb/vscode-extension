import { type Position, type Range } from 'vscode-languageserver/node'

import { type IFunctionMetadata, SymbolType, type ISymbol, type IVariableMetadata } from './types'

// Helper 类型定义，用于表示作用域
type Scope = {
    startLine: number
    startChar: number
    endLine: number
    endChar: number
}

export function getFunctionSymbols(text: string, filePath: string): ISymbol[] {
    const symbols: ISymbol[] = []
    const lines = text.split('\n')
    const totalLines = lines.length

    // 正则表达式匹配函数定义的开始
    const funcStartRegex = /^\s*def\s+([a-zA-Z_]\w*)\s*\(/

    // 作用域跟踪
    const scopeStack: Array<{ startLine: number, startChar: number }> = []
    const scopes: Scope[] = []

    // 首先遍历所有行，记录所有的作用域
    for (let i = 0; i < totalLines; i++) {
        const line = lines[i]
        for (let j = 0; j < line.length; j++) {
            const char = line[j]
            if (char === '{') {
                // 遇到 '{'，推入栈
                scopeStack.push({ startLine: i, startChar: j })
            } else if (char === '}') {
                if (scopeStack.length > 0) {
                    const scope = scopeStack.pop()!
                    scopes.push({
                        startLine: scope.startLine,
                        startChar: scope.startChar,
                        endLine: i,
                        endChar: j,
                    })
                }
            }
        }
    }

    // Helper 函数：判断某行某列是否在某个作用域内
    function isPositionInScope(line: number, char: number, scope: Scope): boolean {
        if (line < scope.startLine || line > scope.endLine)
            return false
        if (line === scope.startLine && char < scope.startChar)
            return false
        if (line === scope.endLine && char > scope.endChar)
            return false
        return true
    }

    // Helper 函数：找到变量所在的最内层作用域
    function findInnermostScope(line: number, char: number): Scope | null {
        let innermost: Scope | null = null
        for (const scope of scopes) {
            if (isPositionInScope(line, char, scope)) {
                if (!innermost) {
                    innermost = scope
                } else {
                    // 选择更内层的作用域
                    if (
                        scope.startLine > innermost.startLine ||
                        (scope.startLine === innermost.startLine && scope.startChar > innermost.startChar)
                    ) {
                        innermost = scope
                    }
                }
            }
        }
        return innermost
    }

    let i = 0
    while (i < totalLines) {
        const line = lines[i]
        const match = funcStartRegex.exec(line)
        if (match) {
            const functionName = match[1]
            const defLine = i
            const defColumn = line.indexOf(functionName, line.indexOf('def'))

            // 收集函数上方的注释（支持单行和多行注释）
            let comments = ''
            let commentLine = defLine - 1
            let inBlockComment = false
            const commentLines: string[] = []

            while (commentLine >= 0) {
                const currentLine = lines[commentLine].trim()

                if (inBlockComment) {
                    // 检查是否为多行注释的起始行
                    const startBlockMatch = /^\/\*/.exec(currentLine)
                    if (startBlockMatch) {
                        // 去除起始符号 /* 及其后的内容
                        const content = currentLine.replace(/^\/\*/, '').trim()
                        if (content)
                            commentLines.unshift(content)

                        inBlockComment = false
                        commentLine--
                        continue
                    } else {
                        // 去除可能的 * 符号
                        const lineContent = currentLine.replace(/^\*/, '').trim()
                        commentLines.unshift(lineContent)
                        commentLine--
                        continue
                    }
                } else {
                    // 检查是否为单行注释
                    const singleLineMatch = /^\/\/(.*)/.exec(currentLine)
                    if (singleLineMatch) {
                        commentLines.unshift(singleLineMatch[1].trim())
                        commentLine--
                        continue
                    }

                    // 检查是否为多行注释的结束行
                    const endBlockMatch = /\*\/$/.exec(currentLine)
                    if (endBlockMatch) {
                        // 去除结束符号 */ 及其前的内容
                        const content = currentLine.replace(/\*\/$/, '').trim()
                        if (content)
                            commentLines.unshift(content)

                        inBlockComment = true
                        commentLine--
                        continue
                    }

                    // 如果不是注释行，则停止收集
                    break
                }
            }

            // 将收集到的注释行拼接为一个字符串
            comments = commentLines.join('\n')

            // 提取参数列表
            let paramsText = ''
            let paramsEnd = false
            let parenthesisBalance = 0

            // 找到第一个 '('
            const openParenIndex = line.indexOf('(', match.index)
            if (openParenIndex !== -1) {
                parenthesisBalance = 1
                paramsText += line.slice(openParenIndex + 1)
            }

            // 如果括号未平衡，继续读取后续行
            let j = i + 1
            while (j < totalLines && !paramsEnd) {
                const currentLine = lines[j].trim()
                paramsText += ' ' + currentLine

                for (const char of currentLine)
                    if (char === '(')
                        parenthesisBalance++
                    else if (char === ')') {
                        parenthesisBalance--
                        if (parenthesisBalance === 0) {
                            paramsEnd = true
                            break
                        }
                    }

                if (!paramsEnd)
                    j++
            }

            // 提取到的参数文本应位于第一个 ')' 之前
            const closingParenIndex = paramsText.indexOf(')')
            if (closingParenIndex !== -1)
                paramsText = paramsText.slice(0, closingParenIndex)

            // 解析参数名称，去除所有前导关键字，取最后一个单词作为参数名
            // 支持参数是否被逗号分割
            const argnames = paramsText
                .split(',') // 首先按逗号分割
                .map(param => {
                    const tokens = param.trim().split(/\s+/)
                    return tokens.length > 0 ? tokens[tokens.length - 1] : ''
                })
                .filter(param => param.length > 0)

            // 查找函数定义所在的最内层作用域
            const functionScope = findInnermostScope(defLine, defColumn) || null

            // 定义函数作用域为其所在的最内层作用域
            let scopeRange: [Position, Position]
            if (functionScope) {
                scopeRange = [
                    { line: functionScope.startLine, character: functionScope.startChar },
                    { line: functionScope.endLine, character: functionScope.endChar },
                ]
            } else {
                // 全局作用域，从文件开始到文件结束
                scopeRange = [
                    { line: 0, character: 0 },
                    { line: totalLines - 1, character: lines[totalLines - 1].length },
                ]
            }

            // 定义函数名的 Range
            const nameStartColumn = defColumn
            const nameEndColumn = nameStartColumn + functionName.length
            const nameRange: Range = {
                start: { line: defLine, character: nameStartColumn },
                end: { line: defLine, character: nameEndColumn },
            }

            // 定义函数名的 Position
            const position: Position = { line: defLine, character: nameStartColumn }

            // 创建元数据
            const metadata: IFunctionMetadata = {
                argnames: argnames,
                scope: scopeRange,
                comments: comments,
            }

            // 创建函数 ISymbol 对象
            symbols.push({
                name: functionName,
                type: SymbolType.Function,
                position: position,
                range: nameRange,
                filePath,
                metadata: metadata,
            })

            // 为每个参数创建 Param 符号
            argnames.forEach(arg => {
                // 查找参数名在函数定义行的位置
                const argIndex = line.indexOf(arg, openParenIndex)
                const argColumn = argIndex !== -1 ? argIndex : 0 // 如果参数在当前行未找到，则设为0

                const paramRange: Range = {
                    start: { line: defLine, character: argColumn },
                    end: { line: defLine, character: argColumn + arg.length },
                }

                const paramPosition: Position = { line: defLine, character: argColumn }

                symbols.push({
                    name: arg,
                    type: SymbolType.Param,
                    position: paramPosition,
                    range: paramRange,
                    filePath,
                    // Param 没有 metadata
                })
            })

            // 跳过函数体，继续解析下一个
            i = j + 1
        } else
            i++

    }

    console.log(JSON.stringify(symbols, null, 2))
    return symbols
}

export function getVariableSymbols(text: string, filePath: string): ISymbol[] {
    const symbols: ISymbol[] = []
    const lines = text.split('\n')
    const totalLines = lines.length

    // 正则表达式匹配变量定义，避免匹配 '==' 和 '==='
    const variableRegex = /^\s*([a-zA-Z_]\w*)\s*=\s*(?![=])/

    // 栈用于跟踪当前的作用域
    const scopeStack: Array<{ startLine: number, startChar: number }> = []
    // 列表用于存储所有的作用域
    const scopes: Array<{ startLine: number, startChar: number, endLine: number, endChar: number }> = []

    // 遍历所有行，记录所有的作用域
    for (let i = 0; i < totalLines; i++) {
        const line = lines[i]
        for (let j = 0; j < line.length; j++) {
            const char = line[j]
            if (char === '{')
                // 遇到 '{'，推入栈
                scopeStack.push({ startLine: i, startChar: j })
            else if (char === '}')
                if (scopeStack.length > 0) {
                    const scope = scopeStack.pop()!
                    scopes.push({
                        startLine: scope.startLine,
                        startChar: scope.startChar,
                        endLine: i,
                        endChar: j,
                    })
                }
        }
    }

    // Helper 函数：判断某行某列是否在某个作用域内
    function isPositionInScope(line: number, char: number, scope: { startLine: number, startChar: number, endLine: number, endChar: number }): boolean {
        if (line < scope.startLine || line > scope.endLine)
            return false
        if (line === scope.startLine && char < scope.startChar)
            return false
        if (line === scope.endLine && char > scope.endChar)
            return false
        return true
    }

    // Helper 函数：找到变量所在的最内层作用域
    function findInnermostScope(line: number, char: number): { startLine: number, startChar: number, endLine: number, endChar: number } | null {
        let innermost: { startLine: number, startChar: number, endLine: number, endChar: number } | null = null
        for (const scope of scopes)
            if (isPositionInScope(line, char, scope))
                if (!innermost)
                    innermost = scope
                else
                    // 选择更内层的作用域
                    if (
                        scope.startLine > innermost.startLine ||
                        (scope.startLine === innermost.startLine && scope.startChar > innermost.startChar)
                    )
                        innermost = scope

        return innermost
    }

    // 遍历所有行，查找变量定义
    let i = 0
    while (i < totalLines) {
        const line = lines[i]
        const match = variableRegex.exec(line)
        if (match) {
            const variableName = match[1]
            const defLine = i
            const equalIndex = line.indexOf('=', match.index)
            const defColumn = line.indexOf(variableName, match.index)

            // 收集变量上方的注释（支持单行和多行注释）
            let comments = ''
            let commentLine = defLine - 1
            let inBlockComment = false
            const commentLines: string[] = []

            while (commentLine >= 0) {
                const currentLine = lines[commentLine].trim()

                if (inBlockComment) {
                    // 检查是否为多行注释的起始行
                    const startBlockMatch = /^\/\*/.exec(currentLine)
                    if (startBlockMatch) {
                        // 去除起始符号 /* 及其后的内容
                        const content = currentLine.replace(/^\/\*/, '').trim()
                        if (content)
                            commentLines.unshift(content)

                        inBlockComment = false
                        commentLine--
                        continue
                    } else {
                        // 去除可能的 * 符号
                        const lineContent = currentLine.replace(/^\*/, '').trim()
                        commentLines.unshift(lineContent)
                        commentLine--
                        continue
                    }
                } else {
                    // 检查是否为单行注释
                    const singleLineMatch = /^\/\/(.*)/.exec(currentLine)
                    if (singleLineMatch) {
                        commentLines.unshift(singleLineMatch[1].trim())
                        commentLine--
                        continue
                    }

                    // 检查是否为多行注释的结束行
                    const endBlockMatch = /\*\/$/.exec(currentLine)
                    if (endBlockMatch) {
                        // 去除结束符号 */ 及其前的内容
                        const content = currentLine.replace(/\*\/$/, '').trim()
                        if (content)
                            commentLines.unshift(content)

                        inBlockComment = true
                        commentLine--
                        continue
                    }

                    // 如果不是注释行，则停止收集
                    break
                }
            }

            // 将收集到的注释行拼接为一个字符串
            comments = commentLines.join('\n')

            // 确定变量的作用域
            const innermostScope = findInnermostScope(defLine, defColumn)
            let scopeRange: [Position, Position]

            if (innermostScope)
                scopeRange = [
                    { line: defLine, character: defColumn },
                    { line: innermostScope.endLine, character: innermostScope.endChar },
                ]
            else
                // 全局作用域，从变量定义位置开始到文件末尾
                scopeRange = [
                    { line: defLine, character: defColumn },
                    { line: totalLines - 1, character: lines[totalLines - 1].length },
                ]

            // 定义变量名的 Range
            const nameStartColumn = defColumn
            const nameEndColumn = nameStartColumn + variableName.length
            const nameRange: Range = {
                start: { line: defLine, character: nameStartColumn },
                end: { line: defLine, character: nameEndColumn },
            }

            // 定义变量名的 Position
            const position: Position = { line: defLine, character: nameStartColumn }

            // 创建元数据
            const metadata: IVariableMetadata = {
                scope: scopeRange,
                comments: comments,
            }

            // 创建 ISymbol 对象
            symbols.push({
                name: variableName,
                type: SymbolType.Variable,
                position: position,
                range: nameRange,
                filePath,
                metadata: metadata,
            })

            // 继续解析下一行
            i++
        } else
            // 非变量定义行，继续
            i++

    }

    return symbols
}

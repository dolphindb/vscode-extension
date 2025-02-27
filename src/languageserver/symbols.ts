
import { type TextDocument } from 'vscode-languageserver-textdocument'

import { type Position, type Range } from 'vscode-languageserver/node'

import { readFileByPath } from './utils.ts'

import { type DdbModule, type ISymbol, SymbolType, type IFunctionMetadata, type IVariableMetadata, type IParamMetadata } from './types.ts'

interface IFileSymbols {
    module?: string
    use: string[]
    symbols: ISymbol[]
}

export class SymbolService {
    // 标识符可以是 uri 或 filePath，textDocument 的时候用 uri，没有办法获取 uri 的时候用 filePath
    symbols = new Map<string, IFileSymbols>()
    
    getSymbols (filePath: string): ISymbol[] {
        return this.symbols.get(filePath)?.symbols || [ ]
    }
    
    getUsedModules (filePath: string): string[] {
        return this.symbols.get(filePath)?.use || [ ]
    }
    
    buildSymbolsByFile (raw_text: string, filePath: string): ISymbol[] {
        // 转换 CRLF 到 LF
        const text = raw_text.replaceAll('\r\n', '\n')
        return [
            ...getFunctionSymbols(text, filePath),
            ...getVariableSymbols(text, filePath),
        ]
    }
    
    buildSymbolByDocument (document: TextDocument) {
        const filePath = document.uri
        const text = document.getText()
        const symbols = this.buildSymbolsByFile(text, filePath)
        const use = getFileUsedModule(text)
        
        this.symbols.set(filePath, {
            symbols,
            use,
            module: getFileModule(text)
        })
    }
    
    async buildSymbolByModule (module: DdbModule) {
        if (!module.moduleName)
            return
        const text = await readFileByPath(module.filePath)
        const symbols = this.buildSymbolsByFile(text, module.filePath)
        this.symbols.set(module.filePath, {
            symbols,
            use: [ ],
            module: module.moduleName
        })
    }
    
    public deleteSymbolByUri (uri: string) {
        this.symbols.delete(uri)
    }
    
    onCloseDocument (document: TextDocument) {
        this.symbols.delete(document.uri)
    }
}

export const symbolService = new SymbolService()



// Helper 类型定义，用于表示作用域
type Scope = {
    startLine: number
    startChar: number
    endLine: number
    endChar: number
}

// 正则表达式
// 正则表达式匹配变量定义，避免匹配 '==' 和 '==='
const variableRegex = /^(.*?)??([a-zA-Z0-9_]\w*)\s*=\s*(?![=])(.*)$/
// 正则表达式匹配函数定义的开始
const funcStartRegex = /^\s*def\s+([a-zA-Z0-9_]\w*)\s*\(/

function findScopes (lines: string[]): Scope[] {
    const scopeStack: { startLine: number, startChar: number }[] = [ ]
    const scopes: Scope[] = [ ]
    
    for (let i = 0;  i < lines.length;  i++) {
        const line = lines[i]
        for (let j = 0;  j < line.length;  j++) {
            const char = line[j]
            if (char === '{')
                scopeStack.push({ startLine: i, startChar: j })
            else if (char === '}' && scopeStack.length > 0) {
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
    return scopes
}

function isPositionInScope (line: number, char: number, scope: Scope): boolean {
    if (line < scope.startLine || line > scope.endLine)
        return false
    if (line === scope.startLine && char < scope.startChar)
        return false
    if (line === scope.endLine && char > scope.endChar)
        return false
    return true
}

function findInnermostScope (line: number, char: number, scopes: Scope[]): Scope | null {
    let innermost: Scope | null = null
    for (const scope of scopes)
        if (isPositionInScope(line, char, scope))
            if (!innermost || (
                scope.startLine > innermost.startLine ||
                (scope.startLine === innermost.startLine && scope.startChar > innermost.startChar)
            ))
                innermost = scope
                
                
                
    return innermost
}

function collectComments (lines: string[], defLine: number): string {
    let commentLine = defLine - 1
    let inBlockComment = false
    const commentLines: string[] = [ ]
    
    while (commentLine >= 0) {
        const currentLine = lines[commentLine].trim()
        
        if (inBlockComment) {
            const startBlockMatch = /^\/\*/.exec(currentLine)
            if (startBlockMatch) {
                const content = currentLine.replace(/^\/\*/, '').trim()
                if (content)
                    commentLines.unshift(content)
                inBlockComment = false
            } else {
                const lineContent = currentLine.replace(/^\*/, '').trim()
                commentLines.unshift(lineContent)
            }
        } else {
            const singleLineMatch = /^\/\/(.*)/.exec(currentLine)
            if (singleLineMatch)
                commentLines.unshift(singleLineMatch[1].trim())
            else {
                const endBlockMatch = /\*\/$/.exec(currentLine)
                if (endBlockMatch) {
                    const content = currentLine.replace(/\*\/$/, '').replace(/^\/\*/, '').trim()
                    if (content)
                        commentLines.unshift(content)
                    if (!/^\/\*/.exec(currentLine))
                        inBlockComment = true
                } else
                    break
                    
            }
        }
        commentLine--
    }
    
    return commentLines.join('\n')
}

export function getFunctionSymbols (text: string, filePath: string): ISymbol[] {
    const symbols: ISymbol[] = [ ]
    const lines = text.split('\n')
    const totalLines = lines.length
    const scopes = findScopes(lines)
    
    let i = 0
    while (i < totalLines) {
        const line = lines[i]
        const match = funcStartRegex.exec(line)
        if (match) {
            const functionName = match[1]
            const defLine = i
            const defColumn = line.indexOf(functionName, line.indexOf('def'))
            
            const comments = collectComments(lines, defLine)
            
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
                .map(param => param.trim().split('=')[0].trim())
                .filter(param => param.length > 0)
                
            // 查找函数定义所在的最内层作用域（即函数的外部作用域）
            const functionScope = findInnermostScope(defLine, defColumn, scopes)
            
            // 查找函数体的起始 '{'
            let braceFound = false
            let braceLine = defLine
            let braceColumn = -1
            
            // 首先检查函数定义行是否包含 '{'
            const braceMatchInDef = /\{/.exec(line.slice(openParenIndex + 1))
            if (braceMatchInDef) {
                braceFound = true
                braceLine = defLine
                braceColumn = openParenIndex + 1 + braceMatchInDef.index
            } else
                // 如果函数定义行没有 '{'，继续查找后续行
                for (let k = j;  k < totalLines;  k++) {
                    const braceMatch = /\{/.exec(lines[k])
                    if (braceMatch) {
                        braceFound = true
                        braceLine = k
                        braceColumn = braceMatch.index
                        break
                    }
                    // 如果遇到分号，可能是函数结束
                    if (lines[k].includes(';'))
                        break
                }
                
            if (!braceFound) {
                // 未找到 '{'，跳过此函数
                i = j + 1
                continue
            }
            
            // 寻找对应的 '}' 以确定函数体的范围
            let braceBalanceScope = 1
            let endBraceLine = braceLine
            let endBraceColumn = braceColumn
            let foundClosing = false
            
            for (let k = braceLine;  k < totalLines;  k++) {
                const currentLine = lines[k]
                // 开始从第一个 '{' 之后的位置开始查找
                const startChar = k === braceLine ? braceColumn + 1 : 0
                for (let c = startChar;  c < currentLine.length;  c++) {
                    const char = currentLine[c]
                    if (char === '{')
                        braceBalanceScope++
                    else if (char === '}') {
                        braceBalanceScope--
                        if (braceBalanceScope === 0) {
                            endBraceLine = k
                            endBraceColumn = c
                            foundClosing = true
                            break
                        }
                    }
                }
                if (foundClosing)
                    break
            }
            
            if (!foundClosing) {
                // 未找到闭合的 '}'，跳过此函数
                i = braceLine + 1
                continue
            }
            
            // 定义函数体的范围
            const functionBodyScope: [Position, Position] = [
                { line: braceLine, character: braceColumn },
                { line: endBraceLine, character: endBraceColumn },
            ]
            
            const top_level = !functionScope
            const functionScopeRange: [Position, Position] = functionScope
                ? [
                    { line: functionScope.startLine, character: functionScope.startChar },
                    { line: functionScope.endLine, character: functionScope.endChar },
                ]
                : [
                    { line: 0, character: 0 },
                    { line: totalLines - 1, character: lines[totalLines - 1].length },
                ]
                
            const nameRange: Range = {
                start: { line: defLine, character: defColumn },
                end: { line: defLine, character: defColumn + functionName.length },
            }
            
            const position: Position = { line: defLine, character: defColumn }
            
            symbols.push({
                name: functionName,
                type: SymbolType.Function,
                position: position,
                range: nameRange,
                filePath,
                metadata: {
                    argnames,
                    scope: functionScopeRange,
                    top_level,
                    comments,
                },
            })
            
            // 为每个参数创建 Param 符号，并设置其作用域为函数体内部
            argnames.forEach(arg => {
                // 在参数列表中查找参数的位置
                const paramRegex = new RegExp(`\\b${arg}\\b`)
                const paramMatch = paramRegex.exec(paramsText)
                let argLine = defLine
                let argColumn = 0
                
                if (paramMatch)
                    // 计算参数在函数定义行的位置
                    argColumn = openParenIndex + 1 + paramMatch.index
                else
                    // 如果参数在当前行未找到，尝试在后续行查找
                    for (let searchLine = i + 1;  searchLine <= j;  searchLine++) {
                        const searchMatch = new RegExp(`\\b${arg}\\b`).exec(lines[searchLine])
                        if (searchMatch) {
                            argLine = searchLine
                            argColumn = searchMatch.index
                            break
                        }
                    }
                    
                    
                const paramRange: Range = {
                    start: { line: argLine, character: argColumn },
                    end: { line: argLine, character: argColumn + arg.length },
                }
                
                symbols.push({
                    name: arg,
                    type: SymbolType.Param,
                    position: { line: argLine, character: argColumn },
                    range: paramRange,
                    filePath,
                    metadata: {
                        scope: functionBodyScope,
                        funcname: functionName,
                    },
                })
            })
            
            // 跳过函数体，继续解析下一个
            i = endBraceLine + 1
        } else
            i++
            
    }
    
    return symbols
}

export function getVariableSymbols (text: string, filePath: string): ISymbol[] {
    const symbols: ISymbol[] = [ ]
    const lines = text.split('\n')
    const totalLines = lines.length
    const scopes = findScopes(lines)
    
    let i = 0
    while (i < totalLines) {
        const line = lines[i]
        const match = variableRegex.exec(line)
        if (match && !funcStartRegex.exec(line)) {
            const variableName = match[2]
            const defLine = i
            const defColumn = line.indexOf(variableName)
            
            const comments = collectComments(lines, defLine)
            
            const innermostScope = findInnermostScope(defLine, defColumn, scopes)
            const scopeRange: [Position, Position] = innermostScope
                ? [
                    { line: defLine, character: defColumn },
                    { line: innermostScope.endLine, character: innermostScope.endChar },
                ]
                : [
                    { line: defLine, character: defColumn },
                    { line: totalLines - 1, character: lines[totalLines - 1].length },
                ]
                
            const nameRange: Range = {
                start: { line: defLine, character: defColumn },
                end: { line: defLine, character: defColumn + variableName.length },
            }
            
            symbols.push({
                name: variableName,
                type: SymbolType.Variable,
                position: { line: defLine, character: defColumn },
                range: nameRange,
                filePath,
                metadata: {
                    scope: scopeRange,
                    comments,
                },
            })
        }
        // 继续解析下一行, 不管匹不匹配都要加一
        i++
    }
    
    return symbols
}

export function getFileModule (raw_text: string): string | undefined {
    // 查找第一个 module 声明语句。例如：
    // module fileLog
    
    const text = raw_text.replaceAll('\r\n', '\n')
    const lines = text.split('\n')
    
    for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('module')) {
            const match = /^module\s+([a-zA-Z0-9_:]*)/.exec(trimmed)
            if (match) 
                return match[1]
            
        }
    }
    
    return undefined
}

export function getFileUsedModule (text: string): string[] {
    // 正则表达式匹配 `use` 语句，捕获模块名部分
    const useRegex = /^use\s+([^;\/\/\s]+(?:\s*::\s*[^;\/\/\s]+)*);?/
    
    return text
        // 按照换行符分割文本，兼容不同的换行符
        .split(/\r?\n/)
        // 逐行处理
        .map(line => {
            // 去除行首尾空白字符
            const trimmedLine = line.trim()
            // 去除 `//` 后的注释部分
            const noComment = trimmedLine.split('//')[0].trim()
            return noComment
        })
        // 过滤出以 `use` 开头的行
        .filter(line => line.startsWith('use'))
        // 使用正则表达式提取模块名
        .map(line => {
            const match = useRegex.exec(line)
            return match ? match[1].replace(/\s*::\s*/g, '::') : null
        })
        // 过滤掉未匹配成功的行
        .filter((moduleName): moduleName is string => moduleName !== null)
}

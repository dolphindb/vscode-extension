import { type Position, type Range } from 'vscode-languageserver/node'
 
import { type IFunctionMetadata, SymbolType, type ISymbol } from './types'

export function getFunctionSymbols (text: string, filePath: string): ISymbol[] {
    const symbols: ISymbol[] = [ ]
    const lines = text.split('\n')
    const totalLines = lines.length
    
    // 正则表达式匹配函数定义的开始
    const funcStartRegex = /^\s*def\s+([a-zA-Z_]\w*)\s*\(/
    
    let i = 0
    while (i < totalLines) {
        const line = lines[i]
        const match = funcStartRegex.exec(line)
        if (match) {
            const functionName = match[1]
            const defLine = i
            const defColumn = line.indexOf(functionName, line.indexOf('def'))
            
            // 收集函数上方的注释（如果有）
            let comments = ''
            let commentLine = defLine - 1
            while (commentLine >= 0) {
                const commentMatch = /^\s*\/\/(.*)/.exec(lines[commentLine])
                if (commentMatch) {
                    // 将注释按顺序添加
                    comments = commentMatch[1].trim() + (comments ? '\n' + comments : '')
                    commentLine--
                } else 
                    break
                
            }
            
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
            
            // 寻找对应的 '}' 以确定函数作用域
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
            
            // 定义函数作用域范围
            const scope: [Position, Position] = [
                { line: braceLine, character: braceColumn },
                { line: endBraceLine, character: endBraceColumn },
            ]
            
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
                scope: scope,
                comments: comments,
            }
            
            // 创建 ISymbol 对象
            symbols.push({
                name: functionName,
                type: SymbolType.Function,
                position: position,
                range: nameRange,
                filePath,
                metadata: metadata,
            })
            
            // 跳过函数体，继续解析下一个
            i = endBraceLine + 1
        } else 
            i++ 
        
    }
    
    return symbols
}

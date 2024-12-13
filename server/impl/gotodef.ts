import * as fsp from 'fs/promises'

import {
    type DefinitionParams,
    type Location,
    type Position,
    type Range,
    type Hover,
    type MarkupContent,
    MarkupKind
} from 'vscode-languageserver/node'

import { connection } from './connection'
import { documents } from './documents'
import { symbolService } from './symbols/symbols'
import { isPositionInScope } from './snippets'
import { type IFunctionMetadata, SymbolType, type ISymbol, type IParamMetadata, type IVariableMetadata } from './symbols/types'

// 通用函数：获取光标所在的单词
function getWordAtPosition (text: string, position: Position): string | null {
    const lines = text.split('\n')
    if (position.line >= lines.length) 
        return null
    
    
    const line = lines[position.line]
    if (position.character >= line.length) 
        return null
    
    
    const wordRegex = /[a-zA-Z_][a-zA-Z0-9_]*/g // 或者 /[a-zA-Z_]+/g 取决于您的变量名规则
    
    let match: RegExpExecArray | null
    while ((match = wordRegex.exec(line)) !== null) {
        const start = match.index
        const end = match.index + match[0].length
        
        if (position.character >= start && position.character <= end) 
            return match[0]
        
    }
    
    return null
}

// 通用函数：获取当前作用域内的符号
function getSymbolsInScope (symbols: ISymbol[], position: Position): ISymbol[] {
    const symbolsInScope = symbols.filter(s => {
        if (!s.metadata || !('scope' in s.metadata)) 
            return false
        
        return isPositionInScope(position, s.metadata!.scope as [Position, Position])
    })
    
    // 按作用域起始位置降序排序，起始位置越靠近当前位置的作用域越靠前
    symbolsInScope.sort((a, b) => {
        const aStart = a.metadata!.scope[0]
        const bStart = b.metadata!.scope[0]
        if (aStart.line !== bStart.line) 
            return bStart.line - aStart.line
        
        return bStart.character - aStart.character
    })
    
    return symbolsInScope
}

// 通用函数：查找符号
function findSymbol (symbolsInScope: ISymbol[], symbols: ISymbol[], word: string): ISymbol | null {
    let symbol = symbolsInScope.find(s => s.name === word)
    const funcDef = symbols.find(s => s.name === word && s.type === SymbolType.Function)
    if (funcDef) 
        symbol = funcDef
    
    
    return symbol || null
}

// 通用函数：生成 Hover 内容
function generateHoverContent (symbol: ISymbol): MarkupContent | null {
    let contents: string[] = [ ]
    
    switch (symbol.type) {
        case SymbolType.Function:
            const funcMeta = symbol.metadata as IFunctionMetadata
            if (funcMeta) {
                const params = funcMeta.argnames.join(', ')
                contents.push(`**Function** \`${symbol.name}(${params})\``)
                if (funcMeta.comments) 
                    contents.push(`${funcMeta.comments.replaceAll('\n', '\\\n')}`)
                
            }
            break
        case SymbolType.Variable:
            const varMeta = symbol.metadata as IVariableMetadata
            if (varMeta) {
                contents.push(`**Variable** \`${symbol.name}\``)
                if (varMeta.comments) 
                    contents.push(`${varMeta.comments.replaceAll('\n', '\\\n')}`)
                
            }
            break
        case SymbolType.Param:
            const paramMeta = symbol.metadata as IParamMetadata
            if (paramMeta) 
                contents.push(`**Parameter** \`${symbol.name}\` of function \`${paramMeta.funcname}\``)
            
            break
        case SymbolType.Table:
            contents.push(`**Table** \`${symbol.name}\``)
            break
        case SymbolType.FieldName:
            contents.push(`**Field** \`${symbol.name}\``)
            break
        case SymbolType.Database:
            contents.push(`**Database** \`${symbol.name}\``)
            break
        default:
            contents.push(`**Symbol** \`${symbol.name}\``)
    }
    
    return {
        kind: MarkupKind.Markdown,
        value: contents.join('\n\n')
    }
}

// 通用函数：获取符号
async function getSymbolAtPosition (documentUri: string, position: Position): Promise<ISymbol | null> {
    const document = documents.get(documentUri)
    if (!document) 
        return null
    
    
    const text = document.getText()
    const word = getWordAtPosition(text, position)
    if (!word) 
        return null
    
    
    const symbols = symbolService.getSymbols(document.uri)
    const symbolsInScope = getSymbolsInScope(symbols, position)
    const symbol = findSymbol(symbolsInScope, symbols, word)
    
    return symbol
}

// 已有的定义查找处理器
connection.onDefinition(async (params: DefinitionParams) => {
    const symbol = await getSymbolAtPosition(params.textDocument.uri, params.position)
    if (!symbol) 
        return null
    
    
    // 创建 Location 对象
    const location: Location = {
        uri: symbol.filePath, // 确保使用符号所在文件的路径
        range: {
            start: symbol.position,
            end: symbol.range ? symbol.range.end : symbol.position,
        },
    }
    
    return location
})

// 新增的 Hover 处理器
connection.onHover(async params => {
    const symbol = await getSymbolAtPosition(params.textDocument.uri, params.position)
    if (!symbol) 
        return null
    
    
    // 生成 Hover 内容
    const hoverContent = generateHoverContent(symbol)
    
    if (hoverContent) 
        return {
            contents: hoverContent,
            range: {
                start: symbol.position,
                end: symbol.range ? symbol.range.end : symbol.position,
            }
        } as Hover
    
    
    return null
})

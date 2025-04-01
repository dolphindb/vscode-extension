import {
    type DefinitionParams,
    type Position,
    type Hover,
    type MarkupContent,
    MarkupKind
} from 'vscode-languageserver/node'

import { connection } from './connection.ts'
import { documents } from './documents.ts'
import { symbolService } from './symbols.ts'
import { isPositionInScope } from './completions.ts'
import { type IFunctionMetadata, SymbolType, type ISymbol, type IParamMetadata, type IVariableMetadata } from './types.ts'
import { ddbModules } from './modules.ts'
import { buildFunctionCommentDocs } from './utils.ts'

// 通用函数：获取光标所在的单词
function getWordAtPosition (text: string, position: Position): { word: string | null, isFunction: boolean } {
    const lines = text.split('\n')
    if (position.line >= lines.length)
        return { word: null, isFunction: false }
        
        
    const line = lines[position.line]
    if (position.character > line.length)
        return { word: null, isFunction: false }
        
        
    const wordRegex = /[a-zA-Z_][a-zA-Z0-9::_]*/g // 或者 /[a-zA-Z_]+/g 取决于您的变量名规则
    
    let match: RegExpExecArray | null
    while ((match = wordRegex.exec(line)) !== null) {
        const start = match.index
        const end = match.index + match[0].length
        
        if (position.character >= start && position.character <= end) {
            // 检查word后面是否有(，判断是否为函数
            const restOfLine = line.substring(end).trimStart()
            const isFunction = restOfLine.startsWith('(')
            return { word: match[0], isFunction }
        }
    }
    
    return { word: null, isFunction: false }
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
function findSymbols (symbolsInScope: ISymbol[], symbols: ISymbol[], word: string): ISymbol[] {
    let foundSymbols = symbolsInScope.filter(s => s.name === word)
    const funcDefs = symbols.filter(s => s.name === word && s.type === SymbolType.Function)
    if (funcDefs.length > 0)
        foundSymbols.push(...funcDefs)
        
        
    return foundSymbols
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
                    contents.push(`${buildFunctionCommentDocs(funcMeta.comments).value}`)
                    
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
async function getSymbolsAtPosition (documentUri: string, position: Position): Promise<ISymbol[]> {
    const document = documents.get(documentUri)
    if (!document)
        return [ ]
        
        
    const text = document.getText()
    const { word, isFunction } = getWordAtPosition(text, position)
    if (!word)
        return [ ]
        
        
    const symbols = symbolService.getSymbols(document.uri)
    const symbolsInScope = getSymbolsInScope(symbols, position)
    let foundSymbols = findSymbols(symbolsInScope, symbols, word)
    // 在本文件内找不到，考虑引入的模块
    if (foundSymbols.length < 1) {
        const usedModules = symbolService.getUsedModules(document.uri)
        if (word.includes('::')) { // 完全路径的其他模块函数引用
            const moduleName = splitByLastDoubleColon(word).prefix
            if (usedModules.includes(moduleName)) {
                const modulePath = ddbModules.getModules().find(m => m.moduleName === moduleName)?.filePath ?? ''
                const moduleSymbols = symbolService.getSymbols(modulePath)
                // 只找函数，并且必须 top_level
                foundSymbols = moduleSymbols.filter(
                    s => s.type === SymbolType.Function
                        && s.name === splitByLastDoubleColon(word).suffix
                        && (s as ISymbol<SymbolType.Function>).metadata.top_level
                )
            }
        } else
            // 非完全路径的函数引用，在所有已经利用的模块中查找
            for (const moduleName of usedModules) {
                const modulePath = ddbModules.getModules().find(m => m.moduleName === moduleName)?.filePath ?? ''
                const moduleSymbols = symbolService.getSymbols(modulePath)
                foundSymbols = foundSymbols.concat(moduleSymbols.filter(s => s.type === SymbolType.Function && s.name === word))
            }
            
    }
    
    if (isFunction) 
        foundSymbols = foundSymbols.filter(s => s.type === SymbolType.Function)
    else 
        foundSymbols = foundSymbols.filter(s => s.type !== SymbolType.Function)
    return foundSymbols
}

function getModuleImportAtPosition (documentUri: string, position: Position): ISymbol | null {
    const document = documents.get(documentUri)
    if (!document)
        return null
        
        
    const text = document.getText()
    const line = text.split('\n')[position.line]
    const moduleName = line.replace('use', '').replace(/\/\/.*$/, '').trim()
    const mod = ddbModules.getModules().find(m => m.moduleName === moduleName)
    if (mod) {
        const moduleSymbol: ISymbol = {
            name: moduleName,
            type: SymbolType.File,
            filePath: mod.filePath,
            position: { line: position.line, character: 0 },
        }
        return moduleSymbol
    } else
        return null
}

function splitByLastDoubleColon (input: string): { prefix: string, suffix: string } {
    const delimiter = '::'
    const lastIndex = input.lastIndexOf(delimiter)
    
    if (lastIndex === -1)
        // 如果找不到 "::"，返回原始字符串作为前缀，后缀为空字符串
        return { prefix: input, suffix: '' }
        
        
    // 提取前缀和后缀
    const prefix = input.substring(0, lastIndex)
    const suffix = input.substring(lastIndex + delimiter.length)
    
    return { prefix, suffix }
}

// 定义查找处理器
connection.onDefinition(async ({ textDocument, position }: DefinitionParams) => {
    const symbols = await getSymbolsAtPosition(textDocument.uri, position) 
        || [getModuleImportAtPosition(textDocument.uri, position)]
    
    if (symbols.length < 1)
        return null 
    
    return symbols.map(s => ({
        uri: s.filePath,
        range: {
            start: s.position,
            end: s.range?.end || s.position
        }
    }))
})

// Hover 处理器
connection.onHover(async params => {
    const symbols = await getSymbolsAtPosition(params.textDocument.uri, params.position)
    if (symbols.length < 1)
        return null
        
    const symbol = symbols[0]
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

import { InsertTextFormat, CompletionItemKind, type TextDocumentPositionParams, type CompletionItem, type Position } from 'vscode-languageserver/node'

import { symbolService } from './symbols/symbols'
import { type IFunctionMetadata, IParamMetadata, type ISymbol, type IVariableMetadata, SymbolType } from './symbols/types'

class SnippetService {

    getFunctionSnippets (position: TextDocumentPositionParams): CompletionItem[] {
        const symbols = symbolService.getSymbols(position.textDocument.uri)
        const functionSymbols: ISymbol<SymbolType.Function>[] = symbols.filter(s => s.type === SymbolType.Function) as ISymbol<SymbolType.Function>[]
        const functionCompletions: CompletionItem[] = functionSymbols.map(s => {
            const metadata = s.metadata as IFunctionMetadata
            const argumentCompletions = metadata.argnames.map((arg, i) => {
                return `\$\{${i + 1}:${arg}\}`
            })
            return {
                label: s.name,
                kind: CompletionItemKind.Function,
                documentation: s.metadata?.comments ?? '',
                insertText:
                    `${s.name}(${argumentCompletions.join(', ')})`,
                insertTextFormat: InsertTextFormat.Snippet
            }
        })
        return [...functionCompletions]
    }
    
    getVariableSnippets (position: TextDocumentPositionParams): CompletionItem[] {
        const completionItems: CompletionItem[] = [ ]
        const uri = position.textDocument.uri
        const currentPos = position.position
        
        // 获取所有符号
        const symbols: ISymbol[] = symbolService.getSymbols(uri)
        
        
        // 找出所有作用域包含当前位置的符号
        const symbolsInScope = symbols.filter(symbol => {
            if (!symbol.metadata || !('scope' in symbol.metadata))
                return false
            return isPositionInScope(currentPos, symbol.metadata.scope as [Position, Position])
        })
        
        if (symbolsInScope.length === 0)
            return completionItems
            
        const notDuplicateSymbols: ISymbol[] = [ ]
        const duplicateSymbols: ISymbol[] = [ ]
        for (const symbol of symbolsInScope)
            // 不要滤掉不重复的符号
            if (!hasDuplicatesByKey(symbolsInScope, 'name'))
                notDuplicateSymbols.push(symbol)
            else
                duplicateSymbols.push(symbol)
                
                
        // 按作用域起始位置降序排序，起始位置越靠近当前位置的作用域越靠前
        duplicateSymbols.sort((a, b) => {
            const aStart = a.metadata!.scope[0]
            const bStart = b.metadata!.scope[0]
            if (aStart.line !== bStart.line)
                return bStart.line - aStart.line
                
            return bStart.character - aStart.character
        })
        
        // 获取最靠近的作用域起始位置
        let closestSymbols: ISymbol[] = [ ]
        if (duplicateSymbols.length > 0) {
            const closestScopeStart = duplicateSymbols[0].metadata!.scope[0]
            closestSymbols = duplicateSymbols.filter(symbol => {
                const scopeStart = symbol.metadata!.scope[0]
                return scopeStart.line === closestScopeStart.line && scopeStart.character === closestScopeStart.character
            })
        }
        
        const symbolsToComplete = [...notDuplicateSymbols, ...closestSymbols]
        
        // 生成补全项
        symbolsToComplete.forEach(symbol => {
            if (symbol.type === SymbolType.Variable && symbol.metadata) {
                const varMeta = symbol.metadata as IVariableMetadata
                completionItems.push({
                    label: symbol.name,
                    kind: CompletionItemKind.Variable,
                    detail: varMeta.comments || '',
                })
            } else if (symbol.type === SymbolType.Param && symbol.metadata) 
                completionItems.push({
                    label: symbol.name,
                    kind: CompletionItemKind.Variable,
                    detail: 'parameter',
                })
            
        })
        
        return completionItems
    }
    
    complete (position: TextDocumentPositionParams): CompletionItem[] {
        return [
            {
                label: 'def',
                kind: CompletionItemKind.Snippet,
                documentation: 'Define a function',
                insertText: [
                    'def ${1:functionName}(${2:params}) {',
                    '\t${3:// body}',
                    '}'
                ].join('\n'),
                insertTextFormat: InsertTextFormat.Snippet
            },
            ...this.getFunctionSnippets(position),
            ...this.getVariableSnippets(position),
        ]
    }
    
    
}

// 辅助函数：判断当前位置是否在作用域内
export function isPositionInScope (pos: Position, scope: [Position, Position]) {
    const [start, end] = scope
    if (pos.line < start.line || pos.line > end.line)
        return false
    if (pos.line === start.line && pos.character < start.character)
        return false
    if (pos.line === end.line && pos.character > end.character)
        return false
    return true
}

function hasDuplicatesByKey (arr, key) {
    const seen = new Map() // 或使用普通对象 {}  但 Map 效率更高
    
    for (const item of arr) {
        if (seen.has(item[key]))
            return true
            
        seen.set(item[key], item)
    }
    return false
}

export const snippetService = new SnippetService

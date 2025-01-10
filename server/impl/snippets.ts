import { InsertTextFormat, CompletionItemKind, type TextDocumentPositionParams, type CompletionItem, type Position, InsertTextMode, MarkupKind, TextEdit } from 'vscode-languageserver/node'

import { symbolService } from './symbols/symbols'
import { type IFunctionMetadata, type IParamMetadata, type ISymbol, type IVariableMetadata, SymbolType } from './symbols/types'
import { ddbModules } from './modules'
import { documents } from './documents'

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
                    documentation: varMeta.comments || '',
                })
            } else if (symbol.type === SymbolType.Param && symbol.metadata)
                completionItems.push({
                    label: symbol.name,
                    kind: CompletionItemKind.Variable,
                    detail: `Parameter of ${(symbol.metadata as IParamMetadata).funcname}`,
                })
                
        })
        
        return completionItems
    }
    
    getModuleUseSnippets (position: TextDocumentPositionParams): CompletionItem[] {
        const items: CompletionItem[] = [ ]
        const allModules = ddbModules.getModules().filter(module => module.moduleName)
        for (const module of allModules) {
            const moduleName = module.moduleName
            const textDocument = documents.get(position.textDocument.uri)
            const line = textDocument.getText({
                start: { line: position.position.line, character: 0 },
                end: { line: position.position.line + 1, character: 0 }
            })
            const insertText = line.trim().startsWith('use') ? `${moduleName}` : `use ${moduleName}`
            items.push({
                label: `use ${moduleName}`,
                kind: CompletionItemKind.Module,
                documentation: `Use module ${moduleName}`,
                insertText: insertText,
            })
        }
        
        return items
    }
    
    getModuleTopLevelFunctions (position: TextDocumentPositionParams): CompletionItem[] {
        const documentUri = position.textDocument.uri
        const uses: string[] = symbolService.symbols.get(documentUri)?.use ?? [ ]
        const currentPisitionModuleName = symbolService.symbols.get(documentUri)?.module
        const items: CompletionItem[] = [ ]
        const allModules = ddbModules.getModules().filter(module => module.moduleName)
        for (const module of allModules) {
            const modulePath = module.filePath
            const symbolsInPath = symbolService.getSymbols(modulePath).filter(s => s.type === SymbolType.Function) as Array<ISymbol<SymbolType.Function>>
            for (const s of symbolsInPath) {
                const top_level = s.metadata.top_level
                if (top_level) {
                    const argumentCompletions = s.metadata.argnames.map((arg, i) => {
                        return `\$\{${i + 1}:${arg}\}`
                    })
                    const additionalTextEdits = [ ]
                    console.log(uses)
                    if (!uses.includes(module.moduleName))
                        if (currentPisitionModuleName)
                            // 如果存在 moduleName，则在第二行添加 `use ${moduleName}`
                            additionalTextEdits.push({
                                range: {
                                    start: { line: 1, character: 0 }, // 第二行（行索引从0开始）
                                    end: { line: 1, character: 0 }
                                },
                                newText: `use ${module.moduleName}\n`
                            })
                        else
                            // 如果不存在 moduleName，则在第一行插入 `use ${moduleName}`
                            additionalTextEdits.push({
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 0 }
                                },
                                newText: `use ${module.moduleName}\n`
                            })
                    items.push(
                        {
                            label: s.name,
                            kind: CompletionItemKind.Function,
                            documentation: {
                                kind: MarkupKind.Markdown,
                                value: `Function from module \`${module.moduleName}\`
${s.metadata?.comments ?? ''}`
                            },
                            insertText:
                                `${module.moduleName}::${s.name}(${argumentCompletions.join(', ')})`,
                            insertTextFormat: InsertTextFormat.Snippet,
                            additionalTextEdits
                        }
                    )
                }
                
            }
        }
        return items
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
            ...this.getModuleUseSnippets(position),
            ...this.getModuleTopLevelFunctions(position),
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

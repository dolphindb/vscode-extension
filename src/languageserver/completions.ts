import {
    type CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
    Position,
    type TextDocumentPositionParams,
    MarkupKind,
} from 'vscode-languageserver/node'

import type { TextDocument } from 'vscode-languageserver-textdocument'

import { connection } from './connection.ts'
import { documents } from './documents.ts'
import { ddbModules } from './modules.ts'

import { symbolService } from './symbols.ts'
import { type IFunctionMetadata, type IParamMetadata, type ISymbol, type IVariableMetadata, SymbolType } from './types.ts'
import { buildFunctionCommentDocs, createRegexForFunctionNames, extractFirstloadTableArgument, getLineContentsBeforePosition, isParenthesisBalanced } from './utils.ts'
import { dbService } from './database.ts'
import { getSqlCompletions } from './sql-completions.ts'

export type DdbCompletionItem = CompletionItem & {
    order?: number
}

// This handler provides the initial list of the completion items.
connection.onCompletion(
    async (_textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
        // The pass parameter contains the position of the text document in
        // which code complete got requested. For the example we ignore this
        // info and always provide the same completion items.
        const lineContent = getLineContent(
            documents.get(_textDocumentPosition.textDocument.uri)!,
            _textDocumentPosition.position.line
        )
        
        // 忽略注释的行，目前只能做到识别单行注释
        if (lineContent.trim().startsWith('//'))
            return [ ]
            
        const items: CompletionItem[] = [ ]
        // 模块提示暂时不可用
        // const mc = getModuleCompletions(_textDocumentPosition)
        // if (mc.length > 0)  // 如果是模块提示，那么只给模块提示，因为不太可能用其他的提示
        //     return mc
        const result = await completionsService.complete(_textDocumentPosition)
        items.push(...result)
        
        return items
    }
)

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
    // 一般来说用来根据item获取额外信息
    // 其实就是一个管道，进来的是原来的 item，出去的是补充了额外信息的 item
    // 留着参考
    (item: CompletionItem): CompletionItem => {
        if (item.data === 1) {
            item.detail = 'TypeScript details'
            item.documentation = 'TypeScript documentation'
        }
        return item
    }
)

// function getModuleCompletions (pos: TextDocumentPositionParams): CompletionItem[] {
//     const doc = documents.get(pos.textDocument.uri)
//     if (doc) {
//         const lineContent = getLineContent(doc, pos.position.line)
//         if (lineContent.trim().startsWith('use')) {
//             const modules = ddbModules.getModules()
//             return modules.map(m => {
//                 return {
//                     label: m.moduleName,
//                     kind: CompletionItemKind.Module,
//                     documentation: `Dolphin DB Module\n${m.moduleName}\n${m.path}`,
//                     insertText: m.moduleName,
//                 }
//             })
//         }
//     }

//     return [ ]
// }

function getLineContent (document: TextDocument, line: number): string {
    const lineStart = Position.create(line, 0)
    const lineEnd = Position.create(line + 1, 0)
    
    const range = {
        start: lineStart,
        end: lineEnd,
    }
    
    const text = document.getText(range)
    
    // 如果行不存在，返回 ''
    if (!text)
        return ''
        
        
    // 去掉行尾的换行符
    return text.trimEnd()
}

export class CompletionsService {
    
    symbolService = symbolService
    dbService = dbService
    getSelectCompletions: typeof getSqlCompletions = getSqlCompletions.bind(this)
    
    getFunctionSnippets (position: TextDocumentPositionParams): DdbCompletionItem[] {
        const symbols = symbolService.getSymbols(position.textDocument.uri)
        const functionSymbols: ISymbol<SymbolType.Function>[] = symbols.filter(s => s.type === SymbolType.Function) as ISymbol<SymbolType.Function>[]
        const functionCompletions: CompletionItem[] = functionSymbols.map(s => {
            const metadata = s.metadata as IFunctionMetadata
            const argumentCompletions = metadata.argnames.map((arg, i) => `\$\{${i + 1}:${arg}\}`)
            return {
                label: s.name,
                kind: CompletionItemKind.Function,
                documentation: s.metadata?.comments ? buildFunctionCommentDocs(s.metadata.comments) : '',
                insertText:
                    `${s.name}(${argumentCompletions.join(', ')})`,
                insertTextFormat: InsertTextFormat.Snippet
            }
        })
        return [...functionCompletions]
    }
    
    getVariableSnippets (position: TextDocumentPositionParams): DdbCompletionItem[] {
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
    
    getModuleUseSnippets (position: TextDocumentPositionParams): DdbCompletionItem[] {
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
    
    getModuleTopLevelFunctions (position: TextDocumentPositionParams): DdbCompletionItem[] {
        const documentUri = position.textDocument.uri
        const uses: string[] = symbolService.symbols.get(documentUri)?.use ?? [ ]
        const currentPisitionModuleName = symbolService.symbols.get(documentUri)?.module
        const items: CompletionItem[] = [ ]
        const allModules = ddbModules.getModules()
            .filter(module => module.moduleName)
            // 不要导入当前文件的模块
            .filter(module => module.moduleName !== currentPisitionModuleName)
        for (const module of allModules) {
            const modulePath = module.filePath
            const symbolsInPath = symbolService.getSymbols(modulePath).filter(s => s.type === SymbolType.Function) as Array<ISymbol<SymbolType.Function>>
            for (const s of symbolsInPath) {
                const top_level = s.metadata.top_level
                if (top_level) {
                    const argumentCompletions = s.metadata.argnames.map((arg, i) => `\$\{${i + 1}:${arg}\}`)
                    const additionalTextEdits = [ ]
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
                                value: `Function from module \`${module.moduleName}\`\n
${s.metadata?.comments ? buildFunctionCommentDocs(s.metadata.comments).value : ''}`
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
    
    buildDatabaseCompletionItem (url: string, skipQuota: boolean, commonOrder: boolean) {
        return {
            label: skipQuota ? `${url}` : `"${url}"`,
            kind: CompletionItemKind.Value,
            insertText: skipQuota ? `${url}` : `"${url}"`,
            insertTextFormat: InsertTextFormat.Snippet,
            order: commonOrder ? undefined : 1
        }
    }
    
    buildColNameCompletionItem (colName: string, skipQuota: boolean, commonOrder: boolean) {
        return {
            label: skipQuota ? `${colName}` : `"${colName}"`,
            kind: CompletionItemKind.Value,
            insertText: skipQuota ? `${colName}` : `"${colName}"`,
            insertTextFormat: InsertTextFormat.Snippet,
            order: commonOrder ? undefined : 2
        }
    }
    
    buildCatalogCompletionItem (url: string, skipQuota: boolean, commonOrder: boolean) {
        return {
            label: skipQuota ? `${url}` : `"${url}"`,
            kind: CompletionItemKind.Value,
            insertText: skipQuota ? `${url}` : `"${url}"`,
            insertTextFormat: InsertTextFormat.Snippet,
            order: commonOrder ? undefined : 1
        }
    }
    
    buildTableCompletionItem (tableName: string, skipQuota: boolean, commonOrder: boolean) {
        return {
            label: skipQuota ? `${tableName}` : `"${tableName}"`,
            kind: CompletionItemKind.Value,
            insertText: skipQuota ? `${tableName}` : `"${tableName}"`,
            insertTextFormat: InsertTextFormat.Snippet,
            order: commonOrder ? undefined : 2
        }
    }
    
    buildSharedTableCompletionItem (tableName: string, skipQuota: boolean, commonOrder: boolean) {
        return {
            label: skipQuota ? `${tableName}` : `"${tableName}"`,
            kind: CompletionItemKind.Value,
            insertText: skipQuota ? `${tableName}` : `"${tableName}"`,
            insertTextFormat: InsertTextFormat.Snippet,
            order: commonOrder ? undefined : 1
        }
    }
    
    getDatabsaseSnippets (position: TextDocumentPositionParams): DdbCompletionItem[] {
        const lineBefore = getLineContentsBeforePosition(documents.get(position.textDocument.uri).getText(), position.position)
        const dburls = dbService.dfsDatabases
        const items: CompletionItem[] = [ ]
        const isBalanced = isParenthesisBalanced(lineBefore)
        const funcs = ['loadTable', 'database', 'dropDatabase']
        if (createRegexForFunctionNames(funcs).exec(lineBefore)) {
            const skipQuota = /["'\`]/.test(lineBefore[lineBefore.length - 1])
            items.push(...dburls.map(url => this.buildDatabaseCompletionItem(url, skipQuota, isBalanced)))
        }
        return items
    }
    
    getCatalogSnippets (position: TextDocumentPositionParams): DdbCompletionItem[] {
        const items: CompletionItem[] = [ ]
        const catalogs = dbService.catalogs
        const lineBefore = getLineContentsBeforePosition(documents.get(position.textDocument.uri).getText(), position.position)
        const isBalanced = isParenthesisBalanced(lineBefore)
        const funcs = ['dropCatalog']
        if (createRegexForFunctionNames(funcs).exec(lineBefore)) {
            const skipQuota = /["'\`]/.test(lineBefore[lineBefore.length - 1])
            items.push(...catalogs.map(url => this.buildCatalogCompletionItem(url, skipQuota, isBalanced)))
        }
        return items
    }
    
    getTableSnippets (position: TextDocumentPositionParams): DdbCompletionItem[] {
        const items: CompletionItem[] = [ ]
        const lineBefore = getLineContentsBeforePosition(documents.get(position.textDocument.uri).getText(), position.position)
        const dburl = extractFirstloadTableArgument(lineBefore)
        const isBalanced = isParenthesisBalanced(lineBefore)
        if (dburl)
            if (dburl.startsWith("'") || dburl.startsWith('"')) {
                let db = dburl.replaceAll("'", '').replaceAll('"', '')
                const tables = dbService.dbTables.get(db)
                const skipQuota = /["'\`]/.test(lineBefore[lineBefore.length - 1])
                if (tables)
                    items.push(...tables.map(tableName => (this.buildTableCompletionItem(tableName, skipQuota, isBalanced))))
            }
        return items
    }
    
    filterHighestOrderCompletions (items: DdbCompletionItem[]): DdbCompletionItem[] {
        if (!items.some(item => item.order !== undefined))
            return items
            
            
        const highestOrder = items.reduce(
            (max, item) => (item.order !== undefined && item.order > max ? item.order : max),
            -Infinity
        )
        
        return items.filter(item => item.order === highestOrder)
    }
    
    getCommonSnippets (position: TextDocumentPositionParams): DdbCompletionItem[] {
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
            }
        ]
    }
    
    async complete (position: TextDocumentPositionParams): Promise<CompletionItem[]> {
        const selectCompletions = await this.getSelectCompletions(position)
        const items: DdbCompletionItem[] = [
            ...selectCompletions,
            ...this.getTableSnippets(position),
            ...this.getDatabsaseSnippets(position),
            ...this.getCatalogSnippets(position),
            ...this.getCommonSnippets(position),
            ...this.getFunctionSnippets(position),
            ...this.getVariableSnippets(position),
            ...this.getModuleUseSnippets(position),
            ...this.getModuleTopLevelFunctions(position),
        ]
        return this.filterHighestOrderCompletions(items)
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

export const completionsService = new CompletionsService

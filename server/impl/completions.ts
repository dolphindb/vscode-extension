import {
    type CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
    Position,
    type TextDocumentPositionParams
} from 'vscode-languageserver/node'

import {
    type TextDocument
} from 'vscode-languageserver-textdocument'

import { connection } from './connection'
import { documents } from './documents'
import { ddbModules } from './modules'
import { snippetService } from './snippets'

// This handler provides the initial list of the completion items.
connection.onCompletion(
    (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
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
        
        items.push(...snippetService.complete(_textDocumentPosition))
        
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

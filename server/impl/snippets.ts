import { InsertTextFormat, CompletionItemKind, type TextDocumentPositionParams, type CompletionItem } from 'vscode-languageserver/node'

class SnippetService {

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
            }
        ]
    }
    
    
}

export const snippetService = new SnippetService

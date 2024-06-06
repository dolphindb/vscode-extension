import { InsertTextFormat, CompletionItemKind } from "vscode-languageserver/node";

export const snippets = [
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
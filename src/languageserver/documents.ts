import { TextDocuments } from 'vscode-languageserver/node'

import { TextDocument } from 'vscode-languageserver-textdocument'

import { connection } from './connection.ts'
import { symbolService } from './symbols.ts'
import { dbService } from './database.ts'

// Create a simple text document manager.
export const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

documents.onDidOpen(e => {
    // handle document open
    symbolService.buildSymbolByDocument(e.document)
    dbService.update()
})

// Only keep settings for open documents
documents.onDidClose(e => {
    // handle document close
    symbolService.onCloseDocument(e.document)
})

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    // validateTextDocument(change.document);
    symbolService.buildSymbolByDocument(change.document)
    // dbService.update()
})

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

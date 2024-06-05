import {
    TextDocuments
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';
import { connection, documentSettings } from './connection';

// Create a simple text document manager.
export const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

documents.onDidOpen(e => {
    // handle document open
})

// Only keep settings for open documents
documents.onDidClose(e => {
    documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    // validateTextDocument(change.document);
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);
import {
    Diagnostic,
    DiagnosticSeverity,
    DocumentDiagnosticReportKind,
    type DocumentDiagnosticReport
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';
import { connection, getDocumentSettings } from './connection';
import { documents } from './documents';

connection.languages.diagnostics.on(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (document !== undefined) {
        return {
            kind: DocumentDiagnosticReportKind.Full,
            items: await validateTextDocument(document)
        } satisfies DocumentDiagnosticReport;
    } else {
        // We don't know the document. We can either try to read it from disk
        // or we don't report problems for it.
        return {
            kind: DocumentDiagnosticReportKind.Full,
            items: []
        } satisfies DocumentDiagnosticReport;
    }
});

async function validateTextDocument(textDocument: TextDocument): Promise<Diagnostic[]> {
    // In this simple example we get the settings for every validate run.
    const settings = await getDocumentSettings(textDocument.uri);

    // The validator creates diagnostics for all uppercase words length 2 and more
    const text = textDocument.getText();
    const pattern = /\b[A-Z]{2,}\b/g;
    let m: RegExpExecArray | null;

    let problems = 0;
    const diagnostics: Diagnostic[] = [];
    while ((m = pattern.exec(text)) && problems < 200) {
        problems++;
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Warning,
            range: {
                start: textDocument.positionAt(m.index),
                end: textDocument.positionAt(m.index + m[0].length)
            },
            message: `${m[0]} is all uppercase.`,
            source: 'ex'
        };

        diagnostic.relatedInformation = [
            {
                location: {
                    uri: textDocument.uri,
                    range: Object.assign({}, diagnostic.range)
                },
                message: 'Spelling matters'
            },
            {
                location: {
                    uri: textDocument.uri,
                    range: Object.assign({}, diagnostic.range)
                },
                message: 'Particularly for names'
            }
        ];

        diagnostics.push(diagnostic);
    }
    return diagnostics;
}
import {
    type Diagnostic,
    DiagnosticSeverity,
    DocumentDiagnosticReportKind,
    Position,
    type DocumentDiagnosticReport
} from 'vscode-languageserver/node'

import {
    type TextDocument
} from 'vscode-languageserver-textdocument'

import { connection } from './connection'
import { documents } from './documents'
import { ddbModules } from './modules'
import { extractModuleName } from './utils/texts'

connection.languages.diagnostics.on(async params => {
    const document = documents.get(params.textDocument.uri)
    if (document !== undefined) 
        return {
            kind: DocumentDiagnosticReportKind.Full,
            items: await validateTextDocument(document)
        } satisfies DocumentDiagnosticReport
     else 
        // We don't know the document. We can either try to read it from disk
        // or we don't report problems for it.
        return {
            kind: DocumentDiagnosticReportKind.Full,
            items: [ ]
        } satisfies DocumentDiagnosticReport
    
})

async function validateTextDocument (textDocument: TextDocument): Promise<Diagnostic[]> {
    const text = textDocument.getText()
    const lines = text.split('\n')
    
    const diagnostics: Diagnostic[] = [ ]
    
    lines.forEach((line, index) => {
        diagnostics.push(...validateUseModule(line, index))
    })
    
    
    return diagnostics
}

function validateUseModule (line: string, lnindex: number): Diagnostic[] {
    // 索引必须已经建立
    if (!ddbModules.getIsInitModuleIndex())
        return [ ]
    const ln = line.trim()
    if (ln.startsWith('use')) {
        const moduleName = extractModuleName(ln)
        const modules = ddbModules.getModules()
        console.log(`find ${moduleName} in ${JSON.stringify(modules.map(e => e.moduleName))}`)
        const module = modules.find(e => e.moduleName === moduleName)
        if (moduleName && !module) 
            return [{
                severity: DiagnosticSeverity.Error,
                range: {
                    start: Position.create(lnindex, 0),
                    end: Position.create(lnindex, line.length)
                },
                message: `Cannot find module ${moduleName}`,
                source: 'dolphindb'
            }]
        
    }
    return [ ]
}

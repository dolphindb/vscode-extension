import {
    createConnection,
    ProposedFeatures, type InitializeParams,
    DidChangeConfigurationNotification,
    TextDocumentSyncKind,
    type InitializeResult,
    WorkspaceFoldersRequest
} from 'vscode-languageserver/node'

import { ddbModules } from './modules'


// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
export const connection = createConnection(ProposedFeatures.all)

let hasConfigurationCapability = false
let hasWorkspaceFolderCapability = false

// The language server settings
interface LanguageServerSettings {
    moduleRoot: string
}

// The global settings
const defaultSettings: LanguageServerSettings = {
    moduleRoot: ''
}
let globalSettings: LanguageServerSettings = defaultSettings

export function getGlobalSettings () {
    return globalSettings
}

connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities
    
    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    // 但是如果没有 workspace configuration，globalSettings 也没法用啊
    // 一般来说都会有的，否则我们怎么从 workspage 里面加载设置呢
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    )
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    )
    
    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            definitionProvider: true,
            hoverProvider: true,
            // Tell the client that this server supports code completion.
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ['.', ' ', '(', ')']
            },
            diagnosticProvider: {
                interFileDependencies: false,
                workspaceDiagnostics: false
            }
        }
    }
    if (hasWorkspaceFolderCapability)
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        }
        
    return result
})
connection.onInitialized(() => {
    connection.sendRequest(WorkspaceFoldersRequest.type).then(folders => {
        if (folders)
            for (const folder of folders) {
                const path = decodeURIComponent(folder.uri).replace('file:///', '')
                ddbModules.setModuleRoot(path)
            }
            
    })
    if (hasWorkspaceFolderCapability)
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.')
        })
})

// connection.onDidChangeConfiguration(change => { // 这个参数也用不着，我们直接用 workspace getConfiguration 全量重设

//     if (hasConfigurationCapability) 
//         connection.workspace.getConfiguration('dolphindb').then((settings: LanguageServerSettings) => {
//             globalSettings = settings
//             ddbModules.setModuleRoot(settings.moduleRoot)
//         })

//     // Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
//     // We could optimize things here and re-fetch the setting first can compare it
//     // to the existing setting, but this is out of scope for this example.
//     connection.languages.diagnostics.refresh()
// })

connection.onDidChangeWatchedFiles(_change => {
    // Monitored files have change in VSCode
    connection.console.log('We received a file change event')
})

// Listen on the connection
connection.listen()

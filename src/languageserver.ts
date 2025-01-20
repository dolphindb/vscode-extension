import * as path from 'path'

import { type ExtensionContext, workspace } from 'vscode'

import {
    LanguageClient,
    type LanguageClientOptions,
    type ServerOptions,
    TransportKind
} from 'vscode-languageclient/node.js'

import { connector, type DdbConnection } from './connector.ts'


export const ls_client: { current: LanguageClient | undefined } = { current: undefined }

export async function activate_ls (ctx: ExtensionContext) {
    /** 初始化 Language Server */
    // The server is implemented in node
    let serverModule = ctx.asAbsolutePath(path.join( 'languageserver.cjs'))
    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] }
    
    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    let serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    }
    
    // Options to control the language client
    let clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
        documentSelector: [{ scheme: 'file', language: 'dolphindb' }],
        synchronize: {
            // Notify the server about file changes to '.clientrc files contained in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
        },
        initializationOptions: {
            configuration: workspace.getConfiguration('dolphindb')
        }
    }
    
    // Create the language client and start the client.
    const client = new LanguageClient(
        'ddbls',
        'Dolphin DB Language Server',
        serverOptions,
        clientOptions
    )
    
    ls_client.current = client
    // Start the client. This will also launch the server
    await client.start()
    client.onRequest('lsp/getFiles', async () => {
        const files = await workspace.findFiles('**/*.dos', null)
        return files
    })
    const watcher = workspace.createFileSystemWatcher('**/*.dos')
    watcher.onDidCreate(uri => {
        client.sendRequest('lsp/handleFileCreate', uri)
    })
    watcher.onDidChange(uri => {
        client.sendRequest('lsp/handleFileCreate', uri)
    })
    watcher.onDidDelete(uri => {
        client.sendRequest('lsp/handleFileDelete', uri)
    })
    
    /** 处理数据库查询 */
    client.onRequest('ddb/getAllCatalogs', async () => {
        const result = await getConnection()?.ddb?.invoke?.('getAllCatalogs')
        return result ?? [ ]
    })
    client.onRequest('ddb/getClusterDFSDatabases', async () => {
        const result = await getConnection()?.ddb?.invoke?.('getClusterDFSDatabases')
        return result ?? [ ]
    })
    client.onRequest('ddb/getSharedTables', async () => {
        try {
            const result = await getConnection()?.ddb?.invoke?.('objs', [true])
            return result.data.filter(e => e.form === 'TABLE').map(e => e.name)
        } catch (error) {
            return [ ]
        }
        
    })
    client.onRequest('ddb/listTables', async (dburl: string) => {
        try {
            const result = await getConnection()?.ddb?.invoke?.('listTables', [dburl])
            return result.data.map(e => e.tableName)
        } catch (error) {
            return [ ]
        }
        
    })
    client.onRequest('ddb/schema', async (dbHandle: string) => {
        try {
            const result = await getConnection()?.ddb?.execute(`schema(${dbHandle})`)
            return result
        } catch (error) {
            return { }
        }
    })
    client.onRequest('ddb/getSchemaByCatalog', async (catalog: string) => {
        try {
            const result = await getConnection()?.ddb?.invoke('getSchemaByCatalog', [catalog])
            const schemas = result.data.map(e => e.schema)
            return schemas
        } catch (error) {
            return [ ]
        }
    })
    client.onRequest('ddb/getSchemaTables', async (catalogAndSchema: [string, string]) => { 
        try {
            const [catalog, schema] = catalogAndSchema
            const result = await getConnection()?.ddb?.invoke('getSchemaByCatalog', [catalog])
            const targetSchema = result.data.find(e => e.schema === schema)
            const dbUrl = targetSchema?.dbUrl
            const tbResult = await getConnection()?.ddb?.invoke?.('listTables', [dbUrl])
            return tbResult.data.map(e => e.tableName)
        }  catch (error) {
            return [ ]
        }
    })
    
}

function getConnection (): DdbConnection | undefined {
    const connection = connector.connection
    if (connection && connection.connected && !connection.disconnected && connection.logined)
        return connection
}

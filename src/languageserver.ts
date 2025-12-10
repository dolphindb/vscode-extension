import * as path from 'path'

import { type ExtensionContext, workspace } from 'vscode'

import { LanguageClient, TransportKind } from 'vscode-languageclient/node.js'

import { connector, type DdbConnection } from './connector.ts'


export let ls_client: LanguageClient | undefined


/** 初始化 Language Server */
export async function activate_ls (ctx: ExtensionContext) {
    // The server is implemented in node
    const server_module = ctx.asAbsolutePath(path.join( 'languageserver.cjs'))
    
    // Create the language client and start the client.
    const client = new LanguageClient(
        'ddbls',
        'Dolphin DB Language Server',
        
        // server options
        {
            // If the extension is launched in debug mode then the debug server options are used
            // Otherwise the run options are used
            run: { module: server_module, transport: TransportKind.ipc },
            debug: {
                module: server_module,
                transport: TransportKind.ipc,
                
                // The debug options for the server
                // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
                options: { execArgv: ['--nolazy', '--inspect=6009'] }
            }
        },
        
        // Options to control the language client
        {
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
    )
    
    ls_client = client
    
    // Start the client. This will also launch the server
    await client.start()
    
    client.onRequest('lsp/getFiles', async () => 
        workspace.findFiles('**/*.dos', null)
    )
    
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
    
    // 处理数据库查询
    client.onRequest('ddb/getAllCatalogs', async () => {
        try {
            const connection = get_connection()
            if (!connection) 
                return [ ]
            
            const result = await connection.ddb.invoke<string[]>('getAllCatalogs')
            return result ?? [ ]
        } catch {
            return [ ]
        }
    })
    
    client.onRequest('ddb/getClusterDFSDatabases', async () => {
        try {
            const connection = get_connection()
            if (!connection) 
                return [ ]
            
            const result = await connection.ddb.invoke<string[]>('getClusterDFSDatabases')
            return result ?? [ ]
        } catch {
            return [ ]
        }
    })
    
    client.onRequest('ddb/getSharedTables', async () => {
        try {
            const connection = get_connection()
            if (!connection) 
                return [ ]
            
            return (await connection.ddb.invoke<any[]>('objs', [true]))
                .filter(e => e.form === 'TABLE').select('name') ?? [ ]
        } catch {
            return [ ]
        }
    })
    
    client.onRequest('ddb/listTables', async (dburl: string) => {
        try {
            const connection = get_connection()
            if (!connection) 
                return [ ]
            
            return (await connection.ddb.invoke<any[]>('listTables', [dburl]))
                .map((e: any) => e.tableName) ?? [ ]
        } catch {
            return [ ]
        }
    })
    
    client.onRequest('ddb/schema', async (dbHandle: string) => {
        try {
            const connection = get_connection()
            if (!connection) 
                return { }
            
            const result = await connection.ddb.execute(`schema(${dbHandle})`)
            return result ?? { }
        } catch {
            return { }
        }
    })
    
    client.onRequest('ddb/getSchemaByCatalog', async (catalog: string) => {
        try {
            const connection = get_connection()
            if (!connection) 
                return [ ]
            
            return (await connection.ddb.invoke('getSchemaByCatalog', [catalog]))
                .map(e => e.schema)
        } catch {
            return [ ]
        }
    })
    
    client.onRequest('ddb/getSchemaTables', async (catalogAndSchema: [string, string]) => {
        try {
            const connection = get_connection()
            if (!connection) 
                return [ ]
            
            const [catalog, schema] = catalogAndSchema
            const targetSchema = (await connection.ddb.invoke('getSchemaByCatalog', [catalog]))
                .find((e: any) => e.schema === schema)
            const dbUrl = targetSchema?.dbUrl
            if (!dbUrl) 
                return [ ]
            
            return (await connection.ddb.invoke('listTables', [dbUrl]))
                .select('tableName')
        } catch {
            return [ ]
        }
    })
}

function get_connection (): DdbConnection | undefined {
    const connection = connector.connection
    if (connection && connection.connected && !connection.disconnected && connection.logined)
        return connection
}

import { connection } from './connection.ts'

class DatabaseService {
    dfsDatabases: string[] = [ ]
    catalogs: string[] = [ ]
    dbTables: Map<string, string[]> = new Map()
    sharedTables: string[] = [ ]
    // 初始化的时候 -2000 ms 避免第一次 update 的时候不生效
    lastUpdateTime = new Date().getTime() - 2000
    
    update () {
        // 2000 ms 内只能触发一次
        const now = new Date().getTime()
        if (now - this.lastUpdateTime < 2000)
            return
        this.lastUpdateTime = now
        this.update_impl()
    }
    
    async update_impl () {
        try {
            this.catalogs = await connection.sendRequest('ddb/getAllCatalogs')
            this.dfsDatabases = await connection.sendRequest('ddb/getClusterDFSDatabases')
            this.sharedTables = await connection.sendRequest('ddb/getSharedTables')
            
            // Use Promise.all to ensure all requests complete before proceeding
            await Promise.all(this.dfsDatabases.map(async (db: string) => {
                const tables: string[] = await connection.sendRequest('ddb/listTables', db)
                this.dbTables.set(db, tables)
            }))
            
        } catch (error) {
            console.log(`Failed to update: ${error}`)
        }
    }
    
    async getColnames (dbHandle: string): Promise<string[]> {
        try {
            let db = dbHandle
            if (/['"\`]/.exec(dbHandle) && !(/(loadTable)/.exec(dbHandle))) {
                const strArr = dbHandle.replaceAll("'", '').replaceAll('"', '').replaceAll('`', '').split('.')
                const dbName = strArr?.[0] ?? ''
                const tbName = strArr?.[1] ?? ''
                db = `loadTable("${dbName}", "${tbName}")`
            }
            const result: { colDefs: { data: { name: string }[] } } = await connection.sendRequest('ddb/schema', db)
            const colnames = result.colDefs.data.map(({ name }) => name) as string[]
            return colnames
        } catch (error) {
            return [ ]
        }
    }
    
    async getSchemasByCatalog (catalog: string): Promise<string[]> {
        try {
            return await connection.sendRequest('ddb/getSchemaByCatalog', catalog)
        } catch (error) {
            return [ ]
        }
    }
    
    async getTablesByCatalogAndSchema (catalog: string, schema: string): Promise<string[]> {
        try {
            return await connection.sendRequest('ddb/getSchemaTables', [catalog, schema])
        } catch (error) {
            return [ ]
        }
    }
    
}

export const dbService = new DatabaseService()

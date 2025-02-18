import { throttle } from 'xshell/utils.js'

import { connection } from './connection.ts'

class DatabaseService {
    dfsDatabases: string[] = [ ]
    catalogs: string[] = [ ]
    dbTables: Map<string, string[]> = new Map()
    sharedTables: string[] = [ ]
    
    
    update = throttle(2000, async () => {
        try {
            this.catalogs = await connection.sendRequest('ddb/getAllCatalogs')
            this.dfsDatabases = await connection.sendRequest('ddb/getClusterDFSDatabases')
            this.sharedTables = await connection.sendRequest('ddb/getSharedTables')
            
        } catch (error) {
            console.log(`Failed to update: ${error}`)
        }
    })
    
    async update_table_of_db (db: string) {
        if (this.dbTables.has(db)) {
            // 如果有了，不阻塞，只更新
            connection.sendRequest('ddb/listTables', db).then((tables: string[]) => this.dbTables.set(db, tables)) 
            return
        }
        // 没用，阻塞并等待结果
        const tables: string[] = await connection.sendRequest('ddb/listTables', db)
        this.dbTables.set(db, tables)
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

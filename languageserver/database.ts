import throttle from 'lodash/throttle'

import { connection } from './connection'

class DatabaseService {
    dfsDatabases: string[] = [ ]
    catalogs: string[] = [ ]
    dbTables: Map<string, string[]> = new Map()
    streamTables: string[] = [ ]
    
    update = throttle(this.update_impl, 1000)
    
    async update_impl () {
        try {
            this.catalogs = await connection.sendRequest('ddb/getAllCatalogs')
            this.dfsDatabases = await connection.sendRequest('ddb/getClusterDFSDatabases')
            this.streamTables = await connection.sendRequest('ddb/getStreamTables')
            
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
            console.log(`getColnames: ${dbHandle}`)
            let db = dbHandle
            if (/['"\`]/.exec(dbHandle)) {
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

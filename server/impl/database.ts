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
}

export const dbService = new DatabaseService()

import { type TextDocumentPositionParams } from 'vscode-languageserver/node'

import { type DdbCompletionItem, type CompletionsService } from './completions'
import { getLineContentsBeforePosition } from './utils'
import { documents } from './documents'
import { dbService } from './database'


export async function getSqlCompletions (this: CompletionsService, position: TextDocumentPositionParams): Promise<DdbCompletionItem[]> {
    const items: DdbCompletionItem[] = [ ]
    const lineBefore = getLineContentsBeforePosition(documents.get(position.textDocument.uri).getText(), position.position)
    const extact = extractComplitionRequest(lineBefore)
    if (extact) {
        const { type, data, fromForm } = extact
        if (type === 'from') {
            const result = await getFormCompletions.call(this, fromForm, data)
            items.push(...result)
        }
        
        if (type === 'colnames' || type === 'order by') {
            const tbHandle = data
            const colnames = [ ]
            const colsFromSchema = await dbService.getColnames(tbHandle)
            colnames.push(...colsFromSchema)
            if (type === 'order by')
                colnames.push(...['asc', 'desc', 'nulls first', 'nulls last'])
            items.push(...colnames.map(colname => this.buildColNameCompletionItem(colname, true, false)))
        }
        
    } else {
        /** 处理 create, drop database */
        const sql = lineBefore
        const dropDbMatch = /drop database\s*(.+)/i.exec(sql)
        if (dropDbMatch) {
            const formMatch = dropDbMatch?.[1]?.trim() ?? ''
            if (formMatch) {
                const form = extractTableCompletionsForm(formMatch)
                if (['catalog', 'schema'].includes(form)) { 
                    const result = await getFormCompletions.call(this, form, formMatch)
                    items.push(...result)
                }
            } else {
                const result = await getFormCompletions.call(this, 'catalog', '')
                const dbResult = await dbService.dfsDatabases
                const isHaveQuota = /["'\`]/.test(sql)
                items.push(...dbResult.map(url => this.buildDatabaseCompletionItem(url, isHaveQuota, false)))
                items.push(...result)
            }
        }
        const createDbMatch = /create database/i.exec(sql)
        if (createDbMatch) 
            items.push(...dbService.catalogs.map(catalog => this.buildCatalogCompletionItem(catalog, true, false)))
        
    }
    return items
}

type FromDataType = 'catalog' | 'schema' | 'tablename'

interface ISelectComplitionRequest {
    type: 'from' | 'colnames' | 'order by'
    fromForm?: FromDataType
    data: string
}

/** 根据 from 子句中的点号数量返回相应的数据
    @param fromClause from 子句，例如 "myTable", "mySchema.myTable", "catalog.mySchema.myTable"
    @returns catalog, schema 或 tablename */
function extractTableCompletionsForm (fromClause: string): FromDataType {
    const parts = fromClause.split('.')
    switch (parts.length) {
        case 1:
            return 'catalog'
        case 2:
            return 'schema'
        case 3:
            return 'tablename'
        default:
            return 'catalog' // 默认返回 catalog
    }
}

function extractComplitionRequest (sql: string): ISelectComplitionRequest | null {
    // 匹配 select ... from 模式，支持 from 后跟函数调用或表名
    const selectFromMatch = /select\s+(.+?)\s+from\s+(.*)/i.exec(sql)
    
    if (selectFromMatch) {
        // 从 from 子句中提取数据
        let fromClause = selectFromMatch?.[2]?.trim() ?? ''
        
        const match = /^(.*?)\s+(where|group by|context by|pivot by|order by)/i.exec(fromClause)
        if (match)
            fromClause = match[1].trim()
            
        // 检查 order by
        if (/order\s+by/i.exec(sql))
            return { type: 'order by', data: fromClause }
            
        // 检查 where, group by, context by, pivot by
        else if (/where|group\s+by|context\s+by|pivot\s+by/i.exec(sql))
            return { type: 'colnames', data: fromClause }
            
        // 处理 from 子句
        else
            return { type: 'from', fromForm: extractTableCompletionsForm(fromClause), data: fromClause }
            
    }
    
    const updateMatch = /(alter\s+table|drop\s+table|insert\s+into|update|delete)\s*(.+?)(\s+where.*)?$/i.exec(sql)
    if (updateMatch) {
        let tableClause = updateMatch?.[2]?.trim() ?? ''
        let whereClause = updateMatch?.[3]?.trim() ?? ''
        if (whereClause)
            return { type: 'colnames', data: tableClause }
            
        return { type: 'from', fromForm: extractTableCompletionsForm(tableClause), data: tableClause }
    }
    
    const createTableMatch = /create table\s*(.+)/i.exec(sql)
    if (createTableMatch) {
        const formMatch = createTableMatch?.[1]?.trim() ?? ''
        if (formMatch) {
            const fromForm = extractTableCompletionsForm(formMatch)
            if (fromForm === 'tablename')
                return null
            return { type: 'from', fromForm, data: formMatch }
        }
    }
    
    return null
}

async function getFormCompletions (this: CompletionsService, form: FromDataType, data: string, withDbUrl = false): Promise<DdbCompletionItem[]> {
    let symbolToFind = data
    const items: DdbCompletionItem[] = [ ]
    if (form === 'catalog') {
        const catalogs = dbService.catalogs
        items.push(...catalogs.map(url => this.buildCatalogCompletionItem(url, true, false)))
        if (withDbUrl) {
            const isHaveQuota = /["'\`]/.test(data)
            items.push(...dbService.dfsDatabases.map(url => this.buildDatabaseCompletionItem(url, isHaveQuota, false)))
        }
    }
    const lastDotIndex = symbolToFind.lastIndexOf('.')
    const wordsBeforeLastDot = symbolToFind.substring(0, lastDotIndex)
    if (form === 'schema') {
        const schemas = await dbService.getSchemasByCatalog(wordsBeforeLastDot)
        items.push(...schemas.map(schema => this.buildCatalogCompletionItem(schema, true, false)))
    }
    if (form === 'tablename') {
        const catalog = wordsBeforeLastDot.split('.')?.[0] ?? ''
        const schema = wordsBeforeLastDot.split('.')?.[1] ?? ''
        const tables = await dbService.getTablesByCatalogAndSchema(catalog, schema)
        items.push(...tables.map(tableName => this.buildTableCompletionItem(tableName, true, false)))
    }
    return items
}

import { type TextDocumentPositionParams } from 'vscode-languageserver/node'

import { type DdbCompletionItem, type CompletionsService } from './completions'
import { getLineContentsBeforePosition } from './utils'
import { documents } from './documents'
import { dbService } from './database'


export async function getSelectCompletions (this: CompletionsService, position: TextDocumentPositionParams): Promise<DdbCompletionItem[]> {
    const items: DdbCompletionItem[] = [ ]
    const lineBefore = getLineContentsBeforePosition(documents.get(position.textDocument.uri).getText(), position.position)
    const extact = extractFromOrColnames(lineBefore)
    if (extact) {
        const { type, data } = extact
        console.log(extact)
        if (type === 'from')
            switch (data) {
                case 'catalog':
                    items.push(...getFormCompletions.call(this, 'catalog', data))
                    break
                    
                case 'schema':
                    break
                    
                case 'tablename':
                    break
            }
            
            
        if (type === 'colnames' || type === 'order by') {
            const tbHandle = data
            const colnames = [ ]
            if (type === 'order by')
                colnames.push(...['asc', 'desc', 'nulls first', 'nulls last'])
                
        }
        
    }
    return items
}

type FromDataType = 'catalog' | 'schema' | 'tablename'

interface Result {
    type: 'from' | 'colnames' | 'order by'
    data: FromDataType | string
}

/** 根据 from 子句中的点号数量返回相应的数据
    @param fromClause from 子句，例如 "myTable", "mySchema.myTable", "catalog.mySchema.myTable"
    @returns catalog, schema 或 tablename */
function extractDataFromFromClause (fromClause: string): FromDataType {
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

function extractFromOrColnames (sql: string): Result | null {
    // 匹配 select ... from 模式
    const fromMatch = /select\s+(.+?)\s+from(?:\s+([\w.]+))?/i.exec(sql)
    
    if (fromMatch) {
        // const afterSelect = fromMatch[1]?.trim() ?? ''
        const fromClause = fromMatch[2]?.trim() ?? ''
        
        // 检查 order by
        if (/order\s+by/i.exec(sql))
            return { type: 'order by', data: fromClause }
            
        // 检查 where, group by, context by, pivot by
        else if (/where|group\s+by|context\s+by|pivot\s+by/i.exec(sql))
            return { type: 'colnames', data: fromClause }
            
        // 处理 from 子句
        else
            return { type: 'from', data: extractDataFromFromClause(fromClause) }
            
    }
    
    return null
}

function getFormCompletions (this: CompletionsService, form: FromDataType, data: string): DdbCompletionItem[] {
    const items: DdbCompletionItem[] = [ ]
    if (form === 'catalog') {
        const catalogs = dbService.catalogs
        items.push(...catalogs.map(url => this.buildCatalogCompletionItem(url, true, false)))
    }
    return items
}

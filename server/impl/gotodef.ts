import * as fsp from 'fs/promises'

import {
    type DefinitionParams,
    type Location,
    type Position,
    type Range
} from 'vscode-languageserver/node'

import { connection } from './connection'
import { documents } from './documents'
import { symbolService } from './symbols/symbols'
import { isPositionInScope } from './snippets'
import { type IFunctionMetadata, SymbolType } from './symbols/types'

connection.onDefinition(async (params: DefinitionParams) => {

    const document = documents.get(params.textDocument.uri)
    if (!document)
        return null
        
    const position = params.position
    const text = document.getText()
    // 获取光标所在的单词
    const word = getWordAtPosition(text, position)
    if (!word)
        return null
        
    const symbols = symbolService.getSymbols(document.uri)
    
    
    
    const symbolsInScope = symbols.filter(s => {
        if (!s.metadata || !('scope' in s.metadata))
            return false
        return isPositionInScope(position, s.metadata!.scope as [Position, Position])
    })
    // 按作用域起始位置降序排序，起始位置越靠近当前位置的作用域越靠前
    symbolsInScope.sort((a, b) => {
        const aStart = a.metadata!.scope[0]
        const bStart = b.metadata!.scope[0]
        if (aStart.line !== bStart.line)
            return bStart.line - aStart.line
            
        return bStart.character - aStart.character
    })
    
    const symbol = symbolsInScope.find(s => {
        if (s.name === word)
            return true
        if (s.type === SymbolType.Function) {
            const metadata = s.metadata as IFunctionMetadata
            return metadata.argnames.includes(word) || s.name === word
        }
    })
    
    if (!symbol)
        return null
        
    // 创建 Location 对象
    const location: Location = {
        uri: document.uri,
        range: {
            start: symbol.position,
            end: symbol.range ? symbol.range.end : symbol.position,
        },
    }
    
    
    if (location)
        return location
        
    return null
})

function getWordAtPosition (text: string, position: Position): string | null {
    const lines = text.split('\n')
    if (position.line >= lines.length)
        return null
        
        
    const line = lines[position.line]
    if (position.character >= line.length)
        return null
        
        
    const wordRegex = /[a-zA-Z_][a-zA-Z0-9_]*/g // 或者 /[a-zA-Z_]+/g  取决于你的变量名规则
    
    let match: RegExpExecArray | null
    while ((match = wordRegex.exec(line)) !== null) {
        const start = match.index
        const end = match.index + match[0].length
        
        //  关键修改在这里：
        if (position.character >= start && position.character <= end)
            return match[0]
            
    }
    
    return null
}

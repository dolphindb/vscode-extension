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
    
    const symbol = symbols.find(s => s.name === word)
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
        
    // 使用正则表达式匹配单词
    const wordRegex = /[a-zA-Z_]\w*/g
    let match: RegExpExecArray | null
    while ((match = wordRegex.exec(line)) !== null) {
        const start = match.index
        const end = match.index + match[0].length
        if (position.character >= start && position.character <= end)
            return match[0]
            
    }
    
    return null
}

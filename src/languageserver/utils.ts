import * as fsp from 'fs/promises'

import { MarkupKind, type MarkupContent, type Position } from 'vscode-languageserver/node'

export async function readFileByPath (path: string) {
    const isWindows = process.platform === 'win32'
    let truePath = path
    if (isWindows && path.startsWith('/'))
        truePath = path.substring(1)
    
    return fsp.readFile(truePath, { encoding: 'utf-8' })
}

export function getWordAtPosition (line: string, character: number): string | null {
    const regex = /\b\w+\b/g
    let match
    while ((match = regex.exec(line)) !== null)
        if (match.index <= character && regex.lastIndex >= character)
            return match[0]
            
            
    return null
}

export function getLineContentsBeforePosition (text: string, position: Position): string {
    if (position.line < 0 || position.character < 0)
        return ''
        
        
    const lines = text.split('\n')
    
    if (position.line >= lines.length)
        return ''
        
        
    const line = lines[position.line]
    
    if (position.character > line.length)
        return line
        
        
    return line.substring(0, position.character)
}

export function extractModuleName (line: string): string | null {
    const regex = /use\s+([\w:]+)\s*[:;]?/
    const match = regex.exec(line)
    return match ? match[1] : null
}

export function extractFirstloadTableArgument (input: string): string | null {
    const regex = /loadTable\(\s*((['"])([^'"]*)\2|([^,'"]+))\s*,/
    const match = regex.exec(input)
    
    if (match)
        return match[2] ? match[1] : match[4]
    else
        return null
        
}

export function isParenthesisBalanced (str: string): boolean {
    let count = 0
    for (let i = 0;  i < str.length;  i++) {
        if (str[i] === '(')
            count++
        else if (str[i] === ')')
            count--
            
        // 关键点: count 始终不能小于 0
        if (count < 0)
            return true // 出现 ')' 多于 '(' 的情况，直接视为闭合
            
    }
    return count === 0
}

export function createRegexForFunctionNames (functionNames) {
    if (!Array.isArray(functionNames) || functionNames.length === 0)
        return null // 或者抛出错误，根据你的需要
        
        
    // 转义函数名中的特殊字符
    const escapedFunctionNames = functionNames.map(escapeRegExp)
    
    // 使用 | 连接函数名，构建正则表达式模式
    const pattern = `(${escapedFunctionNames.join('|')})\\(`
    
    return new RegExp(pattern)
}
export function escapeRegExp (string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildFunctionCommentDocs (comment: string): MarkupContent {
    const lines = comment.split('\n')
    let functionName = ''
    let brief = ''
    const params: { name: string, description: string }[] = [ ]
    let returnDesc = ''
    let sampleUsage = ''
    let additionalInfo = ''
    
    for (const line of lines) 
        if (line.startsWith('@FunctionName:')) 
            functionName = line.substring('@FunctionName:'.length).trim()
         else if (line.startsWith('@Brief:'))
             brief = line.substring('@Brief:'.length).trim()
         else if (line.startsWith('@Param:')) {
            const paramLine = line.substring('@Param:'.length).trim()
            const paramParts = /^(\w+)(=\w+)?\s*:\s*(.*)$/.exec(paramLine)
            if (paramParts) {
                const paramName = paramParts[1]
                const paramDesc = paramParts[3]
                params.push({ name: paramName, description: paramDesc })
            }
        } else if (line.startsWith('@Return:')) 
            returnDesc = line.substring('@Return:'.length).trim()
         else if (line.startsWith('@SampleUsage:'))
             sampleUsage = line.substring('@SampleUsage:'.length).trim()
         else if (!line.trim().startsWith('@'))
             additionalInfo += line.trim() + '  \n' 
        
    
    
    const documentation: MarkupContent = {
        kind: MarkupKind.Markdown,
        value: [
            brief ? `**Brief:** ${brief}` : '',
            params.length > 0 ? '**Parameters:**' : '',
            ...params.map(p => `* \`${p.name}\`: ${p.description}`),
            returnDesc ? `**Return:** ${returnDesc}` : '',
            sampleUsage ? `**Sample Usage:**\n\n\`\`\`\n${sampleUsage}\n\`\`\`` : '',
            additionalInfo ? `\n\n${additionalInfo.trim()}` : '', // Add additional info with separator
        ].filter(s => s).join('\n\n'),
    }
    
    return documentation
}

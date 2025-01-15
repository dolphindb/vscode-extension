import * as fsp from 'fs/promises'

export async function readFileByPath (path: string) {
    const isWindows = process.platform === 'win32'
    let truePath = path
    if (isWindows && path.startsWith('/'))
        truePath = path.substring(1)
        
    const data = await fsp.readFile(truePath)
    const text = data.toString()
    return text
}

export function getWordAtPosition (line: string, character: number): string | null {
    const regex = /\b\w+\b/g
    let match
    while ((match = regex.exec(line)) !== null) 
        if (match.index <= character && regex.lastIndex >= character) 
            return match[0]
        
    
    return null
}

export function extractModuleName (line: string): string | null {
    const regex = /use\s+([\w:]+)\s*[:;]?/
    const match = regex.exec(line)
    return match ? match[1] : null
}

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

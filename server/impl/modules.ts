import * as fsp from 'fs/promises'

import { connection } from './connection'
import { getFileModule } from './symbols/impl'
import { symbolService } from './symbols/symbols'

export interface DdbModule {
    filePath: string
    moduleName: string
}

export interface DdbUri {
    external: string
    path: string
    scheme: 'file'
}

export async function readFileByPath (path: string) {
    const isWindows = process.platform === 'win32'
    let truePath = path
    if (isWindows && path.startsWith('/'))
        truePath = path.substring(1)
        
    const data = await fsp.readFile(truePath)
    const text = data.toString()
    return text
}
class DdbModules {

    private modules: DdbModule[] = [ ]
    private isModuleIndexInit = false
    
    constructor () { }
    
    // 设置初始化或者更新的时候调用
    public async init () {
        const files = await connection.sendRequest('ddb/getFiles')
        await this.handleInitFiles(files as DdbUri[])
        this.isModuleIndexInit = true
    }
    
    private async handleInitFiles (files: DdbUri[]) {
        for (const file of files) {
            console.log('handle init file', file)
            const text = await readFileByPath(file.path)
            const module = {
                uri: file.external,
                moduleName: getFileModule(text),
                filePath: file.path
            }
            this.putModule(module)
        }
        
    }
    
    public async handleFileUpdate (file: DdbUri) {
        console.log('handle update file', file)
        const text = await readFileByPath(file.path)
        const module = {
            uri: file.external,
            moduleName: getFileModule(text),
            filePath: file.path
        }
        this.putModule(module)
    }
    
    public async handleFileDelete (file: DdbUri) {
        console.log('handle delete file', file)
        this.removeModule(file.path)
    }
    
    private putModule (module: DdbModule) {
        // 先尝试 remove
        this.removeModule(module.filePath)
        this.modules.push(module)
        symbolService.buildSymbolByModule(module)
    }
    
    private removeModule (filePath: string) {
        const index = this.modules.findIndex(e => e.filePath === filePath)
        console.log(index)
        if (index >= 0) {
            this.modules.splice(index, 1)
            symbolService.deleteSymbolByUri(filePath)
        }
    }
    
    public getModules () {
        return this.modules
    }
    
    public getIsInitModuleIndex () {
        return this.isModuleIndexInit
    }
    
}

export const ddbModules = new DdbModules()

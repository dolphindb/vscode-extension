

import { connection } from './connection'
import { getFileModule } from './symbols_impl'
import { symbolService } from './symbols'
import { type DdbModule, type DdbUri } from './types'
import { readFileByPath } from './utils'




class DdbModules {

    private modules: DdbModule[] = [ ]
    private isModuleIndexInit = false
    
    constructor () { }
    
    // 设置初始化或者更新的时候调用
    public async init () {
        const files = await connection.sendRequest('lsp/getFiles')
        await this.handleInitFiles(files as DdbUri[])
        this.isModuleIndexInit = true
    }
    
    private async handleInitFiles (files: DdbUri[]) {
        for (const file of files) {
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
        const text = await readFileByPath(file.path)
        const module = {
            uri: file.external,
            moduleName: getFileModule(text),
            filePath: file.path
        }
        this.putModule(module)
    }
    
    public async handleFileDelete (file: DdbUri) {
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

connection.onInitialized(() => {
    ddbModules.init()
})
connection.onRequest('lsp/handleFileCreate', async (uri: DdbUri) => {
    await ddbModules.handleFileUpdate(uri)
})
connection.onRequest('lsp/handleFileDelete', async (uri: DdbUri) => {
    await ddbModules.handleFileDelete(uri)
})

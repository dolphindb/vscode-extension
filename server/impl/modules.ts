import * as fsp from 'fs/promises'
import * as fs from 'fs'
import * as path from 'path'

import { getFileModule } from './symbols/impl'
import { symbolService } from './symbols/symbols'

export interface DdbModule {
    path: string
    moduleName: string
    moduleParentPath: string
}

interface DdbModuleWatcher {
    path: string
    watcher: ReturnType<typeof fs.watch>
}

interface DdbDirWatcher {
    path: string
    watcher: ReturnType<typeof fs.watch>
}

class DdbModules {

    private moduleRoot: string = ''
    private modules: DdbModule[] = [ ]
    private moduleWatchers = new Map<string, DdbModuleWatcher>
    private dirWatchers = new Map<string, DdbDirWatcher>
    private isModuleIndexInit = false
    
    constructor () { }
    
    // 设置初始化或者更新的时候调用
    public setModuleRoot (root: string) {
        this.moduleRoot = root
        this.buildModuleIndex()
    }
    
    private handleModuleFileChange (module: DdbModule) {
        symbolService.buildSymbolByModule(module)
    }
    
    private addModule (module: DdbModule) {
        this.modules.push(module)
        const watcher = fs.watch(module.path)
        watcher.on('change', () => { this.handleModuleFileChange(module) })
        symbolService.buildSymbolByModule(module)
        this.moduleWatchers.set(module.path, { path: module.path, watcher })
    }
    
    private removeModule (module: DdbModule) {
        const index = this.modules.findIndex(e => e.path === module.path)
        console.log('to delete', module)
        if (index >= 0) 
            this.modules.splice(index, 1)
        const watcher = this.moduleWatchers.get(module.path)
        if (watcher)
            watcher.watcher.close()
        this.moduleWatchers.delete(module.path)
    }
    
    private updateModule (module: DdbModule) {
        const index = this.modules.findIndex(e => e.path === module.path)
        if (index >= 0) {
            this.modules[index] = module
            const watcher = this.moduleWatchers.get(module.path)
            if (watcher)
                watcher.watcher.close()
            const newWatcher = fs.watch(module.path)
            newWatcher.on('change', () => { this.handleModuleFileChange(module) })
            this.moduleWatchers.set(module.path, { path: module.path, watcher: newWatcher })
        }
        
    }
    
    private buildModuleIndex () {
        this.isModuleIndexInit = false
        // 停掉所有的监听
        this.dirWatchers.forEach(dw => {
            dw.watcher.close()
        })
        this.dirWatchers.clear()
        // 写个广搜
        const dirsToWatch = [this.moduleRoot]
        while (dirsToWatch.length > 0) {
            const dir = dirsToWatch.shift()
            if (dir) {
                // 监听这个目录
                this.startWatchDir(dir)
                // 读取当前目录中的子目录并加入待监听列表
                const dirs = fs.readdirSync(dir)
                // 注册模块
                this.registerDirModules(dir, dirs)
                const subDirs = dirs.filter(subDir => {
                    const subDirPath = path.join(dir, subDir)
                    const isDir = fs.statSync(subDirPath).isDirectory()
                    return isDir
                })
                for (const subDir of subDirs)
                    dirsToWatch.push(path.join(dir, subDir))
                    
            }
        }
        // 初始化索引完毕
        this.isModuleIndexInit = true
    }
    
    /** 监听指定目录
        @param path 要监听的目录
        @returns  */
    private startWatchDir (path: string) {
        if (!path)
            return
        const watcher = fs.watch(path)
        // 监听变化
        watcher.on('change', (event, filename) => {
            console.log(event, filename)
            const dirs = fs.readdirSync(path)
            // 重新注册模块
            this.registerDirModules(path, dirs)
        })
        this.dirWatchers.set(path, { path, watcher })
    }
    
    private async registerDirModules (parentDir: string, dirInfo: string[]) {
        dirInfo.forEach(async itemName => {
            const itemPath = path.join(parentDir, itemName)
            const stat = fs.statSync(itemPath)
            const isDir = stat.isDirectory()
            const isDos = itemPath.endsWith('.dos')
            if (!isDir && isDos)
                if (!this.modules.find(e => e.path === itemPath)) {
                    const existModuleIndex = this.modules.findIndex(e => e.path === itemPath)
                    const moduleInfo = {
                        moduleName: await this.getModuleName(itemPath),
                        path: itemPath,
                        moduleParentPath: parentDir
                    }
                    // 如果有，修改信息
                    if (existModuleIndex >= 0)
                        this.updateModule(moduleInfo)
                    else // 否则才添加
                        this.addModule(moduleInfo)
                }
                
        })
    }
    
    private async getModuleName (path: string): Promise<string> {
        const data = await fsp.readFile(path, 'utf-8')
        const text = data.toString()
        return getFileModule(text) ?? ''
    }
    
    public getModules () {
        return this.modules
    }
    
    public getIsInitModuleIndex () {
        return this.isModuleIndexInit
    }
    
}

export const ddbModules = new DdbModules()

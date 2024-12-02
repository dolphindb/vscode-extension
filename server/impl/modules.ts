import * as fsp from 'fs/promises'
import * as fs from 'fs'
import * as path from 'path'

interface DdbModule {
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
        watcher.on('change', () => {
            const dirs = fs.readdirSync(path)
            // 该目录下模块全部重新注册，把之前存在的都删除
            this.modules = this.modules.filter(e => e.moduleParentPath !== path)
            // 重新注册模块
            this.registerDirModules(path, dirs)
        })
        this.dirWatchers.set(path, { path, watcher })
    }
    
    private registerDirModules (dir: string, dirInfo: string[]) {
        dirInfo.forEach(subDir => {
            const subDirPath = path.join(dir, subDir)
            const stat = fs.statSync(subDirPath)
            const isDir = stat.isDirectory()
            const isDos = subDirPath.endsWith('.dos')
            if (!isDir && isDos) 
                if (!this.modules.find(e => e.path === subDirPath)) {
                    const existModuleIndex = this.modules.findIndex(e => e.path === subDirPath)
                    const moduleInfo = {
                        moduleName: this.getModuleName(subDirPath),
                        path: subDirPath,
                        moduleParentPath: dir
                    }
                    // 如果有，修改信息
                    if (existModuleIndex >= 0) 
                        this.modules[existModuleIndex] = moduleInfo
                     else // 否则才添加
                        this.modules.push(moduleInfo)
                }
            
        })
    }
    
    private getModuleName (path: string) {
        const pths = path
            .replace(this.moduleRoot, '') // 去掉根目录
            .split(/[\/\\]/) // 分割路径
            .filter(e => e !== '') // 去掉空路径
        return pths.join('::').replace('.dos', '') // 去掉后缀名
    }
    
    public getModules () {
        return this.modules
    }
    
    public getIsInitModuleIndex () {
        return this.isModuleIndexInit
    }
    
}

export const ddbModules = new DdbModules()

import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { connection } from './connection';

interface DdbModule {
    path: string;
    moduleName: string;
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

    private moduleRoot: string = '';
    private modules: DdbModule[] = [];
    private moduleWatchers: DdbModuleWatcher[] = [];
    private dirWatchers: DdbDirWatcher[] = [];
    private moduleFiles = new Set<string>();
    private isModuleIndexInit = false;

    constructor() { }

    // 设置初始化或者更新的时候调用
    public setModuleRoot(root: string) {
        this.moduleRoot = root;
        this.buildModuleIndex();
    }

    private buildModuleIndex() {
        this.isModuleIndexInit = false;
        // 停掉所有的监听
        for (const dw of this.dirWatchers) {
            dw.watcher.close()
        }
        this.dirWatchers = [];
        // 写个广搜
        const dirsToWatch = [this.moduleRoot];
        while (dirsToWatch.length > 0) {
            const dir = dirsToWatch.shift();
            if (dir) {
                const watcher = this.startWatchDir(dir);
                this.dirWatchers.push(watcher);
                // 读取当前目录中的子目录并加入待监听列表
                const subDirs = fs.readdirSync(dir).filter(subDir => {
                    const subDirPath = path.join(dir, subDir);
                    const isDir = fs.statSync(subDirPath).isDirectory();
                    if (!isDir) {
                        if (!this.modules.find(e => e.path === subDirPath)) {
                            this.modules.push({
                                moduleName: this.getModuleName(subDirPath),
                                path: subDirPath,
                            })
                        }
                    }
                    return isDir;
                });
                for (const subDir of subDirs) {
                    dirsToWatch.push(path.join(dir, subDir));
                }
            }
        }
        // 初始化索引完毕
        this.isModuleIndexInit = true;
        // 刷新一下诊断
        connection.languages.diagnostics.refresh();
    }

    private startWatchDir(path: string): DdbDirWatcher {
        const watcher = fs.watch(path);
        return {
            path, watcher
        }
    }

    private getModuleName(path: string) {
        const pths = path
            .replace(this.moduleRoot, '') // 去掉根目录
            .split(/[\/\\]/) // 分割路径
            .filter(e => e !== ''); // 去掉空路径
        return pths.join('::').replace('.dos', '') // 去掉后缀名
    }

    public getModules() {
        return this.modules
    }

    public getIsInitModuleIndex() {
        return this.isModuleIndexInit;
    }

}

export const ddbModules = new DdbModules();
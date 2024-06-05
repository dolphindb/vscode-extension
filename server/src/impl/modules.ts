import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';

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

    constructor() { }

    // 设置初始化或者更新的时候调用
    public setModuleRoot(root: string) {
        this.moduleRoot = root;
        this.startWatchModuleRootDir();
    }

    private startWatchModuleRootDir() {
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

}

export const ddbModules = new DdbModules();
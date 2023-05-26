import { Remote } from './network.js'
import { Source } from '@vscode/debugadapter'

type SourceData = {
    content?: string
    lines?: string[]
    // verified表示是否已经进行过本地与server的一致性验证
    // 设置这个变量的目的是避免用户多次setBps时，系统多次进行校验
    verified?: boolean
}

type BreakpointInfo = {
    id: number
    line: number
    verified: boolean
    source: Source
}

type BreakpointsCache = Array<{
    moduleName: string
    bps: BreakpointInfo[]
}>

/** 用于管理debug会话开启后的所有资源 */
export class Sources {
    // vscode debug adapter 使用ref来标识资源，要求是数字
    private _sources: Map<number, Source> = new Map()
    /** 资源内容缓存 */
    private _sourceCache: WeakMap<Source, SourceData> = new WeakMap()
    /** 断点缓存 */
    private _breakpoints: WeakMap<Source, BreakpointInfo[]> = new WeakMap()
    /** 名字到ref的映射 */
    private _sourceRefMap: Map<string, number> = new Map()
    
    private _remote: Remote
    
    private _refId = 0
    get nextRefId (): number {
        return this._refId++
    }
    
    constructor (remote: Remote) {
        this._remote = remote
    }
    
    /** 通过moduleName或者数字ref获取整个source对象 */
    public getSource (ref: number | string): Source {
        if (typeof ref === 'string') {
            const srcRef = this._sourceRefMap.get(ref)
            if (srcRef === undefined) 
                throw new Error(`source ${ref} not found`)
            
            ref = srcRef
        }
        const source = this._sources.get(ref)
        if (!source) 
            throw new Error(`source ${ref} not found`)
        
        return source
    }
    
    /** 包含内容以及划分成行的内容 */
    private getContents (source: Source): SourceData {
        const contents = this._sourceCache.get(source)
        if (!contents) 
            throw new Error(`source contents not found: ${source.name}`)
        
        return contents
    }
    
    /** 获取资源内容 */
    public async getContent (ref: number | string): Promise<string> {
        const contents = this.getContents(this.getSource(ref))
        if (contents.content) 
            return contents.content
         else {
            if (typeof ref === 'number') 
                ref = this.getSource(ref).name
            
            // TODO: stackTrace也会做这个网络请求，在sourceRequest的请求时做一个deferred
            contents.content = (await this._remote.call('sourceRequest', ref)) as string
            return contents.content
        }
    }
    
    public async getLines (ref: number | string): Promise<string[]> {
        const contents = this.getContents(this.getSource(ref))
        
        if (contents.lines) 
            return contents.lines
         else {
            const content = await this.getContent(ref)
            contents.lines = content.split('\n')
            return contents.lines
        }
    }
    
    public add (source: Omit<Source, 'sourceReference'>): number {
        const ref = this.nextRefId
        this._sourceRefMap.set(source.name, ref)
        this._sources.set(ref, {
            ...source,
            sourceReference: ref
        })
        this._sourceCache.set(this._sources.get(ref)!, { })
        return ref
    }
    
    public addContent (ref: number, content: string) {
        const source = this.getSource(ref)
        this._sourceCache.set(source, {
            content
        })
    }
    
    public getBreakpoints (): BreakpointsCache {
        const res: BreakpointsCache = [ ]
        this._sources.forEach(source => {
            const bps = this._breakpoints.get(source)
            if (bps) 
                res.push({
                    moduleName: source.name,
                    bps
                })
            
        })
        return res
    }
    
    public setBreakpoints (ref: number | string, lines: BreakpointInfo[]) {
        const source = this.getSource(ref)
        this._breakpoints.set(source, lines)
    }
    
    public getAllSources (): Source[] {
        return Array.from(this._sources.values())
    }
    
    public getIfSourceVerified (ref: number | string): boolean {
        const source = this.getSource(ref)
        const contents = this._sourceCache.get(source)
        if (!contents) 
            return false
        
        return contents.verified || false
    }
    
    public setSourceVerified (ref: number | string, verified: boolean) {
        const source = this.getSource(ref)
        const contents = this._sourceCache.get(source)
        if (!contents) 
            return
        
        contents.verified = verified
    }
}

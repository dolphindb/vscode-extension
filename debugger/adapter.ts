import {
    LoggingDebugSession,
    InitializedEvent,
    StackFrame,
    StoppedEvent,
    TerminatedEvent,
    Thread,
    OutputEvent,
    Scope,
    ContinuedEvent,
} from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol'

import type { DdbObj } from 'dolphindb'

import { Remote } from './network.js'
import { normalizePathAndCasing, loadSource, checkFile } from './utils.js'

import { Sources } from './sources.js'
import { t } from '../i18n/index.js'


interface DdbLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** 用户脚本路径 */
    program: string
    
    url: string
    
    username: string
    
    password: string
    
    autologin: boolean
}


type LoginResponseData = {
    status: number // TODO
}

type BreakPoint = DebugProtocol.Breakpoint

type SetBreakpointsResponseData = BreakPoint[]

type StackTraceRequestArguments = Pick<DebugProtocol.StackTraceArguments, 'startFrame' | 'levels'>

type StackTraceResponseData = {
    stackFrames: StackFrame[]
    totalFrames?: number
}

type PauseEventReceiveData = {
    status: string
    line: number
}

type PauseEventData = {
    reason: 'step' | 'breakpoint' | 'exception' | 'pause' | 'entry' | 'goto' | 'function breakpoint' | 'data breakpoint' | 'instruction breakpoint'
    
    description?: string
} & PauseEventReceiveData

type EndEventData = {
    status: string
    line: number
}

type StackFrameRes = {
    stackFrameId: number
    line: number
    name?: string
    column?: number
    moduleName?: string
}

type VariableRes = {
    name: string
    type: string
    form: string
    rows?: number
    columns?: number
    bytes: number
    vid: number
    data?: any
    extra?: any
    binValue?: Uint8Array
    offset?: number
    ddbValue?: DdbObj
    value?: string
}

type ExceptionContext = {
    line: number
    moduleName: string
}


/** 等待一些请求返回，用来阻塞依赖于这些请求的函数的锁 */
class Prerequisites {
    private _prerequisites: Map<
        string,
        {
            loaded: Promise<any>
            resolve: (value: any) => void
        }
    >
    
    constructor () {
        this._prerequisites = new Map()
    }
    
    public create (name: string) {
        let resolve: (value: any) => void = () => { }
        const loaded = new Promise(res => (resolve = res))
        this._prerequisites.set(name, { loaded, resolve })
    }
    
    public wait (name: string) {
        return this._prerequisites.get(name)?.loaded
    }
    
    public resolve (name: string, value?: any) {
        const prerequisite = this._prerequisites.get(name)
        if (prerequisite) 
            prerequisite.resolve(value)
        
    }
}


/** override DebugSession的方法以支持某些功能，详见DAP */
export class DdbDebugSession extends LoggingDebugSession {
    // 不支持多线程，threadID固定为1
    private static readonly threadID = 1
    
    // 与server交互的对象
    private _remote: Remote
    private _launchArgs: DdbLaunchRequestArguments
    
    private _prerequisites: Prerequisites = new Prerequisites()
    
    // 资源相关
    private _sources: Sources
    private _entrySourceRef: number
    private _entrySourcePath: string
    
    // 栈帧、变量等查询时的缓存，server会一次性返回，但vsc会分多次查询
    private _stackTraceCache: StackFrame[] = []
    private _stackTraceChangeFlag: boolean = true
    private _scopeCache: Map<number, DebugProtocol.Variable[]> = new Map()
    private static id: number = 0
    get genId () {
        return DdbDebugSession.id++
    }
    private _exceptionBreakpoint: boolean = false
    
    // 初始化时compile error，则在文档首部显示异常展示错误信息
    private _compileErrorFlag: boolean = false
    private _exceptionInfo: DebugProtocol.ExceptionInfoResponse['body']
    // 后端要求的，异常时可能查不到栈帧信息的处理
    private _exceptionFlag: boolean = false
    private _exceptionCtx: ExceptionContext = { line: 0, moduleName: '' }
    // 会话结束后，不应当继续发送其他网络请求
    private _terminated: boolean = false
    private _restarting: boolean = false
    
    constructor () {
        super()
        
        // line start at 0 in server
        this.setDebuggerLinesStartAt1(false)
        this.setDebuggerColumnsStartAt1(false)
        
        this._prerequisites.create('configurationDone')
        this._prerequisites.create('sourceLoaded')
        this._prerequisites.create('scriptResolved')
    }
    
    private registerEventHandlers () {
        // 因为syntax和error服务端返回写到了外层message中，其余事件数据都在data中，这里注册的时候不是很优雅~~(都怪后端)~~
        this._remote.on('SYNTAX', this.handleSyntaxErr.bind(this))
        this._remote.on('ERROR', this.handleException.bind(this))
        this._remote.on('BREAKPOINT', ({ data }: { data: PauseEventReceiveData }) => this.handlePause({ reason: 'breakpoint', ...data }))
        this._remote.on('STEP', ({ data }: { data: PauseEventReceiveData }) => this.handlePause({ reason: 'step', ...data }))
        this._remote.on('END', ({ data }: { data: EndEventData }) => this.handleTerminate(data))
        this._remote.on('OUTPUT', this.handleOutput.bind(this))
    }
    
    protected override initializeRequest (response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        // the capabilities of this debug adapter, see more: https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Initialize
        response.body = response.body || { }
        
        response.body.supportsConfigurationDoneRequest = true
        
        // make VS Code send the breakpointLocations request (所有可能的断点位置)
        // 不知道vsc如何调用这个request，相关代码已删除，可以在commit搜breakpointLocations
        response.body.supportsBreakpointLocationsRequest = false
        
        response.body.supportsRestartRequest = true
        
        response.body.supportsExceptionInfoRequest = true
        
        response.body.supportTerminateDebuggee = true
        
        response.body.supportsLoadedSourcesRequest = true
        
        // 目前server仅支持所有异常都展示或都不展示
        response.body.supportsExceptionFilterOptions = true
        response.body.exceptionBreakpointFilters = [
            {
                filter: 'exceptions',
                label: 'Exceptions',
                description: 'Catch and show all exceptions'
            }
        ]
        
        this.sendResponse(response)
        
        this.sendEvent(new InitializedEvent())
    }
    
    protected override configurationDoneRequest (
        response: DebugProtocol.ConfigurationDoneResponse,
        args: DebugProtocol.ConfigurationDoneArguments
    ): void {
        super.configurationDoneRequest(response, args)
        
        this._prerequisites.resolve('configurationDone')
    }
    
    protected override async launchRequest (response: DebugProtocol.LaunchResponse, args: DdbLaunchRequestArguments) {
        // 传入用户名密码，发送消息发现未连接时建立连接，同时根据autologin决定是否登录
        this._remote = new Remote(args.url, args.username, args.password, args.autologin, this.handleServerError.bind(this))
        this._sources = new Sources(this._remote)
        this._launchArgs = args
        
        // 加载主文件资源
        const entryPath = (this._entrySourcePath = normalizePathAndCasing(args.program))
        loadSource(entryPath)
            .then(async source => {
                const src = source.replace(/\r\n/g, '\n')
                this._entrySourceRef = this._sources.add({
                    name: '',
                    path: entryPath
                })
                this._sources.addContent(this._entrySourceRef, src)
                this._prerequisites.resolve('sourceLoaded')
                
                const res = await this._remote.call('parseScriptWithDebug', [src])
                Object.entries(res.modules).forEach(([name, path]) => {
                    this._sources.add({
                        name,
                        path: path as string
                    })
                })
                this._prerequisites.resolve('scriptResolved')
            })
            .catch(err => {
                if (err.code === 'ENOENT') {
                    this.sendEvent(new OutputEvent(t('本地找不到文件{{entryPath}}，请先将这个文件下载到本地再启动debug\n', { entryPath }), 'stderr'))
                    this.sendEvent(new TerminatedEvent())
                    this._remote.terminate()
                }
            })
            
        this.registerEventHandlers()
        
        await Promise.all([this._prerequisites.wait('scriptResolved'), this._prerequisites.wait('configurationDone')])
        
        this._remote.call('runScriptWithDebug')
        this.sendResponse(response)
    }
    
    protected override async loadedSourcesRequest (
        response: DebugProtocol.LoadedSourcesResponse,
        args: DebugProtocol.LoadedSourcesArguments,
        request?: DebugProtocol.Request | undefined
    ): Promise<void> {
        response.body = {
            sources: this._sources.getAllSources().filter(source => source.path !== this._entrySourcePath)
        }
        this.sendResponse(response)
    }
    
    protected override async setBreakPointsRequest (
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ): Promise<void> {
        if (this._terminated) 
            return
        
        await this._prerequisites.wait('sourceLoaded')
        const clientLines = args.lines || []
        const serverLines = clientLines.map(line => this.convertClientLineToDebugger(line))
        
        await this._prerequisites.wait('scriptResolved')
        
        const requestData = serverLines.map(line => ({
            line,
            verified: false
        }))
        const sourcePath = normalizePathAndCasing(args.source.path!)
        let moduleName = sourcePath === this._entrySourcePath ? '' : args.source.name!
        // vsc会缓存断点设置信息，下次debug会话开启时会直接调用setBreakPointsRequest
        // thanks to DDB强制要求moduleName与文件名一致，这里可以简单处理获取moduleName
        // .dos结尾的认为是本地文件（server module已经在resolveScript处处理去除dos后缀），需要进行一次校验
        if (moduleName.endsWith('.dos')) {
            moduleName = moduleName.slice(0, -4)
            // 先排除本次debug中没有使用的文件
            try {
                this._sources.getSource(moduleName)
            } catch (e) {
                this.sendEvent(
                    new OutputEvent(
                        t('文件{{sourcePath}}中设置了断点，但在本次debug会话的中不会被使用到，将自动忽略\n', { sourcePath: args.source.path }),
                        'stderr'
                    )
                )
                response.body = {
                    breakpoints: requestData
                }
                this.sendResponse(response)
                return
            }
            // 校验本地文件与server侧是否一致
            checkFile(moduleName, sourcePath, this._sources).then(valid => {
                if (!valid) 
                    this.sendEvent(
                        new OutputEvent(
                            t('本地文件{{sourcePath}}与服务器文件不一致，在本地文件中设置的断点可能导致未知错误，建议先同步文件\n', {
                                sourcePath: args.source.path
                            }),
                            'stderr'
                        )
                    )
                
            })
        }
        
        const res = (await this._remote.call('setBreaks', [moduleName, requestData.map(bp => bp.line)])) as [string, number[]]
        
        const actualBreakpoints = clientLines.map(line => ({
            id: this.genId,
            line,
            // 服务端会返回设置成功的断点，不成功的断点（如空行）直接标记为未命中
            verified: res[1].includes(this.convertClientLineToDebugger(line)),
            source: this._sources.getSource(moduleName)
        }))
        this._sources.setBreakpoints(moduleName, actualBreakpoints)
        
        response.body = {
            breakpoints: actualBreakpoints
        }
        this.sendResponse(response)
    }
    
    /** 区分不同类型断点，目前只有一种，这个方法用简单写法 */
    protected override async setExceptionBreakPointsRequest (
        response: DebugProtocol.SetExceptionBreakpointsResponse,
        args: DebugProtocol.SetExceptionBreakpointsArguments,
        request?: DebugProtocol.Request | undefined
    ): Promise<void> {
        await this._prerequisites.wait('scriptResolved')
        if (args.filterOptions?.length) {
            await this._remote.call('setAllExceptionBreak', [true])
            this._exceptionBreakpoint = true
        } else {
            await this._remote.call('setAllExceptionBreak', [false])
            this._exceptionBreakpoint = false
        }
        this.sendResponse(response)
    }
    
    protected override threadsRequest (response: DebugProtocol.ThreadsResponse): void {
        response.body = {
            threads: [new Thread(DdbDebugSession.threadID, 'thread 1')]
        }
        this.sendResponse(response)
    }
    
    /** 栈帧查询，vsc会根据每个栈帧中的line来展示当前执行到哪里、各函数入口位置等 */
    protected override async stackTraceRequest (response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {
        if (this._terminated) 
            return
        
        // 每次stop/restart之后清空stackTrace缓存
        // 这里用一个deferred和一个flag来阻止vsc重复请求栈帧以避免发送多次网络请求
        await this._prerequisites.wait('stackTraceRequest')
        if (this._stackTraceChangeFlag) {
            this._prerequisites.create('stackTraceRequest')
            const res: StackFrameRes[] = await this._remote.call('stackTrace')
            res.reverse()
            this._stackTraceCache = await Promise.all(
                res.map(async frame => {
                    const { stackFrameId, name, line, column } = frame
                    let moduleName: number | string | undefined = frame.moduleName
                    // 没有moduleName的栈帧是shared作用域
                    if (moduleName === undefined) 
                        return new StackFrame(stackFrameId, 'shared', this._sources.getSource(this._entrySourceRef), 0, 0)
                    
                    // 特判，入口文件在Server端的moduleName为空
                    if (moduleName === '') 
                        moduleName = this._entrySourceRef
                    
                    const sourceLines = await this._sources.getLines(moduleName)
                    
                    return new StackFrame(
                        stackFrameId,
                        name ?? `line ${line}: ${sourceLines[line].trim()}`,
                        this._sources.getSource(moduleName),
                        this.convertDebuggerLineToClient(line),
                        this.convertDebuggerColumnToClient(column ?? 0)
                    )
                })
            )
            this._stackTraceChangeFlag = false
            this._prerequisites.resolve('stackTraceRequest')
        }
        
        // vsc做stackTrace查询时会传入startFrame和levels参数来限制范围
        let stackFrames: StackFrame[]
        const start = args.startFrame || 0
        if (args.levels) stackFrames = this._stackTraceCache.slice(start, start + args.levels)
        else stackFrames = this._stackTraceCache.slice(start)
        
        // 初始编译错误造成的程序终止，vsc也会查询栈帧，此时返回一个停在第0行的指示即可
        if (this._compileErrorFlag) 
            stackFrames = this._stackTraceCache.slice(-1, this._stackTraceCache.length)
        
        // 后端要求的，异常时可能查不到栈帧信息的处理
        if (this._exceptionFlag) 
            if (stackFrames.length === 0) 
                stackFrames.push(new StackFrame(0, 'exception', this._sources.getSource(this._exceptionCtx.moduleName), this._exceptionCtx.line, 0))
            
        
        
        response.body = {
            stackFrames,
            totalFrames: this._stackTraceCache.length
        }
        
        this.sendResponse(response)
    }
    
    /** 由于Ddb不区分stackTrace和scope，该返回信息与stackTrace一致（认为一个stackTrace只有一个scope） */
    protected override scopesRequest (
        response: DebugProtocol.ScopesResponse,
        args: DebugProtocol.ScopesArguments,
        request?: DebugProtocol.Request | undefined
    ): void {
        if (this._terminated) 
            return
        
        const frame = this._stackTraceCache.find(frame => frame.id === args.frameId)
        if (!frame) {
            this.sendResponse(response)
            return
        }
        response.body = {
            scopes: [new Scope(frame.name ?? `scope ${frame.id}`, frame.id, false)]
        }
        this.sendResponse(response)
    }
    
    /* 
        由于对scope的查询和对复杂变量的查询被DAP认为是同一种查询
        服务端确定一个变量是通过frameId和vid来确定的
        我们通过这样的方式来构造一个用于DAP的 variable reference
        variable reference除符号位最高位表示是scope还是variable，0表示是scope，1表示是variable
        表示变量时，共31位（符号位不能用），除符号位与首位，剩余高14位是frameId，低16位是vid（debug mode下肯定够用叭qwq）
        返回的variable reference = 0 表示是一个基本类型的已知变量，vsc不会再做额外请求
    */
    /* 
        返回结果如果有data就直接展示，没有data的话，vid一定不是0，然后会根据frameId, vid, variableName进行二次查询
        另外，返回值里如果有offset的话，会优先根据offset处理，生成一个value字段直接展示
        优先级：offset(value) > data > vid
    */
    protected override async variablesRequest (
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments,
        request?: DebugProtocol.Request | undefined
    ): Promise<void> {
        if (this._terminated) 
            return
        
        const reduceVariables = (variables: VariableRes[], frameId: number): DebugProtocol.Variable[] => {
            return variables.map(variable => {
                const { name, value, data, vid, type, form } = variable
                const resvar: DebugProtocol.Variable = {
                    name,
                    value: value ?? '',
                    variablesReference: 0
                }
                if (value === undefined) 
                    // 根据network handle处理逻辑，有offset字段则一定有value
                    if (data === undefined) {
                        resvar.value = form && type ? `${form}<${type}>` : ''
                        resvar.presentationHint = { lazy: true }
                        resvar.variablesReference = (1 << 30) | (frameId << 16) | vid
                    } else 
                        resvar.value = data.toString()
                    
                
                return resvar
            })
        }
        
        if (args.variablesReference & (1 << 30)) {
            const frameId = (args.variablesReference >> 16) & 0x3fff
            const vid = args.variablesReference & 0xffff
            const vName = this._scopeCache.get(frameId)?.find(v => v.variablesReference === args.variablesReference)?.name
            const res: VariableRes = await this._remote.call('getVariable', [frameId, vid, vName])
            response.body = {
                variables: reduceVariables([res], frameId)
            }
        } else {
            const frameId = args.variablesReference
            // TODO: 根据_stackTraceChangeFlag去做一个缓存
            const res: VariableRes[] = await this._remote.call('getStackVariables', [frameId])
            const resVars = reduceVariables(res, frameId)
            this._scopeCache.set(args.variablesReference, resVars)
            response.body = {
                variables: resVars
            }
        }
        
        this.sendResponse(response)
    }
    
    /** 异常信息由server推送的ERROR事件返回 */
    protected override exceptionInfoRequest (
        response: DebugProtocol.ExceptionInfoResponse,
        args: DebugProtocol.ExceptionInfoArguments,
        request?: DebugProtocol.Request | undefined
    ): void {
        response.body = this._exceptionInfo
        this.sendResponse(response)
    }
    
    protected override async sourceRequest (
        response: DebugProtocol.SourceResponse,
        args: DebugProtocol.SourceArguments,
        request?: DebugProtocol.Request | undefined
    ): Promise<void> {
        const content = await this._sources.getContent(args.sourceReference)
        response.body = {
            content
        }
        this.sendResponse(response)
    }
    
    protected override async continueRequest (response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): Promise<void> {
        await this._remote.call('continueRun')
        this.sendResponse(response)
    }
    
    protected override async pauseRequest (response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): Promise<void> {
        await this._remote.call('pauseRun')
        this.sendResponse(response)
    }
    
    protected override async nextRequest (response: DebugProtocol.ContinueResponse, args: DebugProtocol.NextArguments): Promise<void> {
        await this._remote.call('stepOver')
        this.sendResponse(response)
    }
    
    protected override async stepInRequest (response: DebugProtocol.ContinueResponse, args: DebugProtocol.StepInArguments): Promise<void> {
        await this._remote.call('stepInto')
        this.sendResponse(response)
    }
    
    protected override async stepOutRequest (response: DebugProtocol.ContinueResponse, args: DebugProtocol.StepOutArguments): Promise<void> {
        await this._remote.call('stepOut')
        this.sendResponse(response)
    }
    
    protected override async restartRequest (
        response: DebugProtocol.RestartResponse,
        args: DebugProtocol.RestartArguments,
        request?: DebugProtocol.Request | undefined
    ): Promise<void> {
        // 一些节流操作
        if (this._terminated || this._restarting) 
            return
        
        this._restarting = true
        this._remote.terminate()
        
        // 重新开启一个与server交互的session
        const { url, username, password, autologin } = this._launchArgs
        this._remote = new Remote(url, username, password, autologin, this.handleServerError.bind(this))
        this.registerEventHandlers()
        
        // 暂存原先的断点信息
        const bpCache = this._sources.getBreakpoints()
        // 重新读取最新的主模块内容，重开本地sources缓存
        const entryPath = this._sources.getSource(this._entrySourceRef).path!
        const newSource = (await loadSource(entryPath)).replace(/\r\n/g, '\n')
        this._sources = new Sources(this._remote)
        this._entrySourceRef = this._sources.add({
            name: '',
            path: entryPath
        })
        this._sources.addContent(this._entrySourceRef, newSource)
        // 重新解析脚本，并分析可用模块
        const res = await this._remote.call('parseScriptWithDebug', [newSource])
        Object.entries(res.modules).forEach(([name, path]) => {
            this._sources.add({
                name,
                path: path as string
            })
        })
        
        // 重设缓存的断点，TODO：你们server什么时候能并行请求呀qwq
        // const bpRequests: Promise<any>[] = [];
        bpCache.forEach(async ({ moduleName, bps }) => {
            const resBps = await this._remote.call('setBreaks', [moduleName, bps.map(bp => this.convertClientLineToDebugger(bp.line))])
            const actualBreakpoints = bps.map(bp => ({
                id: bp.id,
                line: bp.line,
                verified: resBps[1].includes(this.convertClientLineToDebugger(bp.line)),
                source: this._sources.getSource(moduleName)
            }))
            this._sources.setBreakpoints(moduleName, actualBreakpoints)
        })
        await this._remote.call('setAllExceptionBreak', [this._exceptionBreakpoint])
        
        // 重新开始执行至第一个断点处
        this._stackTraceChangeFlag = true
        await this._remote.call('runScriptWithDebug')
        this.sendEvent(new ContinuedEvent(DdbDebugSession.threadID, true))
        
        this._restarting = false
        this.sendResponse(response)
    }
    
    protected override async disconnectRequest (
        response: DebugProtocol.DisconnectResponse,
        args: DebugProtocol.DisconnectArguments,
        request?: DebugProtocol.Request
    ): Promise<void> {
        if (this._terminated) 
            return
        
        this._terminated = true
        await this._remote.call('stopRun')
        this._remote.terminate()
        this.sendResponse(response)
    }
    
    // 以下为server主动推送事件的回调
    private handlePause ({ reason }: PauseEventData): void {
        this._stackTraceChangeFlag = true
        this.sendEvent(new StoppedEvent(reason, DdbDebugSession.threadID))
    }
    
    private handleTerminate ({ status }: EndEventData): void {
        if (status === 'FINISHED' || status === 'STOPPED') {
            this._remote.terminate()
            this._terminated = true
            this.sendEvent(new TerminatedEvent())
        } else if (status === 'RESTARTED') 
            return
        
    }
    
    private handleOutput ({ data }: { data: string }): void {
        console.debug(data)
        this.sendEvent(new OutputEvent(`${data}\n`, 'stdout'))
    }
    
    // SyntaxError与Exception被server区分开了，但这边统一合并为Exception便于展示
    private handleSyntaxErr (msg: { message: string }): void {
        this._compileErrorFlag = true
        this.handleException({ message: msg.message, data: { line: -1, moduleName: '' } })
    }
    
    private handleException ({ message, data }: { message: string, data: ExceptionContext }): void {
        this._stackTraceChangeFlag = true
        this._exceptionFlag = true
        this._exceptionCtx = {
            line: this.convertDebuggerLineToClient(data.line ?? -1),
            moduleName: data.moduleName
        }
        this._exceptionInfo = {
            exceptionId: 'Exception',
            description: message,
            breakMode: 'always'
        }
        this.sendEvent(new StoppedEvent('exception', DdbDebugSession.threadID, message))
        this.sendEvent(new OutputEvent(`${message}\n`, 'stderr'))
    }
    
    // Server出错时对用户的信息展示，内部方法
    private handleServerError (error: Error): void {
        this._compileErrorFlag = true
        this._stackTraceChangeFlag = false
        if (!this._stackTraceCache.length) 
            this._stackTraceCache = [new StackFrame(0, '', this._sources.getSource(this._entrySourceRef), 0, 0)]
        
        this._exceptionInfo = {
            exceptionId: 'Error',
            description: error.message,
            breakMode: 'always'
        }
        this.sendEvent(new StoppedEvent('exception', DdbDebugSession.threadID, error.message))
        this.sendEvent(new OutputEvent(t(error.message), 'stderr'))
    }
}

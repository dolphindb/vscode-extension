import {
	LoggingDebugSession, InitializedEvent, Source, StackFrame, StoppedEvent, TerminatedEvent, Thread, OutputEvent, Scope, BreakpointEvent, ContinuedEvent, LoadedSourceEvent
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { Remote } from './network.js';
import { basename } from 'path';
import { normalizePathAndCasing, loadSource } from './utils.js';
import { PauseEventData, PauseEventReceiveData, EndEventData, StackFrameRes, VariableRes } from './requestTypes.js';
import { Sources } from './sources.js';

interface DdbLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** 用户脚本路径 */
	program: string;
	
	url: string;
	
	username: string;
	
	password: string;
	
	autologin: boolean;
}

/** 等待一些请求返回，用来阻塞依赖于这些请求的函数的锁 */
class Prerequisites {
	private _prerequisites: Map<string, {
		loaded: Promise<any>;
		resolve: (value: any) => void;
	}>;
	
	constructor() {
		this._prerequisites = new Map();
	}
	
	public create(name: string) {
		let resolve: (value: any) => void = () => {};
		const loaded = new Promise((res) => resolve = res);
		this._prerequisites.set(name, { loaded, resolve });
	}
	
	public wait(name: string) {
		return this._prerequisites.get(name)?.loaded;
	}
	
	public resolve(name: string, value?: any) {
		const prerequisite = this._prerequisites.get(name);
		if (prerequisite) {
			prerequisite.resolve(value);
		}
	}
}

/** override DebugSession的方法以支持某些功能，详见DAP */
export class DdbDebugSession extends LoggingDebugSession {
  // 不支持多线程，threadID固定为1
	private static readonly threadID = 1;
	
	// 与server交互的对象
	private _remote: Remote;
	private _launchArgs: DdbLaunchRequestArguments;
	
	private _prerequisites: Prerequisites = new Prerequisites();
	
	// 资源相关
	private _sources: Sources;
	private _mainSourceRef: number;
	
	// 栈帧、变量等查询时的缓存，server会一次性返回，但vsc会分多次查询
	private _stackTraceCache: StackFrame[] = [];
	private _stackTraceChangeFlag: boolean = true;
	private _scopeCache: Map<number, DebugProtocol.Variable[]> = new Map();
	private static id: number = 0;
	get genId() {
		return DdbDebugSession.id++;
	}
	private _breakpoints: Array<{
		id: number;
    line: number;
    verified: boolean;
	}> = [];
	private _exceptionBreakpoint: boolean = false;
	
	// 初始化时compile error，则在文档首部显示异常展示错误信息
	private _compileErrorFlag: boolean = false;
	private _exceptionInfo: DebugProtocol.ExceptionInfoResponse['body'];
	// 后端要求的，异常时可能查不到栈帧信息的处理
	private _exceptionFlag: boolean = false;
	private _exceptionLine: number = 0;
	// 会话结束后，不应当继续发送其他网络请求
	private _terminated: boolean = false;
	
	constructor() {
		super();
		
		// line start at 0 in server
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);
		
		this._prerequisites.create('configurationDone');
		this._prerequisites.create('sourceLoaded');
		this._prerequisites.create('scriptResolved'); 
	}
	
	private registerEventHandlers() {
		// 因为syntax和error服务端返回写到了外层message中，其余事件数据都在data中，这里注册的时候不是很优雅~~(都怪后端)~~
		this._remote.on('SYNTAX', this.handleSyntaxErr.bind(this));
		this._remote.on('ERROR', this.handleException.bind(this));
		this._remote.on('BREAKPOINT', ({ data }: { data: PauseEventReceiveData }) => this.handlePause({ reason: 'breakpoint', ...data }));
		this._remote.on('STEP', ({ data }: { data: PauseEventReceiveData }) => this.handlePause({ reason: 'step', ...data }));
		this._remote.on('END', ({ data }: { data: EndEventData }) => this.handleTerminate(data));
		this._remote.on('OUTPUT', this.handleOutput.bind(this));
	}
	
	protected override initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		// the capabilities of this debug adapter, see more: https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Initialize
		response.body = response.body || {};

		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code send the breakpointLocations request (所有可能的断点位置)
		// 不知道vsc如何调用这个request，相关代码已删除，可以在commit搜breakpointLocations
		response.body.supportsBreakpointLocationsRequest = false;
		
		response.body.supportsRestartRequest = true;

		response.body.supportsExceptionInfoRequest = true;

		response.body.supportTerminateDebuggee = true;
		
		// 目前server仅支持所有异常都展示或都不展示
		response.body.supportsExceptionFilterOptions = true;
		response.body.exceptionBreakpointFilters = [
			{
				filter: 'exceptions',
				label: 'Exceptions',
				description: 'Catch and show all exceptions'
			}
		];

		this.sendResponse(response);

		this.sendEvent(new InitializedEvent());
	}
	
	protected override configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		this._prerequisites.resolve('configurationDone');
	}
	
	protected override async launchRequest(response: DebugProtocol.LaunchResponse, args: DdbLaunchRequestArguments) {
		// 传入用户名密码，发送消息发现未连接时建立连接，同时根据autologin决定是否登录
		this._remote = new Remote(args.url, args.username, args.password, args.autologin, this.handleServerError.bind(this));
		this._sources = new Sources(this._remote);
		this._launchArgs = args;
		
		// 加载主文件资源
		const entryPath = normalizePathAndCasing(args.program);
		loadSource(entryPath).then(async (source) => {
			const src = source.replace(/\r\n/g, '\n');
			this._mainSourceRef = this._sources.add({
				name: entryPath.split('/').pop(),
				path: entryPath,
			});
			this._sources.addContent(this._mainSourceRef, src);
			this._prerequisites.resolve('sourceLoaded');
			
			const res = await this._remote.call('parseScriptWithDebug', [src]);
			// Object.entries(res.modules).forEach(([source, lines]) => {
			// 	if (source !== '') {
			// 		this.sendEvent(new LoadedSourceEvent('new', { 
			// 			name: source,
			// 			sourceReference: this.genId,
			// 		}));
			// 	}
			// });
			this._prerequisites.resolve('scriptResolved');
		});
		
		this.registerEventHandlers();
		
		await Promise.all([
			this._prerequisites.wait('scriptResolved'),
			this._prerequisites.wait('configurationDone'),
		]);
		
		this._remote.call('runScriptWithDebug');
		this.sendResponse(response);
	}
	
	protected override async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
		if (this._terminated) {
			return;
		}
		await this._prerequisites.wait('sourceLoaded');
		// TODO: 多文件支持
		if (!args.source.path ||
			this._sources.get(this._mainSourceRef).source.path != normalizePathAndCasing(args.source.path))
		{
			response.body = {
				breakpoints: args.lines ? args.lines.map(line => ({ line, verified: false })) : [],
			}
			this.sendResponse(response);
			return;
		}
		const clientLines = args.lines || [];
		const serverLines = clientLines.map(line => this.convertClientLineToDebugger(line));
		
		await this._prerequisites.wait('scriptResolved');
		
		const requestData = serverLines.map(line => ({
			line,
			verified: false,
		}));
		const res = await this._remote.call('setBreaks', [requestData.map(bp => bp.line)]) as number[];
		
		const actualBreakpoints = clientLines.map(line => ({
			id: this.genId,
			line,
			// 服务端会返回设置成功的断点，不成功的断点（如空行）直接标记为未命中
			verified: res.includes(this.convertClientLineToDebugger(line)),
		}));
		
		this._breakpoints = actualBreakpoints;
		
		response.body = {
			breakpoints: actualBreakpoints,
		};
		this.sendResponse(response);
	}
	
	/** 区分不同类型断点，目前只有一种，这个方法用简单写法 */
	protected override async setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments, request?: DebugProtocol.Request | undefined): Promise<void> {
		await this._prerequisites.wait('scriptResolved');
		if (args.filterOptions?.length) {
			await this._remote.call('setAllExceptionBreak', [true]);
			this._exceptionBreakpoint = true;
		} else {
			await this._remote.call('setAllExceptionBreak', [false]);
			this._exceptionBreakpoint = false;
		}
		this.sendResponse(response);
	}
	
	protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [new Thread(DdbDebugSession.threadID, 'thread 1')],
		};
		this.sendResponse(response);
	}
	
	/** 栈帧查询，vsc会根据每个栈帧中的line来展示当前执行到哪里、各函数入口位置等 */
	protected override async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {
		if (this._terminated) {
			return;
		}
		// 每次stop/restart之后清空stackTrace缓存
		if (this._stackTraceChangeFlag) {
			const res: StackFrameRes[] = await this._remote.call('stackTrace');
			res.reverse();
			const sourceLines = await this._sources.getLines(this._mainSourceRef);
			this._stackTraceCache = res.map((frame, index) => {
				const { stackFrameId, name, line, column } = frame;
				// 除了shared作用域，一般是以当前行代码命名stackTrace
				return new StackFrame(
					stackFrameId,
					name ?? index == res.length - 1 ? 'shared' : `line ${line}: ${sourceLines[line].trim()}`,
					// TODO: 多文件支持
					this.createSource(this._sources.get(this._mainSourceRef).source.path!),
					index == res.length - 1 ? 0 : this.convertDebuggerLineToClient(line),
					this.convertDebuggerColumnToClient(column ?? 0)
				);
			});
			this._stackTraceChangeFlag = false;
		}
		
		let stackFrames: StackFrame[];
		const start = args.startFrame || 0;
		
		if (args.levels)
			stackFrames = this._stackTraceCache.slice(start, start + args.levels);
		else
			stackFrames = this._stackTraceCache.slice(start);
			
		// 初始编译错误造成的程序终止，vsc也会查询栈帧，此时返回一个停在第0行的指示即可
		if (this._compileErrorFlag) {
			stackFrames = this._stackTraceCache.slice(-1, this._stackTraceCache.length);
		}
		// 后端要求的，异常时可能查不到栈帧信息的处理
		if (this._exceptionFlag) {
			if (stackFrames.length === 0) {
				stackFrames.push(new StackFrame(
					0,
					'exception',
					this.createSource(this._sources.get(this._mainSourceRef).source.path!),
					this._exceptionLine,
					0
				));
			} else {
				stackFrames[stackFrames.length - 1].line = this._exceptionLine;
				stackFrames[stackFrames.length - 1].name = 'exception';
			}
		}
		
		response.body = {
			stackFrames,
			totalFrames: this._stackTraceCache.length,
		};
		
		this.sendResponse(response);
	}
	
	/** 异常信息由server推送的ERROR事件返回 */
	protected override exceptionInfoRequest(response: DebugProtocol.ExceptionInfoResponse, args: DebugProtocol.ExceptionInfoArguments, request?: DebugProtocol.Request | undefined): void {
		response.body = this._exceptionInfo;
		this.sendResponse(response);
	}
	
	/** 由于Ddb不区分stackTrace和scope，该返回信息与stackTrace一致（认为一个stackTrace只有一个scope） */
	protected override scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments, request?: DebugProtocol.Request | undefined): void {
		if (this._terminated) {
			return;
		}
		const frame = this._stackTraceCache.find(frame => frame.id === args.frameId);
		if (!frame) {
			this.sendResponse(response);
			return;
		}
		response.body = {
			scopes: [
				new Scope(
					frame.name ?? `scope ${frame.id}`,
					frame.id,
					false
				),
			],
		};
		this.sendResponse(response);
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
	protected override async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request | undefined): Promise<void> {
		if (this._terminated) {
			return;
		}
		const reduceVariables = (variables: VariableRes[], frameId: number): DebugProtocol.Variable[] => {
			return variables.map(variable => {
				const { name, value, data, vid, type, form } = variable;
				const resvar: DebugProtocol.Variable = {
					name,
					value: value ?? '',
					variablesReference: 0,
				};
				if (value === undefined) {
					// 根据network handle处理逻辑，有offset字段则一定有value
					if (data === undefined) {
						resvar.value = (form && type) ? `${form}<${type}>` : '';
						resvar.presentationHint = { lazy: true };
						resvar.variablesReference = (1 << 30) | (frameId << 16) | vid;
					} else {
						resvar.value = data.toString();
					}
				}
				return resvar;
			})
		};
		
		if (args.variablesReference & (1 << 30)) {
			const frameId = (args.variablesReference >> 16) & 0x3fff;
			const vid = args.variablesReference & 0xffff;
			const vName = this._scopeCache.get(frameId)?.find(v => v.variablesReference === args.variablesReference)?.name;
			const res: VariableRes = await this._remote.call('getVariable', [frameId, vid, vName]);
			response.body = {
				variables: reduceVariables([res], frameId),
			};
		} else {
			const frameId = args.variablesReference;
			const res: VariableRes[] = await this._remote.call('getStackVariables', [frameId]);
			const resVars = reduceVariables(res, frameId);
			this._scopeCache.set(args.variablesReference, resVars);
			response.body = {
				variables: resVars,
			};
		}
		
		this.sendResponse(response);
	}
	
	protected override async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): Promise<void> {
		await this._remote.call('continueRun');
		this.sendResponse(response);
	}
	
	protected override async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): Promise<void> {
		await this._remote.call('pauseRun');
		this.sendResponse(response);
	}
	
	protected override async nextRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.NextArguments): Promise<void> {
		await this._remote.call('stepOver');
		this.sendResponse(response);
	}
	
	protected override async stepInRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.StepInArguments): Promise<void> {
		await this._remote.call('stepInto');
		this.sendResponse(response);
	}
	
	protected override async stepOutRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.StepOutArguments): Promise<void> {
		await this._remote.call('stepOut');
		this.sendResponse(response);
	}
	
	protected override async restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments, request?: DebugProtocol.Request | undefined): Promise<void> {
		if (this._terminated) {
			return;
		}
		
		this._remote.terminate();
		const { url, username, password, autologin } = this._launchArgs;
		this._remote = new Remote(url, username, password, autologin, this.handleServerError.bind(this));
		this.registerEventHandlers();
		
		const entryPath = this._sources.get(this._mainSourceRef).source.path!;
		const newSource = (await loadSource(entryPath)).replace(/\r\n/g, '\n');
		this._sources = new Sources(this._remote);
		this._mainSourceRef = this._sources.add({
			name: entryPath.split('/').pop(),
			path: entryPath,
		});
		this._sources.addContent(this._mainSourceRef, newSource);
		
		await this._remote.call('parseScriptWithDebug', [newSource]);
		
		const res = await this._remote.call('setBreaks', [this._breakpoints.map(bp => this.convertClientLineToDebugger(bp.line))]) as number[]
		const actualBreakpoints = this._breakpoints.map(bp => ({
			id: bp.id,
			line: bp.line,
			verified: res.includes(this.convertClientLineToDebugger(bp.line)),
		}));
		this._breakpoints = actualBreakpoints;
		this._breakpoints.forEach(bp => this.sendEvent(new BreakpointEvent('changed', bp)));
		await this._remote.call('setAllExceptionBreak', [this._exceptionBreakpoint]);
		
		// await this._remote.call('restartRun');
		this._stackTraceChangeFlag = true;
		await this._remote.call('runScriptWithDebug');
		this.sendEvent(new ContinuedEvent(DdbDebugSession.threadID, true));
		this.sendResponse(response);
	}
	
	protected override async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): Promise<void> {
		this._remote.terminate();
		this._terminated = true;
		this.sendResponse(response);
	}
	
	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'ddb-da-data');
	}
	
	// 以下为server主动推送事件的回调
	private handlePause({ reason }: PauseEventData): void {
		this._stackTraceChangeFlag = true;
		this.sendEvent(new StoppedEvent(reason, DdbDebugSession.threadID));
	}
	
	private handleTerminate({ status }: EndEventData): void {
		if (status === 'FINISHED' || status === 'STOPPED') {
			this._remote.terminate();
			this._terminated = true;
			this.sendEvent(new TerminatedEvent());
		} else if (status === 'RESTARTED') {
			return;
		}
	}
	
	private handleOutput({ data }: { data: string }): void {
		console.debug(data);
		this.sendEvent(new OutputEvent(data, 'stdout'));
	}
	
	// SyntaxError与Exception被server区分开了，但这边统一合并为Exception便于展示
	private handleSyntaxErr(msg: { message: string }): void {
		this._compileErrorFlag = true;
		this.handleException({ message: msg.message, data: { line: -1 } });
	}
	
	private handleException({ message, data }: { message: string; data: { line?: number } }): void {
		this._stackTraceChangeFlag = true;
		this._exceptionFlag = true;
		this._exceptionLine = this.convertDebuggerLineToClient(data.line ?? -1);
		this._exceptionInfo = {
			exceptionId: 'Exception',
			description: message,
			breakMode: 'always',
		}
		this.sendEvent(new StoppedEvent('exception', DdbDebugSession.threadID, message));
		this.sendEvent(new OutputEvent(message, 'stderr'));
	}
	
	// Server出错时对用户的信息展示，内部方法
	private handleServerError(error: Error): void {
		this._compileErrorFlag = true;
		this._stackTraceChangeFlag = false;
		if (!this._stackTraceCache.length) {
			this._stackTraceCache = [new StackFrame(0, '', this.createSource(this._sources.get(this._mainSourceRef).source.path!), 0, 0)];
		}
		this._exceptionInfo = {
			exceptionId: 'Error',
			description: error.message,
			breakMode: 'always',
		}
		this.sendEvent(new StoppedEvent('exception', DdbDebugSession.threadID, error.message));
		this.sendEvent(new OutputEvent(error.message, 'stderr'));
	}
}
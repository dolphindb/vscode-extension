import {
	LoggingDebugSession, InitializedEvent, Source, StackFrame, StoppedEvent, TerminatedEvent, Thread, OutputEvent, Scope
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { Remote } from './network.js';
import { basename } from 'path';
import { normalizePathAndCasing, loadSource } from './utils.js';
import { PauseEventData, PauseEventReceiveData, EndEventData, StackFrameRes, VariableRes } from './requestTypes.js';

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
	
	private _prerequisites: Prerequisites;
	
	// 用户脚本路径
	private _source: string;
	private _sourceLines: string[];
	private _sourcePath: string;
	
	// 栈帧、变量等查询时的缓存，server会一次性返回，但vsc会分多次查询
	private _stackTraceCache: StackFrame[] = [];
	private _stackTraceChangeFlag: boolean = true;
	private _scopeCache: Map<number, DebugProtocol.Variable[]> = new Map();
	
	// 初始化时compile error，则在文档首部显示异常展示错误信息
	private _compileErrorFlag: boolean = false;
	private _exceptionInfo: DebugProtocol.ExceptionInfoResponse['body'];
	
	constructor() {
		super();
		
		// line start at 0 in server
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);
		
		this._prerequisites = new Prerequisites();
		this._prerequisites.create('configurationDone');
		this._prerequisites.create('sourceLoaded');
		this._prerequisites.create('scriptResolved'); 
		this._prerequisites.create('breakpointsSetted');
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

		this.sendResponse(response);

		this.sendEvent(new InitializedEvent());
	}
	
	protected override configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		this._prerequisites.resolve('configurationDone');
	}
	
	protected override async launchRequest(response: DebugProtocol.LaunchResponse, args: DdbLaunchRequestArguments) {
		// 传入用户名密码，发送消息发现未登录时自动登录
		this._remote = new Remote(args.url, args.username, args.password, args.autologin);
		
		// 加载资源
		this._sourcePath = normalizePathAndCasing(args.program);
		loadSource(args.program).then(async (source) => {
			this._source = source.replace(/\r\n/g, '\n');
			this._sourceLines = this._source.split('\n');
			this._prerequisites.resolve('sourceLoaded');
			
			await this._remote.call('parseScriptWithDebug', [this._source]);
			this._prerequisites.resolve('scriptResolved');
		});
		
		// 因为syntax和error服务端返回写到了外层message中，其余事件数据都在data中，这里注册的时候不是很优雅~~(都怪后端)~~
		this._remote.on('SYNTAX', this.handleSyntaxErr.bind(this));
		this._remote.on('ERROR', this.handleException.bind(this));
		this._remote.on('BREAKPOINT', ({ data }: { data: PauseEventReceiveData }) => this.handlePause({ reason: 'breakpoint', ...data }));
		this._remote.on('STEP', ({ data }: { data: PauseEventReceiveData }) => this.handlePause({ reason: 'step', ...data }));
		this._remote.on('END', ({ data }: { data: EndEventData }) => this.handleTerminate(data));
		this._remote.on('OUTPUT', this.handleOutput.bind(this));
		this._remote.on('SERVER ERROR', this.handleServerError.bind(this));
		
		await Promise.all([
			this._prerequisites.wait('configurationDone'),
			this._prerequisites.wait('breakpointsSetted'),
		]);
		
		this._remote.call('runScriptWithDebug');
	}
	
	protected override async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
		const clientLines = args.lines || [];
		const serverLines = clientLines.map(line => this.convertClientLineToDebugger(line));
		
		await this._prerequisites.wait('scriptResolved');
		
		const requestData = serverLines.map(line => ({
			line,
			verified: false,
		}));
		const res = await this._remote.call('setBreaks', [requestData.map(bp => bp.line)]) as number[];
		
		const actualBreakpoints = clientLines.map(line => ({
			line,
			// 服务端会返回设置成功的断点，不成功的断点（如空行）直接标记为未命中
			verified: res.includes(this.convertClientLineToDebugger(line)),
		}));
		
		response.body = {
			breakpoints: actualBreakpoints,
		};
		this.sendResponse(response);
		this._prerequisites.resolve('breakpointsSetted');
	}
	
	protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [new Thread(DdbDebugSession.threadID, 'thread 1')],
		};
		this.sendResponse(response);
	}
	
	/** 栈帧查询，vsc会根据每个栈帧中的line来展示当前执行到哪里、各函数入口位置等 */
	protected override async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {
		// 每次stop/restart之后清空stackTrace缓存
		if (this._stackTraceChangeFlag) {
			const res: StackFrameRes[] = await this._remote.call('stackTrace');
			res.reverse();
			this._stackTraceCache = res.map((frame, index) => {
				const { stackFrameId, name, line, column } = frame;
				// 除了shared作用域，一般是以当前行代码命名stackTrace
				return new StackFrame(
					stackFrameId,
					name ?? index == res.length - 1 ? 'shared' : `line ${line}: ${this._sourceLines[line].trim()}`,
					this.createSource(this._sourcePath),
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
	protected override async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request | undefined): Promise<void> {
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
	
	protected override continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this._remote.call('continueRun');
	}
	
	protected override pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
		this._remote.call('pause');
	}
	
	protected override nextRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.NextArguments): void {
		this._remote.call('stepOver');
	}
	
	protected override stepInRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.StepInArguments): void {
		this._remote.call('stepInto');
	}
	
	protected override stepOutRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.StepOutArguments): void {
		this._remote.call('stepOut');
	}
	
	protected override restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments, request?: DebugProtocol.Request | undefined): void {
		this._remote.call('restartRun');
	}
	
	protected override async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): Promise<void> {
		this._remote.terminate();
		await this._remote.call('stopRun');
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
		if (status === 'FINISHED') {
			this._remote.terminate();
			this.sendEvent(new TerminatedEvent());
		} else if (status === 'RESTARTED') {
			return;
		}
	}
	
	private handleOutput({ data }: { data: string }): void {
		console.log(data);
		this.sendEvent(new OutputEvent(data));
	}
	
	// SyntaxError与Exception被server区分开了，但这边统一合并为Exception便于展示
	private handleSyntaxErr(msg: { message: string }): void {
		this._compileErrorFlag = true;
		this.handleException(msg);
	}
	
	private handleException({ message }: { message: string }): void {
		this._stackTraceChangeFlag = true;
		this._exceptionInfo = {
			exceptionId: 'Exception',
			description: message,
			breakMode: 'always',
		}
		this.sendEvent(new StoppedEvent('exception', DdbDebugSession.threadID, message));
	}
	
	// Server出错时对用户的信息展示，内部方法
	private handleServerError(message: string): void {
		this._compileErrorFlag = true;
		this._stackTraceChangeFlag = false;
		if (!this._stackTraceCache.length) {
			this._stackTraceCache = [new StackFrame(0, '', this.createSource(this._sourcePath), 0, 0)];
		}
		this.sendEvent(new StoppedEvent('exception', DdbDebugSession.threadID, message));
		this._exceptionInfo = {
			exceptionId: 'Error',
			description: message,
			breakMode: 'always',
		}
	}
}
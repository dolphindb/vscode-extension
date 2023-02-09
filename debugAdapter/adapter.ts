/**
 * This file implements a mock debug adapter that can be used for testing the debug extension.
 * See more details: https://github.com/Microsoft/vscode-mock-debug
 */
import {
	LoggingDebugSession, InitializedEvent, Source, StackFrame, StoppedEvent, TerminatedEvent, Thread, OutputEvent, Scope
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { Remote } from './network.js';
import { basename } from 'path';
import { normalizePathAndCasing, loadSource } from './utils.js';
import { BreakpointLocation, PauseEventData, NewBpLocationsEventData, PauseEventReceiveData, EndEventData, StackFrameRes, VariableRes } from './requestTypes.js';

interface DdbLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
	
	url: string;
	
	username: string;
	
	password: string;
  // TODO: 实现以下可选配置项
	// /** Automatically stop target after launch. If not specified, target does not stop. */
	// stopOnEntry?: boolean;
	// /** enable logging the Debug Adapter Protocol */
	// trace?: boolean;
	// /** run without debugging */
	// noDebug?: boolean;
}

/**
 * 等待一些请求返回，用来阻塞函数执行的锁
 */
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

export class DdbDebugSession extends LoggingDebugSession {
  // 目前不支持多线程，threadID固定为1
	private static readonly threadID = 1;
	
	// connect to server debugger
	private _remote: Remote;
	
	private _prerequisites: Prerequisites;
	
	private _source: string;
	private _sourceLines: string[];
	private _sourcePath: string;
	
	private _breakpointLocations: DebugProtocol.BreakpointLocation[];
	
	private _stackTraceCache: StackFrame[];
	private _stackTraceChangeFlag: boolean = true;
	
	private _scopeCache: Map<number, DebugProtocol.Variable[]> = new Map();
	
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
	
	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected override initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// TODO: 一些待实现的基本功能
		// the adapter implements the configurationDone request.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code use 'evaluate' when hovering over source (access to any variables and arguments that are in scope)
		response.body.supportsEvaluateForHovers = false;

		// make VS Code send cancel request
		response.body.supportsCancelRequest = false;

		// make VS Code send the breakpointLocations request (所有可能的断点位置)
		response.body.supportsBreakpointLocationsRequest = false; // TODO: 暂时不知道有什么用

		// make VS Code provide "Step in Target" functionality
		response.body.supportsStepInTargetsRequest = false;
		
		response.body.supportsRestartRequest = true;

		// the adapter defines two exceptions filters, one with support for conditions.
		response.body.supportsExceptionFilterOptions = false;
		// response.body.exceptionBreakpointFilters = [
		// 	{
		// 		filter: 'namedException',
		// 		label: "Named Exception",
		// 		description: `Break on named exceptions. Enter the exception's name as the Condition.`,
		// 		default: false,
		// 		supportsCondition: true,
		// 		conditionDescription: `Enter the exception's name`
		// 	},
		// 	{
		// 		filter: 'otherExceptions',
		// 		label: "Other Exceptions",
		// 		description: 'This is a other exception',
		// 		default: true,
		// 		supportsCondition: false
		// 	}
		// ];

		// make VS Code send exceptionInfo request
		response.body.supportsExceptionInfoRequest = false;

		// make VS Code send setVariable request
		response.body.supportsSetVariable = false;

		// make VS Code send setExpression request
		response.body.supportsSetExpression = false;

		// make VS Code able to read and write variable memory
		response.body.supportsReadMemoryRequest = false;
		response.body.supportsWriteMemoryRequest = false;

		response.body.supportSuspendDebuggee = false;
		response.body.supportTerminateDebuggee = true;
		response.body.supportsFunctionBreakpoints = false;
		response.body.supportsDelayedStackTraceLoading = false;

		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}
	
	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected override configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		this._prerequisites.resolve('configurationDone');
	}
	
	protected override async launchRequest(response: DebugProtocol.LaunchResponse, args: DdbLaunchRequestArguments) {
		// 传入用户名密码，发送消息发现未登录时自动登录
		this._remote = new Remote(args.url, args.username, args.password);
		
		// 加载资源
		this._sourcePath = normalizePathAndCasing(args.program);
		loadSource(args.program).then(async (source) => {
			this._source = source.replace(/\r\n/g, '\n');
			this._sourceLines = this._source.split('\n');
			this._prerequisites.resolve('sourceLoaded');
			
			const res = await this._remote.call('parseScriptWithDebug', [this._source]);
			// TODO: 当前仅行号，后续添加更多信息
			this._breakpointLocations = res.map((bp: /*BreakpointLocation*/ number) => {
				let resBp: BreakpointLocation = {
					// line: this.convertDebuggerLineToClient(bp.line),
					line: this.convertDebuggerLineToClient(bp),
				}
				// if (bp.column !== undefined) {
				// 	resBp.column = this.convertDebuggerColumnToClient(bp.column);
				// }
				// if (bp.endLine !== undefined) {
				// 	resBp.endLine = this.convertDebuggerLineToClient(bp.endLine);
				// }
				// if (bp.endColumn !== undefined) {
				// 	resBp.endColumn = this.convertDebuggerColumnToClient(bp.endColumn);
				// }
				return resBp;
			});
			this._prerequisites.resolve('scriptResolved');
		});
		
		// this._remote.on('pause', this.handlePause.bind(this));
		this._remote.on('BREAKPOINT', (data: PauseEventReceiveData) => this.handlePause({ reason: 'breakpoint', ...data }));
		this._remote.on('STEP', (data: PauseEventReceiveData) => this.handlePause({ reason: 'step', ...data }));
		this._remote.on('newBreakpointLocations', this.handleNewBreakpointLocations.bind(this));
		this._remote.on('END', this.handleTerminate.bind(this));
		this._remote.on('output', this.handleOutput.bind(this));
		
		await Promise.all([
			this._prerequisites.wait('configurationDone'),
			this._prerequisites.wait('breakpointsSetted'),
		]);
		
		this._remote.call('runScriptWithDebug');
	}
	
	protected override async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
		const clientLines = args.lines || [];
		const serverLines = clientLines.map(line => this.convertClientLineToDebugger(line));
		
		const requestData = serverLines.map(line => ({
			line,
			verified: false,
		}));
		await this._prerequisites.wait('scriptResolved');
		// TODO: 目前只传行号，后续补充verified, id等信息
		const res = await this._remote.call('setBreaks', [requestData.map(bp => bp.line)]) as number[];
		
		// const actualBreakpoints = res.map((bp: BreakPoint) => {
		// 	const { verified, line, id } = bp;
		// 	const resBp = new Breakpoint(verified, this.convertDebuggerLineToClient(line!)) as DebugProtocol.Breakpoint;
		// 	resBp.id = id;
		// 	return resBp;
		// });
		const actualBreakpoints = clientLines.map(line => ({
			line,
			verified: res.includes(this.convertClientLineToDebugger(line)),
		}));
		
		response.body = {
			breakpoints: actualBreakpoints,
		};
		this.sendResponse(response);
		this._prerequisites.resolve('breakpointsSetted');
	}
	
	// TODO: 暂时不知道这个request有什么用
	// protected override async breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request | undefined): Promise<void> {
	// 	await this._prerequisites.wait('scriptResolved');
	// 	args.endLine = args.endLine || args.line;
	// 	const resBpLocations = this._breakpointLocations.filter(bp => bp.line >= args.line && bp.line <= args.endLine!);
	// 	// TODO: 处理column(vsc会在什么情况下询问column?)
		
	// 	response.body = {
	// 		breakpoints: resBpLocations,
	// 	};
	// }
	
	protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [new Thread(DdbDebugSession.threadID, 'thread 1')],
		};
		this.sendResponse(response);
	}
	
	protected override async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {
		if (this._stackTraceChangeFlag) {
			const res: StackFrameRes[] = await this._remote.call('stackTrace');
			res.reverse();
			this._stackTraceCache = res.map((frame) => {
				const { stackFrameId, name, line, column } = frame;
				return new StackFrame(
					stackFrameId,
					name ?? this._sourceLines[line].trim(),
					this.createSource(this._sourcePath),
					this.convertDebuggerLineToClient(line),
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
		
		response.body = {
			stackFrames,
			totalFrames: this._stackTraceCache.length,
		};
		
		this.sendResponse(response);
	}
	
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
		表示变量时，共31位（符号位不能用），除首位，其中高14位是frameId，低16位是vid（debug mode下肯定够用叭qwq）
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
					// 根据network handle处理，有offset一定有value
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
	
	private handleNewBreakpointLocations({ locations }: NewBpLocationsEventData): void {
		this._breakpointLocations = locations.map((bp: BreakpointLocation) => {
			let resBp: BreakpointLocation = {
				line: this.convertDebuggerLineToClient(bp.line),
			}
			if (bp.column !== undefined) {
				resBp.column = this.convertDebuggerColumnToClient(bp.column);
			}
			if (bp.endLine !== undefined) {
				resBp.endLine = this.convertDebuggerLineToClient(bp.endLine);
			}
			if (bp.endColumn !== undefined) {
				resBp.endColumn = this.convertDebuggerColumnToClient(bp.endColumn);
			}
			return resBp;
		});
	}
	
	private handleTerminate({status}: EndEventData): void {
		if (status === 'FINISHED') {
			this._remote.terminate();
			this.sendEvent(new TerminatedEvent());
		} else if (status === 'RESTARTED') {
			return;
		}
	}
	
	private handleOutput({ text }: { text: string }): void {
		console.log(text);
		this.sendEvent(new OutputEvent(text));
	}
}
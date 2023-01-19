/**
 * This file implements a mock debug adapter that can be used for testing the debug extension.
 * See more details: https://github.com/Microsoft/vscode-mock-debug
 */
import {
	Breakpoint,
  DebugSession, InitializedEvent, Source, StackFrame, StoppedEvent, TerminatedEvent, Thread
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { MockRuntime } from './mockRuntime.js';
import { basename } from 'path';

/**
 * This interface describes the mock-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the mock-debug extension.
 * The interface should always match this schema.
 */
interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
  // TODO: 实现以下可选配置项
	// /** Automatically stop target after launch. If not specified, target does not stop. */
	// stopOnEntry?: boolean;
	// /** enable logging the Debug Adapter Protocol */
	// trace?: boolean;
	// /** run without debugging */
	// noDebug?: boolean;
}


export class MockDebugSession extends DebugSession {
  // we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static threadID = 1;
	
	// a Mock runtime (or debugger)
	private _runtime: MockRuntime;
	
	private _configurationDone: Promise<any>;
	private _resolveConfigurationDone: (value: any) => void;
	
	constructor() {
		super();
		
		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);
		
		this._configurationDone = new Promise(resolve => this._resolveConfigurationDone = resolve);
		
		this._runtime = new MockRuntime();
		
		this._runtime.on('stopOnBreakpoint', () => {
			this.sendEvent(new StoppedEvent('breakpoint', MockDebugSession.threadID));
		});
		this._runtime.on('stopOnStep', () => {
			this.sendEvent(new StoppedEvent('step', MockDebugSession.threadID));
		});
		this._runtime.on('terminated', () => {
			this.sendEvent(new TerminatedEvent());
		});
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

		// make VS Code support completion in REPL (补全建议)
		response.body.supportsCompletionsRequest = false;
		// response.body.completionTriggerCharacters = [ ".", "[" ];

		// make VS Code send cancel request
		response.body.supportsCancelRequest = false;

		// make VS Code send the breakpointLocations request (所有可能的断点位置)
		response.body.supportsBreakpointLocationsRequest = false;

		// make VS Code provide "Step in Target" functionality
		response.body.supportsStepInTargetsRequest = false;

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
		
		console.log('configurationDoneRequest');

		// notify the launchRequest that configuration has finished
		this._resolveConfigurationDone(true);
	}
	
	protected override async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {
		// load source
		this._runtime.start(args.program);
		// wait until configuration has finished (and configurationDoneRequest has been called)
		await this._configurationDone;

		this.sendResponse(response);
		
		this._runtime.continue();
	}
	
	protected override async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
		const clientLines = args.lines || [];

		// set and verify breakpoint locations
		const actualBreakpoints = await this._runtime.setBreakPoints(
			clientLines.map(l => this.convertClientLineToDebugger(l))	
		).map((bp) => {
			const { verified, id, line} = bp;
			const bbp = new Breakpoint(verified, this.convertDebuggerLineToClient(line)) as DebugProtocol.Breakpoint;
			bbp.id = id;
			return bbp;
		});

		// send back the actual breakpoint positions
		response.body = {
			breakpoints: actualBreakpoints
		};
		this.sendResponse(response);
	}
	
	protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [new Thread(MockDebugSession.threadID, 'thread 1')],
		};
		this.sendResponse(response);
	}
	
	protected override stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		const frames = this._runtime.stackTrace();
		response.body = {
			stackFrames: frames.map(f => new StackFrame(f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line), 0)),
			totalFrames: frames.length
		};
		this.sendResponse(response);
	}
	
	protected override continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this._runtime.continue();
		this.sendResponse(response);
	}
	
	protected override nextRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.NextArguments): void {
		this._runtime.next();
		this.sendResponse(response);
	}
	
	protected override disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): void {
		console.log(`disconnectRequest suspend: ${args.suspendDebuggee}, terminate: ${args.terminateDebuggee}`);
	}
	
	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'mock-adapter-data');
	}
}
import { DebugProtocol } from '@vscode/debugprotocol';

export type LoginResponseData = {
  status: number; // TODO
}

export type BreakpointLocation = DebugProtocol.BreakpointLocation;

export type ResolveScriptResponseData = BreakpointLocation[];

export type BreakPoint = DebugProtocol.Breakpoint;

export type SetBreakpointsResponseData = BreakPoint[];

export type StackTraceRequestArguments = Pick<DebugProtocol.StackTraceArguments, 'startFrame' | 'levels'>;

export type StackFrame = DebugProtocol.StackFrame;

export type StackTraceResponseData = {
  stackFrames: StackFrame[];
  totalFrames?: number;
}

export type Scope = DebugProtocol.Scope;

export type PauseEventReceiveData = {
  status: string;
  line: number;
}

export type PauseEventData = {
  reason: 'step' | 'breakpoint' | 'exception' | 'pause' | 'entry' | 'goto'
  | 'function breakpoint' | 'data breakpoint' | 'instruction breakpoint';
  
  description?: string;
} & PauseEventReceiveData;

export type NewBpLocationsEventData = {
  locations: BreakpointLocation[];
}

export type EndEventData = {
  status: string;
  line: number;
}

export type StackFrameRes = {
  stackFrameId: number;
  line: number;
  name?: string;
  column?: number;
}
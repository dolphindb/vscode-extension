import { DebugProtocol } from '@vscode/debugprotocol';
import { DdbObj } from 'dolphindb';

export type LoginResponseData = {
  status: number; // TODO
};

export type BreakPoint = DebugProtocol.Breakpoint;

export type SetBreakpointsResponseData = BreakPoint[];

export type StackTraceRequestArguments = Pick<
  DebugProtocol.StackTraceArguments,
  'startFrame' | 'levels'
>;

export type StackFrame = DebugProtocol.StackFrame;

export type StackTraceResponseData = {
  stackFrames: StackFrame[];
  totalFrames?: number;
};

export type Scope = DebugProtocol.Scope;

export type PauseEventReceiveData = {
  status: string;
  line: number;
};

export type PauseEventData = {
  reason:
    | 'step'
    | 'breakpoint'
    | 'exception'
    | 'pause'
    | 'entry'
    | 'goto'
    | 'function breakpoint'
    | 'data breakpoint'
    | 'instruction breakpoint';

  description?: string;
} & PauseEventReceiveData;

export type EndEventData = {
  status: string;
  line: number;
};

export type StackFrameRes = {
  stackFrameId: number;
  line: number;
  name?: string;
  column?: number;
  moduleName?: string;
};

export type VariableRes = {
  name: string;
  type: string;
  form: string;
  rows?: number;
  columns?: number;
  bytes: number;
  vid: number;
  data?: any;
  extra?: any;
  binValue?: Uint8Array;
  offset?: number;
  ddbValue?: DdbObj;
  value?: string;
};


export type ExceptionContext = {
  line: number;
  moduleName: string;
};
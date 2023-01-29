import { normalizePathAndCasing, loadSource } from '../utils.js';
import { EventEmitter } from 'events';

export interface IRuntimeBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

interface IRuntimeStackFrame {
	index: number;
	name: string;
	file: string;
	line: number;
	column?: number;
	instruction?: number;
}

/**
 * A Mock runtime with minimal debugger functionality.
 * MockRuntime is a hypothetical (aka "Mock") "execution engine with debugging support":
 * it takes a DolphinScript (*.dos) file and "executes" it by "running" through the text lines.
 * When implementing our own debugger extension for VS Code, we don't need this class because
 * we can rely on our existing debugger or runtime.
 */
export class MockRuntime extends EventEmitter {
  // the initial (and one and only) file we are 'debugging'
	private _sourceFile: string = '';
	private breakpointId: number = 0;
	private lastHitedLine = -1;
	public get sourceFile() {
		return this._sourceFile;
	}
  
  // the contents (= lines) of the one and only file
	private sourceLines: string[] = [];
	private sourceLoaded: Promise<void>;
	private resolveSourceLoaded: (value: void) => void;

  // This is the next line that will be 'executed'
	private _currentLine = 0;
	private get currentLine() {
		return this._currentLine;
	}
	private set currentLine(x) {
		this._currentLine = x;
	}
  
  // Array of breakpoints
	private breakPoints = new Array<IRuntimeBreakpoint>();
  
  constructor() {
		super();
		this.sourceLoaded = new Promise(resolve => this.resolveSourceLoaded = resolve);
		console.log('MockRuntime created');
	}
  
  /**
	 * Start executing the given program.
	 */
	public async start(program: string): Promise<void> {
		this._sourceFile = normalizePathAndCasing(program);
		this.sourceLines = (await loadSource(program)).split(/\r?\n/);
		this.resolveSourceLoaded();
	}
	
	/**
	 * Continue execution to the next breakPoint/end.
	 */
	public continue() {
		while (!this.executeLine(this.currentLine)) {
			if (this.updateCurrentLine()) {
				break;
			}
		}
	}
	
	public next() {
		while (!this.updateCurrentLine()) {
			if (this.getLine(this.currentLine).length) {
				this.sendEvent('stopOnStep');
				break;
			}
		}
	}
	
	private updateCurrentLine() {
		if (this.currentLine < this.sourceLines.length - 1) {
			this.currentLine++;
			return false;
		} else {
			this.sendEvent('terminated');
			return true;
		}
	}
	
	private executeLine(currentLine: number): boolean {
		const hitBreakPoint = this.breakPoints.find(bp => bp.line === currentLine && bp.verified);
		if (hitBreakPoint && hitBreakPoint.line != this.lastHitedLine) {
			this.lastHitedLine = hitBreakPoint.line;
			this.sendEvent('stopOnBreakpoint');
			return true;
		} else {
			return false;
		}
	}
	
	public stackTrace(): IRuntimeStackFrame[] {
		return [{
			index: 0,
			name: this.getLine(),
			file: this.sourceFile,
			line: this.currentLine,
		}];
	}
  
  private sendEvent(event: string, ... args: any[]): void {
		setTimeout(() => {
			this.emit(event, ...args);
		}, 0);
	}
	
  public async setBreakPoints(lines: number[]) {
		const bps = lines.map<IRuntimeBreakpoint>((line) => ({
			verified: false,
			id: this.breakpointId++,
			line,
		}));
		this.breakPoints = bps;
		await this.verifyBreakpoints();
		return bps;
	}
	
	private getLine(line?: number): string {
		return this.sourceLines[line === undefined ? this.currentLine : line].trim();
	}
	
	private async verifyBreakpoints() {
		await this.sourceLoaded;
		this.breakPoints.forEach(bp => {
			if (!bp.verified && bp.line < this.sourceLines.length) {
				const srcLine = this.getLine(bp.line);

				// if a line is empty we don't allow to set a breakpoint but move the breakpoint down
				if (srcLine.length === 0) {
					bp.line++;
				}

				if (bp.line < this.sourceLines.length) {
					bp.verified = true;
				}
			}
		});
	}
}
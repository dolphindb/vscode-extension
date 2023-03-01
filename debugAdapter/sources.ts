import { Remote } from "./network.js";
import { Source } from "@vscode/debugadapter";

type SourceRef = {
  source: Source;
  content?: string;
  lines?: string[];
};

export class Sources {
  private _sourceRefs: Map<number, SourceRef> = new Map();
  
  private _remote: Remote;
  
  private _refId = 0;
  get nextRefId(): number {
    return this._refId++;
  }
  
  constructor(remote: Remote) {
    this._remote = remote;
  }
  
  public get(ref: number): SourceRef {
    const source = this._sourceRefs.get(ref);
    if (!source) {
      throw new Error(`Source not found for ref: ${ref}`);
    }
    return source;
  }
  
  public getSource(ref: number): Source {
    return this.get(ref).source;
  }
  
  public async getContent(ref: number): Promise<string> {
    const source = this.get(ref);
    
    if (source.content) {
      return source.content;
    } else {
      // const res = await this._remote.call("source");
      // source.content = res.data;
      // return source.content;
      return `
module AnotherModule

def myAdd(a, b){
  c = a+b
  return c
}
`;
    }
  }
  
  public async getLines(ref: number): Promise<string[]> {
    const source = this.get(ref);
    
    if (source.lines) {
      return source.lines;
    } else {
      const content = await this.getContent(ref);
      source.lines = content.split("\n");
      return source.lines;
    }
  }
  
  public add(source: Omit<Source, 'sourceReference'>): number {
    const ref = this.nextRefId;
    this._sourceRefs.set(ref, { source: {
      ...source,
      sourceReference: ref,
    }});
    return ref;
  }
  
  public addContent(ref: number, content: string) {
    const source = this.get(ref);
    source.content = content;
  }
}
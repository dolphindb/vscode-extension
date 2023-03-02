import { Remote } from "./network.js";
import { Source } from "@vscode/debugadapter";

type SourceContents = {
  content?: string;
  lines?: string[];
};

export class Sources {
  // vscode debug adapter 使用ref来标识资源，要求是数字
  private _sources: Map<number, Source> = new Map();
  /** 资源内容缓存 */
  private _sourceCache: WeakMap<Source, SourceContents> = new WeakMap();
  /** 名字到ref的映射 */
  private _sourceRefMap: Map<string, number> = new Map();
  
  private _remote: Remote;
  
  private _refId = 0;
  get nextRefId(): number {
    return this._refId++;
  }
  
  constructor(remote: Remote) {
    this._remote = remote;
  }
  
  public getSource(ref: number | string): Source {
    if (typeof ref === 'string') {
      const srcRef = this._sourceRefMap.get(ref);
      if (!srcRef) {
        throw new Error(`source ${ref} not found`);
      }
      ref = srcRef;
    }
    const source = this._sources.get(ref);
    if (!source) {
      throw new Error(`source ${ref} not found`);
    }
    return source;
  }
  
  private getContents(source: Source): SourceContents {
    const contents = this._sourceCache.get(source);
    if (!contents) {
      throw new Error(`source contents not found: ${source.name}`);
    }
    return contents;
  }
  
  public async getContent(ref: number): Promise<string> {
    const contents = this.getContents(this.getSource(ref));
    
    if (contents.content) {
      return contents.content;
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
    const contents = this.getContents(this.getSource(ref));
    
    if (contents.lines) {
      return contents.lines;
    } else {
      const content = await this.getContent(ref);
      contents.lines = content.split("\n");
      return contents.lines;
    }
  }
  
  public add(source: Omit<Source, 'sourceReference'>): number {
    const ref = this.nextRefId;
    this._sourceRefMap.set(source.name, ref);
    this._sources.set(ref, {
      ...source,
      sourceReference: ref,
    });
    this._sourceCache.set(this._sources.get(ref)!, {});
    return ref;
  }
  
  public addContent(ref: number, content: string) {
    const source = this.getSource(ref);
    this._sourceCache.set(source, {
      content,
    });
  }
}
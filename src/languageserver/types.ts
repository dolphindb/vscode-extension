import { type Position, type Range } from 'vscode-languageserver/node'

// symbols
export enum SymbolType {
    Function,
    Table,
    FieldName,
    Database,
    Variable,
    Param,
    File
}

export interface IFunctionMetadata {
    argnames: string[]
    scope: [Position, Position]
    comments: string
    top_level?: boolean
}

export interface IVariableMetadata {
    scope: [Position, Position]
    comments: string
}

export interface IParamMetadata {
    scope: [Position, Position]
    funcname: string
}

// 通过映射关系为每个 SymbolType 提供对应的元数据类型
export type SymbolMetadataMap = {
    [SymbolType.Function]: IFunctionMetadata
    [SymbolType.Variable]: IVariableMetadata
    [SymbolType.Param]: IParamMetadata
}

export interface ISymbol<T extends SymbolType = SymbolType> {
    name: string
    type: T
    position: Position
    range?: Range
    filePath: string
    metadata?: T extends keyof SymbolMetadataMap ? SymbolMetadataMap[T] : never
}

export interface DdbModule {
    filePath: string
    moduleName: string
}

export interface DdbUri {
    external: string
    path: string
    scheme: 'file'
} 

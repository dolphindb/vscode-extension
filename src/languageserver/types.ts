import type { ValueOf } from 'xshell'

import type { Position, Range } from 'vscode-languageserver/node'

// symbols
export const SymbolType = {
    Function: 0,
    Table: 1,
    FieldName: 2,
    Database: 3,
    Variable: 4,
    Param: 5,
    File: 6,
} as const

export interface IFunctionMetadata {
    argnames: string[]
    scope: [Position, Position]
    functionBodyScope: [Position, Position]
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

export interface ISymbol<T extends ValueOf<typeof SymbolType> = ValueOf<typeof SymbolType>> {
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

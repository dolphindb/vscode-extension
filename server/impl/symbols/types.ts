import { type Position, type Range } from 'vscode-languageserver/node'

// symbols
export enum SymbolType {
    Function,
    Table,
    FieldName,
    Database,
    Variable,
    Param
}

export interface IFunctionMetadata {
    argnames: string[]
    scope: [Position, Position]
    comments: string
}

export interface IVariableMetadata {
    scope: [Position, Position]
    comments: string
}

export interface ISymbol {
    name: string
    type: SymbolType
    position: Position
    range?: Range
    filePath: string
    metadata?: IFunctionMetadata | IVariableMetadata
}

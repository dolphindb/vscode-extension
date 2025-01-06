import { type TextDocument } from 'vscode-languageserver-textdocument'

import { type ISymbol, SymbolType } from './types'
import { getFileModule, getFunctionSymbols, getVariableSymbols } from './impl'


interface IFileSymbols {
    module?: string
    use: string[]
    symbols: ISymbol[]
}

export class SymbolService {
    symbols = new Map<string, IFileSymbols>()
    
    getSymbols (filePath: string): ISymbol[] {
        return this.symbols.get(filePath)?.symbols || [ ]
    }
    
    buildSymbolByDocument (document: TextDocument) {
        const filePath = document.uri
        const text = document.getText()
        const symbols: ISymbol[] = [
            ...getFunctionSymbols(text, filePath),
            ...getVariableSymbols(text, filePath),
        ]
        
        this.symbols.set(filePath, {
            symbols,
            use: [ ],
            module: getFileModule(text)
        })
    }
    
    onCloseDocument (document: TextDocument) {
        this.symbols.delete(document.uri)
    }
    
}

export const symbolService = new SymbolService()

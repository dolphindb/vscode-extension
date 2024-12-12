import { type TextDocument } from 'vscode-languageserver-textdocument'

import { type ISymbol, SymbolType } from './types'
import { getFunctionSymbols, getVariableSymbols } from './impl'




export class SymbolService {
    symbols = new Map<string, ISymbol[]>()
    
    getSymbols (filePath: string): ISymbol[] {
        return this.symbols.get(filePath) || [ ]
    }
    
    buildSymbolByDocument (document: TextDocument) {
        const filePath = document.uri
        const text = document.getText()
        const symbols: ISymbol[] = [
            ...getFunctionSymbols(text, filePath),
            ...getVariableSymbols(text, filePath),
        ]
        
        this.symbols.set(filePath, symbols)
    }
    
    onCloseDocument (document: TextDocument) {
        this.symbols.delete(document.uri)
    }
    
}

export const symbolService = new SymbolService()

import { type TextDocument } from 'vscode-languageserver-textdocument'
 
import { type ISymbol, SymbolType } from './types'
import { getFunctionSymbols } from './functionImpl'




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
        ]
        
        this.symbols.set(filePath, symbols)
    }
    
}

export const symbolService = new SymbolService()

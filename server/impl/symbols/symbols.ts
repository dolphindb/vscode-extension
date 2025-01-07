import * as fsp from 'fs/promises'

import { type TextDocument } from 'vscode-languageserver-textdocument'


import { type DdbModule } from '../modules'

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
    
    buildSymbolsByFile (text: string, filePath: string): ISymbol[] {
        return [
            ...getFunctionSymbols(text, filePath),
            ...getVariableSymbols(text, filePath),
        ]
    }
    
    buildSymbolByDocument (document: TextDocument) {
        const filePath = document.uri
        const text = document.getText()
        const symbols = this.buildSymbolsByFile(text, filePath)
        
        this.symbols.set(filePath, {
            symbols,
            use: [ ],
            module: getFileModule(text)
        })
    }
    
    async buildSymbolByModule (module: DdbModule) {
        if (!module.moduleName)
            return
        const uri = `file:///${module.path}`
        const data = await fsp.readFile(module.path, 'utf-8')
        const text = data.toString()
        const symbols = this.buildSymbolsByFile(text, uri)
        console.log(module.moduleName)
        this.symbols.set(uri, {
            symbols,
            use: [ ],
            module: module.moduleName
        })
    }
    
    onCloseDocument (document: TextDocument) {
        this.symbols.delete(document.uri)
    }
    
}

export const symbolService = new SymbolService()

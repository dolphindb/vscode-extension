
import { type TextDocument } from 'vscode-languageserver-textdocument'

import { readFileByPath } from './utils.ts'

import { type DdbModule, type ISymbol, SymbolType } from './types.ts'

import { getFileModule, getFileUsedModule, getFunctionSymbols, getVariableSymbols } from './symbols_impl.ts'


interface IFileSymbols {
    module?: string
    use: string[]
    symbols: ISymbol[]
}

export class SymbolService {
    // 标识符可以是 uri 或 filePath，textDocument 的时候用 uri，没有办法获取 uri 的时候用 filePath
    symbols = new Map<string, IFileSymbols>()
    
    getSymbols (filePath: string): ISymbol[] {
        return this.symbols.get(filePath)?.symbols || [ ]
    }
    
    getUsedModules (filePath: string): string[] {
        return this.symbols.get(filePath)?.use || [ ]
    }
    
    buildSymbolsByFile (raw_text: string, filePath: string): ISymbol[] {
        // 转换 CRLF 到 LF
        const text = raw_text.replaceAll('\r\n', '\n')
        return [
            ...getFunctionSymbols(text, filePath),
            ...getVariableSymbols(text, filePath),
        ]
    }
    
    buildSymbolByDocument (document: TextDocument) {
        const filePath = document.uri
        const text = document.getText()
        const symbols = this.buildSymbolsByFile(text, filePath)
        const use = getFileUsedModule(text)
        
        this.symbols.set(filePath, {
            symbols,
            use,
            module: getFileModule(text)
        })
    }
    
    async buildSymbolByModule (module: DdbModule) {
        if (!module.moduleName)
            return
        const text = await readFileByPath(module.filePath)
        const symbols = this.buildSymbolsByFile(text, module.filePath)
        this.symbols.set(module.filePath, {
            symbols,
            use: [ ],
            module: module.moduleName
        })
    }
    
    public deleteSymbolByUri (uri: string) {
        this.symbols.delete(uri)
    }
    
    onCloseDocument (document: TextDocument) {
        this.symbols.delete(document.uri)
    }
    
}

export const symbolService = new SymbolService()

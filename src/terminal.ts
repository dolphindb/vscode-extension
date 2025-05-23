import {
    window,
    commands,
    
    EventEmitter,
    
    type Terminal, type TerminalDimensions, type TerminalLink
} from 'vscode'


import { language, t } from '../i18n/index.ts'


type DdbTerminal = Terminal & { printer: EventEmitter<string> }


export let terminal: DdbTerminal

export async function create_terminal () {
    let printer = new EventEmitter<string>()
    
    await new Promise<void>(resolve => {
        terminal = window.createTerminal({
            name: 'DolphinDB',
            
            pty: {
                open (init_dimensions: TerminalDimensions | undefined) {
                    printer.fire(`${t('DolphinDB 终端')}\r\n`)
                    resolve()
                },
                
                close () {
                    console.log(t('dolphindb 终端被关闭'))
                    terminal.dispose()
                    printer.dispose()
                    terminal = null
                },
                
                onDidWrite: printer.event,
            },
        }) as DdbTerminal
        
        terminal.printer = printer
        
        terminal.show(true)
    })
}

export function register_terminal_link_provider () {
    window.registerTerminalLinkProvider({
        provideTerminalLinks (context, token) {
            const { line } = context
            if (line.includes('RefId:')) {
                let links: TerminalLink[] = [ ]
                for (const match of line.matchAll(/RefId: (\w+)/g)) {
                    const [str, id] = match
                    
                    links.push({
                        startIndex: match.index,
                        length: str.length,
                        tooltip: language === 'en'
                            ? `https://docs.dolphindb.com/en/Maintenance/ErrorCodeReference/${id}.html`
                            : `https://docs.dolphindb.cn/zh/error_codes/${id}.html`
                    })
                }
                return links
            } else
                return [ ]
        },
        
        handleTerminalLink (link) {
            commands.executeCommand('vscode.open', link.tooltip)
        },
    })
}

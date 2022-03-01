import util from 'util'

import {
    type ExtensionContext,
    languages,
    Hover,
    SignatureHelp,
    CompletionItemKind,
    CompletionItem,
    SignatureInformation,
    ParameterInformation,
    MarkdownString,
    type TextDocument,
    Position,
    Range,
    type Terminal,
    workspace,
    EventEmitter,
    type TerminalDimensions,
    commands,
    window,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    type Event,
} from 'vscode'


import { DDB } from 'dolphindb'
import WebSocket from 'ws'
import { inspect, chalk } from 'xshell'


import { t } from './i18n'
import { ddb_constants, ddb_keywords } from './dolphindb.language'

import docs from './docs.json'

chalk.level = 2


const ddb_constants_lower = ddb_constants.map(constant => 
    constant.toLowerCase())

const funcs = Object.keys(docs)
const funcs_lower = funcs.map(func => 
    func.toLowerCase())


let ddbext = {
    node: 'd',
    ddb: null as DDB,
    shell: null as Terminal,
    emitter: null as EventEmitter<string>,
}


function set_inspect_options () {
    util.inspect.defaultOptions.maxArrayLength  = 40
    util.inspect.defaultOptions.maxStringLength = 10000
    util.inspect.defaultOptions.breakLength     = 230
    util.inspect.defaultOptions.colors          = true
    util.inspect.defaultOptions.compact         = false
    util.inspect.defaultOptions.getters         = true
    util.inspect.defaultOptions.depth           = 2
    util.inspect.defaultOptions.sorted          = false
    util.inspect.defaultOptions.showProxy       = true
    
    util.inspect.styles.number  = 'green'
    util.inspect.styles.string  = 'cyan'
    util.inspect.styles.boolean = 'blue'
    util.inspect.styles.date    = 'magenta'
    util.inspect.styles.special = 'white'
}


set_inspect_options()


class DdbConnectionsProvider implements TreeDataProvider<TreeItem> {
    private emitter: EventEmitter<TreeItem | undefined | void> = new EventEmitter<TreeItem | undefined | void>()
    
    onDidChangeTreeData: Event<void | TreeItem> = this.emitter.event
    
    connections = [
        new DdbConnection('d', 'ws://127.0.0.1:8848'),
        new DdbConnection('c0', 'ws://127.0.0.1:8850'),
        new DdbConnection('d0', 'ws://127.0.0.1:8870'),
        new DdbConnection('d1', 'ws://127.0.0.1:8871'),
    ]
    
    refresh () {
        this.emitter.fire()
    }
    
    getTreeItem (element: TreeItem): TreeItem | Thenable<TreeItem> {
        console.log(element.label)
        return element
    }
    
    getChildren (element?: TreeItem) {
        if (element)
            return [ ]
        
        for (let conn of this.connections)
            conn.iconPath = new ThemeIcon(
                conn.name === ddbext.node ?
                    'pass-filled'
                :
                    'circle-large-outline'
            )
        
        return this.connections
    }
}


class DdbConnection extends TreeItem {
    name: string
    ws_url: string
    
    constructor (name: string, ws_url: string) {
        super(`${name} (${ws_url})`, TreeItemCollapsibleState.None)
        this.name = name
        this.ws_url = ws_url
        this.command = {
            command: 'set_ddb_connection',
            title: 'set_ddb_connection',
            arguments: [name],
        }
    }
}


let ddb_connections_provider = new DdbConnectionsProvider()


export function activate (ctx: ExtensionContext) {
    for (const func of ext_commands)
        ctx.subscriptions.push(
            commands.registerCommand(`dolphindb.${func.name}`, func)
        )
    
    window.registerTreeDataProvider('ddb.connections', ddb_connections_provider)
    
    
    // 函数补全
    ctx.subscriptions.push(
        languages.registerCompletionItemProvider('dolphindb', {
            provideCompletionItems (doc, pos, canceller, ctx) {
                if (canceller.isCancellationRequested)
                    return
                
                const keyword = doc.getText(
                    doc.getWordRangeAtPosition(pos)
                )
                
                let fns: string[]
                let constants: string[]
                
                if (keyword.length === 1) {
                    const c = keyword[0].toLowerCase()
                    fns = funcs.filter((func, i) => 
                        funcs_lower[i].startsWith(c)
                    )
                    constants = ddb_constants.filter((constant, i) => 
                        ddb_constants_lower[i].startsWith(c)
                    )
                } else {
                    const keyword_lower = keyword.toLowerCase()
                    
                    fns = funcs.filter((func, i) => {
                        const func_lower = funcs_lower[i]
                        let j = 0
                        for (const c of keyword_lower) {
                            j = func_lower.indexOf(c, j) + 1
                            if (!j)  // 找不到则 j === 0
                                return false
                        }
                        
                        return true
                    })
                    
                    constants = ddb_constants.filter((constant, i) => {
                        const constant_lower = ddb_constants_lower[i]
                        let j = 0
                        for (const c of keyword_lower) {
                            j = constant_lower.indexOf(c, j) + 1
                            if (!j)  // 找不到则 j === 0
                                return false
                        }
                        
                        return true
                    })
                }
                
                const completions = [
                    ...ddb_keywords.filter(kw => 
                        kw.startsWith(keyword)
                    ).map(kw => ({
                        label: kw,
                        kind: CompletionItemKind.Keyword
                    })),
                    ... constants.map(constant => ({
                        label: constant,
                        kind: CompletionItemKind.Constant
                    })),
                    ...fns.map(fn => ({
                        label: fn,
                        kind: CompletionItemKind.Function,
                    }) as CompletionItem),
                ]
                
                return completions.length ? completions : null
            },
            
            resolveCompletionItem (item, canceller) {
                if (canceller.isCancellationRequested)
                    return
                
                item.documentation = get_func_md(item.label as string)
                
                return item
            }
        })
    )
    
    
    // 悬浮提示
    ctx.subscriptions.push(
        languages.registerHoverProvider('dolphindb', {
            provideHover (doc, pos, canceller) {
                if (canceller.isCancellationRequested)
                    return
                
                const md = get_func_md(
                    doc.getText(
                        doc.getWordRangeAtPosition(pos)
                    )
                )
                
                if (!md)
                    return
                
                return new Hover(md)
            }
        })
    )
    
    
    // 函数签名
    ctx.subscriptions.push(
        languages.registerSignatureHelpProvider('dolphindb', {
            provideSignatureHelp (doc, pos, canceller, ctx) {
                if (canceller.isCancellationRequested)
                    return
                
                const { funcName, paramSearchPos } = find_func_start(doc, pos)
                if (paramSearchPos === -1) 
                    return
                
                const { activeIndex } = find_active_param(doc, pos, paramSearchPos)
                if (activeIndex === -1) 
                    return
                
                const extractedSigAndParam = get_signature_and_params(funcName)
                if (!extractedSigAndParam)
                    return
                
                const { signature, params } = extractedSigAndParam
                let sig = new SignatureInformation(
                    signature,
                    get_func_md(funcName)
                )
                
                for (let param of params)
                    sig.parameters.push(
                        new ParameterInformation(param)
                    )
                
                let help = new SignatureHelp()
                help.signatures.push(sig)
                help.activeParameter = activeIndex > params.length - 1 ? params.length - 1 : activeIndex
                
                return help
            }
        }, '(', ',')
    )
    
    
    console.log(
        t('DolphinDB 插件已初始化')
    )
}


const ext_commands = [
    async function execute () {
        const [{ url, name }] = workspace.getConfiguration('dolphindb').get<{ url: string, name: string }[]>('servers')
        
        if (!ddbext.ddb || ddbext.ddb.url !== url || ddbext.ddb.websocket.readyState !== WebSocket.OPEN) {
            ddbext.ddb?.disconnect()
            let ddb = ddbext.ddb = new DDB(url)
            
            ddb.printer = message => {
                ddbext.emitter.fire(message + '\r\n')
            }
            
            await ddb.connect()
            
            let emitter = ddbext.emitter = new EventEmitter<string>()
            await new Promise<void>(resolve => {
                ddbext.shell = window.createTerminal({
                    name: 'DolphinDB',
                    
                    pty: {
                        open (init_dimensions: TerminalDimensions | undefined) {
                            emitter.fire(
                                'DolphinDB Shell\r\n'
                            )
                            resolve()
                        },
                        
                        close () {
                            ddbext.ddb.disconnect()
                            emitter.dispose()
                        },
                        
                        onDidWrite: emitter.event,
                    },
                })
                
                ddbext.shell.show(true)
            })
        }
        
        try {
            const obj = await ddbext.ddb.eval(
                get_text('selection or line')
            )
            
            ddbext.emitter.fire(
                inspect(obj).replaceAll('\n', '\r\n') + '\r\n'
            )
        } catch (error) {
            ddbext.emitter.fire(
                error.message.red + '\r\n'
            )
        }
    },
    
    async function set_ddb_connection (node: string) {
        console.log('set_ddb_connection:', node)
        ddbext.node = node
        ddb_connections_provider.refresh()
    },
]


/** 获取选择区域的文本，若选择为空，则根据 selector 确定 (当前 | 全部文本 | 空) */
function get_text (selector: 
    'all' | 
    'line' | 
    'word' |
    'selection' | 
    'selection or line' |
    'selection or all'  |
    'selection before' | 
    'selection to text start' | 
    'selection after'
) {
    const editor    = window.activeTextEditor
    const document  = editor.document
    const selection = editor.selection
    
    const text_selection = document.getText(selection)
    
    if (selector === 'selection')
        return text_selection
        
    const text_all = document.getText()
    
    if (selector === 'all')
        return text_all
        
    const text_line = document.lineAt(selection.active.line).text
        
    if (selector === 'line')
        return text_line
    
    if (selector === 'word')
        return document.getText(
            document.getWordRangeAtPosition(selection.active)
        )
    
    if (selector === 'selection or all')
        return text_selection || text_all
    
    if (selector === 'selection or line')
        return text_selection || text_line
        
    
    
    const start = selection.start
    const end   = selection.end
    
    const line = document.lineAt(start.line)
    
    const line_start = new Position(start.line, 0)
    
    if (selector === 'selection before')
        return document.getText(
            new Range(line_start, start)
        )
    
    
    const line_end   = new Position(start.line, line.text.length)
    
    if (selector === 'selection after')
        return document.getText(
            new Range(end, line_end)
        )
    
    
    const line_text_start = new Position(start.line, line.firstNonWhitespaceCharacterIndex)
    if (selector === 'selection to text start')
        return document.getText(
            new Range(line_text_start, start)
        )
}



/** 最大搜索行数 */
const MAX_LINE_TO_WATCH = 30 as const

// 栈token匹配表
const TOKEN_MAP = {
    ')': '(',
    '}': '{',
    ']': '['
}

function get_func_md (keyword: string) {
    const func_doc = docs[keyword]
    
    if (!func_doc)
        return
    
    let md = new MarkdownString(
        // 标题
        `#### ${func_doc.title}\n` +
        
        // 链接
        `https://www.dolphindb.cn/cn/help/FunctionsandCommands/${ func_doc.type === 'command' ? 'CommandsReferences' : 'FunctionReferences' }/${func_doc.title[0]}/${func_doc.title}.html\n`
    )
    
    md.isTrusted = true
    
    for (const para of func_doc.children) {
        // 加入段
        md.appendMarkdown(`#### ${para.title}\n`)
        
        for (const x of para.children)
            if (x.type === 'text' && para.type !== 'example') 
                // 对于参数段落，以 markdown 插入
                md.appendMarkdown(
                    x.value.join_lines()
                )
            else
                // x.type === 'code' || para.type === 'example'
                md.appendCodeblock(
                    x.value.join_lines(),
                    (x.language === 'console' ? 'dolphindb' : x.language)
                )
        
        md.appendMarkdown('\n')
    }
    
    return md
}


/** 利用当前光标找出函数参数开始位置及函数名, 若找不到返回 -1 */
function find_func_start (
    document: TextDocument,
    position: Position
): {
    funcName: string
    paramSearchPos: number
} {
    const func_name_regex = /[a-z|A-Z|0-9|\!|_]/
    
    const text = document.getText(
        new Range(
            Math.max(position.line - MAX_LINE_TO_WATCH, 0), 0,
            position.line, position.character
        )
    )
    
    let stackDepth = 0
    let paramSearchPos = -1
    for (let i = text.length; i >= 0; i--) {
        let char = text.charAt(i)
        // 遇到右括号，入栈，增加一层括号语境深度
        if (char === ')') {
            stackDepth++
            continue
        }
        // 遇到左括号，出栈，退出一层括号语境深度
        else if (char === '(') {
            stackDepth--
            continue
        }
        
        // 栈深度小于0，且遇到合法函数名字符，跳出括号语境，搜索结束：参数搜索开始位置
        if (func_name_regex.test(char) && stackDepth < 0) {
            paramSearchPos = i
            break
        }
    }
    
    // 找不到参数搜索开始位置，返回null
    if (paramSearchPos === -1) 
        return { paramSearchPos: -1, funcName: '' }
    
    
    // 往前找函数名
    let funcNameEnd = -1
    let funcNameStart = 0
    for (let i = paramSearchPos; i >= 0; i--) {
        let char = text.charAt(i)
        // 空字符跳过
        if (funcNameEnd === -1 && char === ' ') 
            continue
        
        // 合法函数名字字符，继续往前找
        if (func_name_regex.test(char)) {
            // 标记函数名字末尾位置
            if (funcNameEnd === -1) 
                funcNameEnd = i
            
            continue
        }
        // 不合法函数名字符，标记函数名字开头位置
        funcNameStart = i + 1
        break
    }
    // 找不到函数名
    if (funcNameEnd === -1) 
        return { paramSearchPos: -1, funcName: '' }
    
    
    const funcName = text.slice(funcNameStart, funcNameEnd + 1)
    
    return { paramSearchPos: paramSearchPos + 1, funcName }
}


/** 根据函数参数开始位置分析参数语义，提取出当前参数索引  */
function find_active_param (
    document: TextDocument,
    position: Position,
    start: number
): {
    activeIndex: number
} {
    const text = document.getText(
        new Range(Math.max(position.line - MAX_LINE_TO_WATCH, 0), 0, position.line, position.character)
    )
    let activeIndex = 0
    let stack = []
    // 分隔符，此处为逗号
    const seperator = ','
    let commaCount = 0
    
    // 搜索
    for (let i = start; i < text.length; i++) {
        const char = text.charAt(i)
        // 空字符跳过
        if (/\s/.test(char)) 
            continue
        
        
        // 字符串内除引号全部忽略
        if (stack[stack.length - 1] === '"' || stack[stack.length - 1] === "'") {
            // 遇到相同引号，出栈
            if ((stack[stack.length - 1] === '"' && char === '"') || (stack[stack.length - 1] === "'" && char === "'")) 
                stack.pop()
            continue
        }
        
        // 开括号入栈
        if (Object.values(TOKEN_MAP).includes(char) || char === '"' || char === "'") {
            stack.push(char)
            continue
        }
        // 括号匹配，出栈，括号不匹配，返回null
        else if (Object.keys(TOKEN_MAP).includes(char)) 
            if (stack[stack.length - 1] === TOKEN_MAP[char]) {
                stack.pop()
                continue
            } else {
                // 括号不匹配，返回-1
                activeIndex = -1
                break
            }
        
        
        // 栈深度为1 且为左小括号：当前语境
        if (stack.length === 1 && stack[0] === '(') 
            // 遇到逗号，若之前有合法参数，计入逗号
            if (char === seperator)
                commaCount++
        
        // 根据逗号数量判断高亮参数索引值
        activeIndex = commaCount
    }
    
    return { activeIndex }
}


/** 根据函数名提取出相应的文件对象，提取出函数signature和参数 */
function get_signature_and_params (func_name: string): {
    signature: string
    params: string[]
} | null {
    const para = docs[func_name]?.children.filter(para => para.type === 'grammer')[0]
    if (!para) 
        return null
    
    // 找出语法内容块的第一个非空行
    const funcLine = para.children[0].value.filter(line => line.trim() !== '')[0].trim()
    const matched = funcLine.match(/[a-zA-z0-9\!]+\((.*)\)/)
    if (!matched) 
        return null
    
    const signature = matched[0]
    const params = matched[1].split(',').map(s => s.trim())
    return { signature, params }
}


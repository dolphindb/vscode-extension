import zlib from 'zlib'
import {
    createServer as http_create_server,
    type IncomingMessage,
} from 'http'
import type { Duplex } from 'stream'

import path from 'upath'

import {
    window,
    
    workspace,
    
    commands,
    
    languages,
    
    extensions,
    ExtensionKind,
    
    ThemeIcon,
    
    MarkdownString,
    
    type TextDocument,
    Range,
    type Position,
    
    EventEmitter,
    type Event,
    
    type ExtensionContext,
    
    type Terminal,
    type TerminalDimensions,
    
    Hover,
    
    SignatureInformation,
    SignatureHelp,
    ParameterInformation,
    
    CompletionItem,
    CompletionItemKind,
    
    type TreeView,
    TreeItem,
    TreeItemCollapsibleState,
    type TreeDataProvider,
    type ProviderResult,
    
    type CancellationToken,
    
    type WebviewView,
} from 'vscode'

import dayjs from 'dayjs'
import { WebSocket, WebSocketServer } from 'ws'
import {
    default as Koa,
    type Context,
} from 'koa'

// @ts-ignore
import KoaCors from '@koa/cors'
import KoaCompress from 'koa-compress'
import { userAgent as KoaUserAgent } from 'koa-useragent'
import open_url from 'open'

import {
    type Message,
    Remote,
    inspect,
    set_inspect_options,
    delay,
    delta2str,
    fread,
} from 'xshell'
import { Server } from 'xshell/server.js'
import {
    DDB,
    DdbForm,
    DdbObj,
    DdbType,
    DdbFunctionType,
    format,
    type DdbMessage,
    type DdbMessageListener,
    type DdbFunctionDefValue,
} from 'dolphindb'

import docs_zh from 'dolphindb/docs.zh.json'
import docs_en from 'dolphindb/docs.en.json'
import { constants, keywords } from 'dolphindb/language.js'

import { language, t } from './i18n/index.js'
import { get_text } from './utils.js'


const fpd_ext = path.normalizeTrim(
    extensions.getExtension('dolphindb.dolphindb-vscode').extensionPath
) + '/'


set_inspect_options()

const docs = language === 'zh' ? docs_zh : docs_en

const constants_lower = constants.map(constant => 
    constant.toLowerCase())

const funcs = Object.keys(docs)
const funcs_lower = funcs.map(func => 
    func.toLowerCase())

const icon_empty = `${fpd_ext}icons/radio.empty.svg`
const icon_checked = `${fpd_ext}icons/radio.checked.svg`


let server: DdbServer

let explorer: DdbExplorer


type DdbTerminal = Terminal & { printer: EventEmitter<string> }

let term: DdbTerminal


/** 基于 vscode webview 相关的消息函数 postMessage, onDidReceiveMessage, window.addEventListener('message', ...) 实现的 rpc  */
let dataview = {
    view: null as WebviewView,
    
    id: 0,
    
    /** 调用方发起的 rpc 对应响应的 message 处理器 */
    handlers: [ ] as ((message: Message) => any)[],
    
    print: false,
    
    subscribers_repl: [ ] as DdbMessageListener[],
    
    subscribers_inspection: [ ] as ((ddbvar: Partial<DdbVar>, open: boolean, buffer?: Uint8Array, le?: boolean) => any)[],
    
    
    /** 被调方的 message 处理器 */
    funcs: {
        async subscribe_repl ({ id }, view) {
            console.log('webview subscribed to repl')
            
            function subscriber ({ type, data }: DdbMessage) {
                dataview.send(
                    {
                        id,
                        args: (() => {
                            switch (type) {
                                case 'print':
                                case 'error':
                                    return [type, data]
                                
                                case 'object':
                                    return [type, data.pack(), data.le]
                            }
                        })()
                    }
                )
            }
            
            dataview.subscribers_repl.push(subscriber)
            
            view.onDidDispose(() => {
                console.log('webview unsubscribed repl due to dataview closed')
                dataview.subscribers_repl = dataview.subscribers_repl.filter(s => 
                    s !== subscriber)
            })
        },
        
        async subscribe_inspection ({ id }, view) {
            console.log('subscribed to inspection')
            
            function subscriber (ddbvar: Partial<DdbVar>, open: boolean, buffer?: Uint8Array, le?: boolean) {
                dataview.send(
                    {
                        id,
                        args: [ddbvar, open, buffer, le]
                    }
                )
            }
            
            dataview.subscribers_inspection.push(subscriber)
            
            view.onDidDispose(() => {
                console.log('unsubscribed inspection due to dataview closed')
                dataview.subscribers_inspection = dataview.subscribers_inspection.filter(s => 
                    s !== subscriber)
            })
        },
        
        async eval ({ id, args: [node, script] }: Message<[string, string]>, view) {
            let { ddb } = explorer.connections.find(({ name }) => 
                name === node)
                
            const { buffer, le } = await ddb.eval(script, { parse_object: false })
            
            dataview.send(
                {
                    id,
                    done: true,
                    args: [buffer, le]
                }
            )
        }
    } as Record<
        string, 
        (message: Message, view?: WebviewView) => void | Promise<void>
    >,
    
    
    register () {
        window.registerWebviewViewProvider(
            'dolphindb.dataview',
            {
                async resolveWebviewView (view, ctx, canceller) {
                    dataview.view = view
                    
                    view.webview.options = {
                        enableCommandUris: true,
                        enableScripts: true,
                    }
                    
                    view.webview.onDidReceiveMessage(
                        dataview.handle,
                        dataview,
                    )
                    
                    view.webview.html = (
                        await fread(`${fpd_ext}dataview/webview.html`)
                    ).replace(/\{host\}/g, `localhost:${server.port}`)
                }
            },
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                }
            }
        )
        
    },
    
    
    send (message: Message) {
        if (!('id' in message))
            message.id = this.id
        
        this.view.webview.postMessage(
            Remote.pack(message).buffer
        )
    },
    
    
    /** 调用 remote 中的 func, 中间消息及返回结果可由 handler 处理，处理 done message 之后的返回值作为 call 函数的返回值 
        如果为 unary rpc, 可以不传 handler, await call 之后可以得到响应 message 的 args
    */
    async call <T extends any[] = any[]> (
        message: Message,
        handler?: (message: Message<T>) => any
    ) {
        return new Promise<T>((resolve, reject) => {
            this.handlers[this.id] = async (message: Message<T>) => {
                const { error, done } = message
                
                if (error) {
                    reject(
                        Object.assign(
                            new Error(),
                            error
                        )
                    )
                    return
                }
                
                const result = handler ?
                        await handler(message)
                    :
                        message.args
                
                if (done)
                    resolve(result)
            }
            
            this.send(message)
            
            this.id++
        })
    },
    
    
    /** 处理接收到的 message
        1. 被调用方接收 message 并开始处理
        2. 调用方处理 message 响应
    */
    async handle (buffer: ArrayBuffer) {
        const message = Remote.parse(buffer)
        
        const { func, id, done } = message
        
        if (this.print)
            console.log(message)
        
        if (func) // 作为被调方
            try {
                const handler = this.funcs[func]
                
                if (!handler)
                    throw new Error(`找不到 rpc handler for '${func}'`)
                
                await handler(message, this.view)
            } catch (error) {
                this.send(
                    {
                        id,
                        error,
                        done: true
                    },
                )
                
                throw error
            }
        else {  // 作为发起方
            this.handlers[id](message)
            
            if (done)
                this.handlers[id] = null
        }
    }
}


const ddb_commands = [
    async function execute () {
        const { web_url } = server
        
        if (!term || term.exitStatus) {
            let printer = new EventEmitter<string>()
            
            await new Promise<void>(resolve => {
                term = window.createTerminal({
                    name: 'DolphinDB',
                    
                    pty: {
                        open (init_dimensions: TerminalDimensions | undefined) {
                            printer.fire(
                                'DolphinDB Shell\r\n' +
                                `${web_url}\r\n`
                            )
                            resolve()
                        },
                        
                        close () {
                            console.log('term.close()')
                            term.dispose()
                            printer.dispose()
                        },
                        
                        onDidWrite: printer.event,
                    },
                }) as DdbTerminal
                
                term.printer = printer
                
                term.show(true)
            })
        }
        
        let { connection } = explorer
        
        if (!connection.connected) {
            connection.disconnect()
            await connection.connect()
        }
        
        let { ddb } = connection
        let { printer } = term || { }
        
        const time_start = dayjs()
        
        printer?.fire(
            '\r\n\r\n' +
            `${time_start.format('YYYY.MM.DD HH:mm:ss.SSS')}  ${connection.name}\r\n`
        )
        
        try {
            const obj = await ddb.eval(
                get_text('selection or line')
                    .replace(/\r\n/g, '\n'),
                {
                    listener (message) {
                        const { type, data } = message
                        if (type === 'print')
                            printer?.fire(
                                data.replace(/\n/g, '\r\n') + 
                                '\r\n'
                            )
                        
                        for (const subscriber of dataview.subscribers_repl)
                            subscriber(message, ddb)
                        
                        for (const subscriber of server.subscribers_repl)
                            subscriber(message, ddb)
                    }
                }
            )
            
            
            printer?.fire(
                 (() => {
                     switch (obj.form) {
                         case DdbForm.vector:
                         case DdbForm.set:
                         case DdbForm.matrix:
                         case DdbForm.table:
                         case DdbForm.chart: {
                             const objstr = obj.inspect_type().blue
                             console.log(objstr)
                             return objstr.replace(/\n/g, '\r\n') + '\r\n'
                         }
                         
                         default: {
                             if (obj.type === DdbType.void)
                                 return ''
                             
                             const objstr = inspect(obj)
                             console.log(objstr)
                             return objstr.replace(/\n/g, '\r\n') + '\r\n'
                         }
                     }
                 })() +
                `(${delta2str(
                    dayjs().diff(time_start)
                )})\r\n`
            )
            
            await connection.update()
        } catch (error) {
            printer?.fire(
                `${error.message.replace(/\n/g, '\r\n').red}\r\n`
            )
            throw error
        }
    },
    
    function set_connection (name: string) {
        explorer.set_connection(name)
    },
    
    function disconnect_connection (connection: DdbConnection) {
        console.log('disconnect_ddb_connection', connection)
        connection.disconnect()
    },
    
    async function inspect_variable (ddbvar: DdbVar) {
        console.log('inspect_variable', ddbvar)
        await ddbvar.inspect()
    },
    
    async function open_variable (ddbvar: DdbVar) {
        console.log('open_variable', ddbvar)
        await ddbvar.inspect(true)
    },
    
    async function reload_dataview () {
        const { webview } = dataview.view
        webview.html = webview.html + ' '
    },
]


export async function activate (ctx: ExtensionContext) {
    // 命令注册
    for (const func of ddb_commands)
        ctx.subscriptions.push(
            commands.registerCommand(`dolphindb.${func.name}`, func)
        )
    
    
    // 连接、变量管理
    explorer = new DdbExplorer()
    
    explorer.view = window.createTreeView('dolphindb.explorer', {
        treeDataProvider: explorer
    })
    
    
    // 监听配置修改刷新连接
    workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('dolphindb.connections')) {
            explorer.load_connections()
            explorer.refresher.fire()
        }
    })
    
    
    // 函数补全
    ctx.subscriptions.push(
        languages.registerCompletionItemProvider('dolphindb', {
            provideCompletionItems (doc, pos, canceller, ctx) {
                const keyword = doc.getText(
                    doc.getWordRangeAtPosition(pos)
                )
                
                let fns: string[]
                let _constants: string[]
                
                if (keyword.length === 1) {
                    const c = keyword[0].toLowerCase()
                    fns = funcs.filter((func, i) => 
                        funcs_lower[i].startsWith(c)
                    )
                    _constants = constants.filter((constant, i) => 
                        constants_lower[i].startsWith(c)
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
                    
                    _constants = constants.filter((constant, i) => {
                        const constant_lower = constants_lower[i]
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
                    ...keywords.filter(kw => 
                        kw.startsWith(keyword)
                    ).map(kw => ({
                        label: kw,
                        kind: CompletionItemKind.Keyword
                    })),
                    ... _constants.map(constant => ({
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
                item.documentation = get_func_md(item.label as string)
                
                return item
            }
        })
    )
    
    
    // 悬浮提示
    ctx.subscriptions.push(
        languages.registerHoverProvider('dolphindb', {
            provideHover (doc, pos, canceller) {
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
                const { func_name, param_search_pos } = find_func_start(doc, pos)
                if (param_search_pos === -1) 
                    return
                
                const index = find_active_param_index(doc, pos, param_search_pos)
                if (index === -1) 
                    return
                
                const signature_and_params = get_signature_and_params(func_name)
                if (!signature_and_params)
                    return
                
                const { signature, params } = signature_and_params
                let sig = new SignatureInformation(
                    signature,
                    get_func_md(func_name)
                )
                
                for (let param of params)
                    sig.parameters.push(
                        new ParameterInformation(param)
                    )
                
                let help = new SignatureHelp()
                help.signatures.push(sig)
                help.activeParameter = index > params.length - 1 ? params.length - 1 : index
                
                return help
            }
        }, '(', ',')
    )
    
    
    // HTTP Server
    server = new DdbServer()
    
    try {
        await server.start()
        dataview.register()
    } catch (error) {
        window.showErrorMessage(error.message)
    }
    
    
    console.log(
        t('DolphinDB 插件已初始化')
    )
}


export function deactivate (ctx: ExtensionContext) {
    server?.stop()
}

/** 最大搜索行数 */
const max_lines_to_match = 30 as const

// 栈 token 匹配表
const token_map = {
    ')': '(',
    '}': '{',
    ']': '['
} as const

const token_ends = new Set(
    Object.values(token_map)
)

function get_func_md (keyword: string) {
    const func_doc = docs[keyword]
    
    if (!func_doc)
        return
    
    let md = new MarkdownString(
        // 标题
        `#### ${func_doc.title}\n` +
        
        // 链接
        `https://${ language === 'zh' ? 'www.dolphindb.cn/cn/' : 'dolphindb.com/' }help/FunctionsandCommands/${ func_doc.type === 'command' ? 'CommandsReferences' : 'FunctionReferences' }/${func_doc.title[0]}/${func_doc.title}.html\n`
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
    func_name: string
    param_search_pos: number
} {
    const func_name_regex = /[a-z|A-Z|0-9|\!|_]/
    
    const text = document.getText(
        new Range(
            Math.max(position.line - max_lines_to_match, 0), 0,
            position.line, position.character
        )
    )
    
    let stack_depth = 0
    let param_search_pos = -1
    for (let i = text.length; i >= 0; i--) {
        let char = text[i]
        // 遇到右括号，入栈，增加一层括号语境深度
        if (char === ')') {
            stack_depth++
            continue
        }
        // 遇到左括号，出栈，退出一层括号语境深度
        else if (char === '(') {
            stack_depth--
            continue
        }
        
        // 栈深度小于0，且遇到合法函数名字符，跳出括号语境，搜索结束：参数搜索开始位置
        if (func_name_regex.test(char) && stack_depth < 0) {
            param_search_pos = i
            break
        }
    }
    
    // 找不到参数搜索开始位置，返回null
    if (param_search_pos === -1) 
        return { param_search_pos: -1, func_name: '' }
    
    
    // 往前找函数名
    let func_name_end = -1
    let func_name_start = 0
    for (let i = param_search_pos; i >= 0; i--) {
        let char = text[i]
        
        // 空字符跳过
        if (func_name_end === -1 && char === ' ') 
            continue
        
        // 合法函数名字字符，继续往前找
        if (func_name_regex.test(char)) {
            // 标记函数名字末尾位置
            if (func_name_end === -1) 
                func_name_end = i
            
            continue
        }
        
        // 不合法函数名字符，标记函数名字开头位置
        func_name_start = i + 1
        break
    }
    
    // 找不到函数名
    if (func_name_end === -1) 
        return { param_search_pos: -1, func_name: '' }
    
    return {
        param_search_pos: param_search_pos + 1,
        func_name: text.slice(func_name_start, func_name_end + 1)
    }
}


/** 根据函数参数开始位置分析参数语义，提取出当前参数索引  */
function find_active_param_index (
    document: TextDocument,
    position: Position,
    start: number
) {
    const text = document.getText(
        new Range(
            Math.max(position.line - max_lines_to_match, 0), 0, 
            position.line, position.character
        )
    )
    
    let index = 0
    let stack = []
    
    // 分隔符，此处为逗号
    const seperator = ','
    
    let ncommas = 0
    
    // 搜索
    for (let i = start; i < text.length; i++) {
        const char = text[i]
        
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
        if (token_ends.has(char as any) || char === '"' || char === "'") {
            stack.push(char)
            continue
        } else if (char in token_map)  // 括号匹配，出栈，括号不匹配，返回null
            if (stack[stack.length - 1] === token_map[char]) {
                stack.pop()
                continue
            } else // 括号不匹配，返回-1
                return -1
        
        // 栈深度为1 且为左小括号：当前语境
        if (stack.length === 1 && stack[0] === '(') 
            // 遇到逗号，若之前有合法参数，计入逗号
            if (char === seperator)
                ncommas++
        
        // 根据逗号数量判断高亮参数索引值
        index = ncommas
    }
    
    return index
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



class DdbExplorer implements TreeDataProvider<TreeItem> {
    view: TreeView<TreeItem>
    
    refresher: EventEmitter<TreeItem | undefined | void> = new EventEmitter<TreeItem | undefined | void>()
    
    onDidChangeTreeData: Event<void | TreeItem> = this.refresher.event
    
    connections: DdbConnection[]
    
    connection: DdbConnection
    
    constructor () {
        this.load_connections()
    }
    
    getParent (element: TreeItem): ProviderResult<TreeItem> {
        if (element instanceof DdbExplorer)
            return
        
        if (element instanceof DdbConnection)
            return explorer.view
    }
    
    load_connections () {
        if (this.connections)
            for (const connection of this.connections)
                connection.disconnect()
        
        this.connections = workspace.getConfiguration('dolphindb')
            .get<Partial<DdbConnection>[]>('connections')
            .map(conn => 
                new DdbConnection(conn)
            )
        
        this.connection = this.connections[0]
        this.connection.iconPath = icon_checked
    }
    
    set_connection (name: string) {
        for (let connection of this.connections)
            if (connection.name === name) {
                connection.iconPath = icon_checked
                this.connection = connection
            } else
                connection.iconPath = icon_empty
        
        console.log('ddb_explorer.set_connection', this.connection)
        this.refresher.fire()
    }
    
    getTreeItem (node: TreeItem): TreeItem | Thenable<TreeItem> {
        return node
    }
    
    getChildren (node?: TreeItem) {
        switch (true) {
            case !node:
                return this.connections
                
            case node instanceof DdbConnection: {
                const { local, shared } = node as DdbConnection
                const locations = [local, shared].filter(node => 
                    node.vars.length
                )
                return locations.length === 1?
                        this.getChildren(locations[0])
                    :
                        locations
            }
            
            case node instanceof DdbVarLocation: {
                const { scalar, object, pair, vector, set, dict, matrix, table, chart, chunk } = node as DdbVarLocation
                return [scalar, object, pair, vector, set, dict, matrix, table, chart, chunk].filter(node => 
                    node.vars.length
                )
            }
            
            case node instanceof DdbVarForm:
                return (node as DdbVarForm).vars
        }
    }
    
    async resolveTreeItem (item: TreeItem, element: TreeItem, canceller: CancellationToken): Promise<TreeItem> {
        if (!(item instanceof DdbVar))
            return
        
        await item.resolve_tooltip()
        return item
    }
}


class DdbConnection extends TreeItem {
    /** 连接名称 (连接 id)，如 local8848, controller, datanode0 */
    name: string
    
    /** 参考 DDB.connect 方法 */
    url: string
    
    autologin: boolean
    
    username: string
    
    password: string
    
    python: boolean
    // ---
    
    ddb: DDB
    
    vars: DdbVar[]
    
    // varsmap: Record<string, DdbVar>
    
    local: DdbVarLocation
    
    shared: DdbVarLocation
    
    
    get connected () {
        return this.ddb.websocket?.readyState === WebSocket.OPEN
    }
    
    
    constructor (data: Partial<DdbConnection>) {
        super(`${data.name} `, TreeItemCollapsibleState.None)
        
        Object.assign(this, data)
        
        this.description = this.url
        this.iconPath = icon_empty
        this.contextValue = 'disconnected'
        
        this.ddb = new DDB(this.url)
        
        this.command = {
            command: 'dolphindb.set_connection',
            title: 'dolphindb.set_connection',
            arguments: [this.name],
        }
        
        this.local = new DdbVarLocation(this, false)
        this.shared = new DdbVarLocation(this, true)
    }
    
    
    async connect () {
        await this.ddb.connect(this)
        console.log(`${this.name} ${t('成功连接到 DolphinDB')}`)
        
        this.collapsibleState = TreeItemCollapsibleState.Expanded
        this.contextValue = 'connected'
        explorer.refresher.fire(this)
        explorer.view.reveal(this, { expand: 3 })
    }
    
    
    disconnect () {
        this.ddb.disconnect()
        this.collapsibleState = TreeItemCollapsibleState.None
        this.contextValue = 'disconnected'
        explorer.refresher.fire(this)
    }
    
    
    /**
         执行代码后更新变量面板  
         变量只获取 scalar 和 pair 这两中不可变类型的值  
         因为如果将 vector, matrix 等类型的变量作为 any vector 的元素创建 any vector，会失去 ownership，变得不可修改，如下  
         ```dolphindb
         a = [1]
         (a, 0)  // 获取本地变量的值，展示在变量面板
         append!(a, 1)  // error: append!(a, 1) => Read only object or object without ownership can't be applied to mutable function append!
         ```
     */
    async update () {
        const objs = await this.ddb.call('objs', [true])
        
        const vars_data = objs.to_rows()
            .map(({
                name,
                type,
                form,
                rows,
                columns,
                bytes,
                shared,
                extra,
            }: {
                name: string
                type: string
                form: string
                rows: number
                columns: number
                bytes: bigint
                shared: boolean
                extra: string
            }) => ({
                node: this.name,
                
                ddb: this.ddb,
                
                name,
                type: (() => {
                    const _type = type.toLowerCase()
                    return _type.endsWith('[]') ?
                            DdbType[_type.slice(0, -2)] + 64
                        :
                            DdbType[_type]
                })(),
                form: (() => {
                    const _form = form.toLowerCase()
                    switch (_form) {
                        case 'dictionary':
                            return DdbForm.dict
                        
                        case 'sysobj':
                            return DdbForm.object
                            
                        default:
                            return DdbForm[_form]
                    }
                })(),
                rows,
                cols: columns,
                bytes,
                shared,
                extra,
                obj: undefined as DdbObj
            }))
            .filter(v => 
                v.name !== 'pnode_run' && 
                !(v.form === DdbForm.object && (
                    v.name === 'list' ||
                    v.name === 'tuple' ||
                    v.name === 'dict' ||
                    v.name === 'set' ||
                    v.name === '_ddb'
                ))
            )
        
        let imutables = vars_data.filter(v =>
            v.form === DdbForm.scalar || v.form === DdbForm.pair)
        
        if (imutables.length) {
            const { value: values } = await this.ddb.eval<DdbObj<DdbObj[]>>(
                `(${
                    imutables.map(({ name }) => 
                        name
                    ).join(', ')
                }, 0)${ this.python ? '.toddb()' : '' }`
            )
            
            for (let i = 0;  i < values.length - 1;  i++)
                imutables[i].obj = values[i]
        }
        
        this.vars = vars_data.map(data => 
            new DdbVar(data))
        
        // this.varsmap = this.vars.reduce<Record<string, any>>((acc, row) => {
        //         acc[row.name] = row
        //         return acc
        //     }, { })
        
        // console.log(this.varsmap)
        
        let locals : DdbVar[] = [ ]
        let shareds: DdbVar[] = [ ]
        for (const v of this.vars)
            if (v.shared)
                shareds.push(v)
            else
                locals.push(v)
        this.local.update(locals)
        this.shared.update(shareds)
        
        explorer.refresher.fire(this)
    }
}


class DdbVarLocation extends TreeItem {
    connection: DdbConnection
    
    shared: boolean
    
    vars: DdbVar[] = [ ]
    
    // ---
    scalar: DdbVarForm
    
    vector: DdbVarForm
    
    pair: DdbVarForm
    
    matrix: DdbVarForm
    
    set: DdbVarForm
    
    dict: DdbVarForm
    
    table: DdbVarForm
    
    chart: DdbVarForm
    
    chunk: DdbVarForm
    
    object: DdbVarForm
    
    
    constructor (connection: DdbConnection, shared: boolean) {
        super(
            shared ? t('共享变量') : t('本地变量'),
            TreeItemCollapsibleState.Expanded
        )
        this.connection = connection
        this.shared = shared
        
        this.scalar = new DdbVarForm(connection, this.shared, DdbForm.scalar)
        this.vector = new DdbVarForm(connection, this.shared, DdbForm.vector)
        this.pair   = new DdbVarForm(connection, this.shared, DdbForm.pair)
        this.matrix = new DdbVarForm(connection, this.shared, DdbForm.matrix)
        this.set    = new DdbVarForm(connection, this.shared, DdbForm.set)
        this.dict   = new DdbVarForm(connection, this.shared, DdbForm.dict)
        this.table  = new DdbVarForm(connection, this.shared, DdbForm.table)
        this.chart  = new DdbVarForm(connection, this.shared, DdbForm.chart)
        this.chunk  = new DdbVarForm(connection, this.shared, DdbForm.chunk)
        this.object = new DdbVarForm(connection, this.shared, DdbForm.object)
    }
    
    
    update (vars: DdbVar[]) {
        this.vars = vars
        
        if (!vars.length)
            return
        
        let scalars: DdbVar[] = [ ]
        let vectors: DdbVar[] = [ ]
        let pairs:   DdbVar[] = [ ]
        let matrixs: DdbVar[] = [ ]
        let sets:    DdbVar[] = [ ]
        let dicts:   DdbVar[] = [ ]
        let tables:  DdbVar[] = [ ]
        let charts:  DdbVar[] = [ ]
        let chunks:  DdbVar[] = [ ]
        let objects:  DdbVar[] = [ ]
        
        for (const v of this.vars)
            switch (v.form) {
                case DdbForm.scalar:
                    scalars.push(v)
                    break
                    
                case DdbForm.vector:
                    vectors.push(v)
                    break
                    
                case DdbForm.pair:
                    pairs.push(v)
                    break
                    
                case DdbForm.matrix:
                    matrixs.push(v)
                    break
                    
                case DdbForm.set:
                    sets.push(v)
                    break
                    
                case DdbForm.dict:
                    dicts.push(v)
                    break
                    
                case DdbForm.table:
                    tables.push(v)
                    break
                    
                case DdbForm.chart:
                    charts.push(v)
                    break
                    
                case DdbForm.chunk:
                    chunks.push(v)
                    break
                    
                case DdbForm.object:
                    objects.push(v)
                    break
            }
        
        this.scalar.update(scalars)
        this.vector.update(vectors)
        this.pair.update(pairs)
        this.matrix.update(matrixs)
        this.set.update(sets)
        this.dict.update(dicts)
        this.table.update(tables)
        this.chart.update(charts)
        this.chunk.update(chunks)
        this.object.update(objects)
    }
}


class DdbVarForm extends TreeItem {
    connection: DdbConnection
    
    shared: boolean
    
    form: DdbForm
    
    vars: DdbVar[]
    
    constructor (connection: DdbConnection, shared: boolean, form: DdbForm) {
        super(DdbForm[form], TreeItemCollapsibleState.Expanded)
        this.connection = connection
        this.shared = shared
        this.form = form
        this.iconPath = `${fpd_ext}icons/${DdbForm[form]}.svg`
    }
    
    update (vars: DdbVar[]) {
        this.vars = vars
    }
}


class DdbVar <T extends DdbObj = DdbObj> extends TreeItem {
    static size_limit = 10240n as const
    
    static icon = new ThemeIcon('symbol-variable')
    
    static contexts = {
        [DdbForm.scalar]: 'scalar',
        [DdbForm.pair]: 'pair',
        [DdbForm.object]: 'object',
    } as const
    
    node: string
    
    ddb: DDB
    
    // --- by objs(true)
    name: string
    
    form: DdbForm
    
    type: DdbType
    
    rows: number
    
    cols: number
    
    bytes: bigint
    
    shared: boolean
    
    extra: string
    
    /** this.bytes <= DdbVar.size_limit */
    obj: T
    
    
    constructor (data: Partial<DdbVar>) {
        super(data.name, TreeItemCollapsibleState.None)
        
        Object.assign(this, data)
        
        this.label = (() => {
            const tname = DdbType[this.type]
            
            const type = (() => {
                switch (this.form) {
                    case DdbForm.scalar:
                        if (this.type === DdbType.functiondef)
                            return `<functiondef<${DdbFunctionType[(this.obj.value as DdbFunctionDefValue).type]}>>`
                        
                        return `<${tname}>`
                    
                    case DdbForm.pair:
                        return `<${tname}>`
                    
                    case DdbForm.vector:
                        return `<${ 64 <= this.type && this.type < 128 ? `${DdbType[this.type - 64]}[]` : tname }> ${this.rows} rows`
                    
                    case DdbForm.set:
                        return `<${tname}> ${this.rows} keys`
                    
                    case DdbForm.table:
                        return ` ${this.rows} × ${this.cols}`
                    
                    case DdbForm.dict:
                        return ` ${this.rows} keys`
                    
                    case DdbForm.matrix:
                        return `<${tname}> ${this.rows} × ${this.cols}`
                    
                    case DdbForm.object:
                        return ''
                    
                    default:
                        return ` ${DdbForm[this.form]} ${tname}`
                }
            })()
            
            const value = (() => {
                switch (this.form) {
                    case DdbForm.scalar:
                        return ' = ' + format(this.type, this.obj.value, this.obj.le, { colors: false })
                    
                    // 类似 DdbObj[inspect.custom] 中 format data 的逻辑
                    case DdbForm.pair: {
                        function format_array (items: string[], ellipsis: boolean) {
                            const str_items = items.join(', ') + (ellipsis ? ', ...' : '')
                            
                            return str_items.bracket('square')
                        }
                        
                        switch (this.type) {
                            case DdbType.uuid: 
                            case DdbType.int128: 
                            case DdbType.ipaddr: {
                                const limit = 10 as const
                                
                                const value = this.obj.value as Uint8Array
                                
                                const len_data = value.length / 16
                                
                                let items = new Array(
                                    Math.min(limit, len_data)
                                )
                                
                                for (let i = 0;  i < items.length;  i++)
                                    items[i] = format(
                                        this.type,
                                        value.subarray(16 * i, 16 * (i + 1)),
                                        this.obj.le,
                                        { colors: false }
                                    )
                                
                                return ' = ' + format_array(
                                    items,
                                    len_data > limit
                                )
                            }
                            
                            case DdbType.complex:
                            case DdbType.point: {
                                const limit = 20 as const
                                
                                const value = this.obj.value as Float64Array
                                
                                const len_data = value.length / 2
                                
                                let items = new Array(
                                    Math.min(limit, len_data)
                                )
                                
                                for (let i = 0;  i < items.length;  i++)
                                    items[i] = format(
                                        this.type,
                                        value.subarray(2 * i, 2 * (i + 1)),
                                        this.obj.le,
                                        { colors: false }
                                    )
                                
                                return ' = ' + format_array(
                                    items,
                                    len_data > limit
                                )
                            }
                            
                            default: {
                                const limit = 50 as const
                                
                                let items = new Array(
                                    Math.min(limit, (this.obj.value as any[]).length)
                                )
                                
                                for (let i = 0;  i < items.length;  i++)
                                    items[i] = format(this.type, this.obj.value[i], this.obj.le, { colors: false })
                                
                                return ' = ' + format_array(
                                    items,
                                    (this.obj.value as any[]).length > limit
                                )
                            }
                        }
                    }
                    
                    case DdbForm.object:
                        return ''
                    
                    default:
                        return ` [${Number(this.bytes).to_fsize_str().replace(' ', '')}]`
                }
            })()
            
            return this.name + type + value
        })()
        
        // scalar, pair 不显示 inspect actions, 作特殊区分
        this.contextValue = DdbVar.contexts[this.form] || 'var'
        
        this.iconPath = DdbVar.icon
    }
    
    
    /** 类似 DDB.[inspect.custom], 对于 bytes 大的对象不获取值 */
    get_value_type () {
        const tname = DdbType[this.type]
        
        switch (this.form) {
            case DdbForm.scalar:
                return tname
            
            case DdbForm.vector:
                if (64 <= this.type && this.type < 128)
                    return `${DdbType[this.type - 64]}[][${this.rows}]`
                return `${tname}[${this.rows}]`
            
            case DdbForm.pair:
                return `pair<${tname}>`
            
            case DdbForm.set:
                return `set<${tname}>[${this.rows}]`
            
            case DdbForm.table:
                return `table[${this.rows}r][${this.cols}c]`
            
            case DdbForm.dict:
                return `dict[${this.rows}]`
            
            case DdbForm.matrix:
                return `matrix[${this.rows}r][${this.cols}c]`
            
            case DdbForm.object:
                return 'object'
            
            default:
                return `${DdbForm[this.form]} ${tname}`
        }
    }
    
    
    async inspect (open = false) {
        if (open && !server.subscribers_inspection.length) {
            open_url(server.web_url)
            await delay(3000)
        }
        
        const args = [
            {
                node: this.node,
                name: this.name,
                form: this.form,
                type: this.type,
                rows: this.rows,
                cols: this.cols,
                bytes: this.bytes,
                shared: this.shared,
                extra: this.extra,
            },
            open,
            ... (this.obj ? 
                [this.obj.pack(), this.obj.le]
            :
                [ ]) as [Uint8Array, boolean],
        ] as const
        
        
        for (const subscriber of dataview.subscribers_inspection)
            subscriber(...args)
        
        for (const subscriber of server.subscribers_inspection)
            subscriber(...args)
    }
    
    
    async resolve_tooltip () {
        if (!this.obj && this.bytes <= DdbVar.size_limit)
            this.obj = await this.ddb.eval(this.name)
        
        this.tooltip = this.obj ?
                this.form === DdbForm.object ?
                    (this.obj.value as string)
                :
                    inspect(this.obj, { colors: false })
            :
                `${this.get_value_type()}(${Number(this.bytes).to_fsize_str()})`
    }
}


class DdbServer extends Server {
    static libs = {
        'react.production.min.js': 'react/umd/react.production.min.js',
        'react-dom.production.min.js': 'react-dom/umd/react-dom.production.min.js',
        'antd.css': 'antd/dist/antd.css',
        'antd.js': 'antd/dist/antd.js',
    } as const
    
    static dev = fpd_ext === 'd:/1/ddb/ext/out/'
    
    web_url = 'http://localhost:8321/'
    
    server_ws: WebSocketServer
    
    subscribers_repl = [ ] as DdbMessageListener[]
    
    subscribers_inspection = [ ] as ((ddbvar: Partial<DdbVar>, open: boolean, buffer?: Uint8Array, le?: boolean) => any)[]
    
    
    remote = new Remote ({
        funcs: {
            async subscribe_repl ({ id }, websocket) {
                console.log('subscribed to repl')
                
                function subscriber ({ type, data }: DdbMessage) {
                    server.remote.send(
                        {
                            id,
                            args: (() => {
                                switch (type) {
                                    case 'print':
                                    case 'error':
                                        return [type, data]
                                    
                                    case 'object':
                                        return [type, data.pack(), data.le]
                                }
                            })()
                        },
                        websocket
                    )
                }
                
                server.subscribers_repl.push(subscriber)
                
                websocket.addEventListener('close', () => {
                    console.log('unsubscribed repl due to websocket connection closed')
                    server.subscribers_repl = server.subscribers_repl.filter(s => 
                        s !== subscriber)
                })
            },
            
            async subscribe_inspection ({ id }, websocket) {
                console.log('subscribed to inspection')
                
                function subscriber (ddbvar: Partial<DdbVar>, open: boolean, buffer?: Uint8Array, le?: boolean) {
                    server.remote.send(
                        {
                            id,
                            args: [ddbvar, open, buffer, le]
                        },
                        websocket
                    )
                }
                
                server.subscribers_inspection.push(subscriber)
                
                websocket.addEventListener('close', () => {
                    console.log('unsubscribed inspection due to websocket connection closed')
                    server.subscribers_inspection = server.subscribers_inspection.filter(s => 
                        s !== subscriber)
                })
            },
            
            async eval ({ id, args: [node, script] }: Message<[string, string]>, websocket) {
                let { ddb } = explorer.connections.find(({ name }) => 
                    name === node)
                    
                const { buffer, le } = await ddb.eval(script, { parse_object: false })
                
                server.remote.send(
                    {
                        id,
                        done: true,
                        args: [buffer, le]
                    },
                    websocket
                )
            }
        }
    })
    
    
    constructor () {
        // 实际上重写了 start 方法, this.port = 8321 未使用
        super(8321, { rpc: false })
    }
    
    override async start () {
        // --- init koa app
        let app = new Koa()
        
        app.on('error', (error, ctx) => {
            console.error(error)
            console.log(ctx)
        })
        
        app.use(
            this.entry.bind(this)
        )
        
        app.use(
            KoaCompress({
                br: {
                    // https://nodejs.org/api/zlib.html#zlib_class_brotlioptions
                    params: {
                        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
                        [zlib.constants.BROTLI_PARAM_QUALITY]: 6  // default 11 (maximized compression), may lead to news/get generated 14mb json taking 24s
                    },
                },
                threshold: 512
            })
        )
        
        app.use(
            KoaCors({ credentials: true })
        )
        
        app.use(KoaUserAgent)
        
        app.use(
            this._router.bind(this)
        )
        
        this.app = app
        
        this.handler = this.app.callback()
        
        this.server_http = http_create_server(this.handler)
        this.server_http.unref()
        
        this.server_ws = new WebSocketServer({
            noServer: true,
            skipUTF8Validation: true,
        })
        
        this.server_ws.on('connection', (websocket, request) => {
            websocket.addEventListener('message', event => {
                this.remote.handle(event as { data: ArrayBuffer }, websocket)
            })
        })
        
        // --- dispatch websocket 连接请求
        this.server_http.on(
            'upgrade',
            this.on_upgrade.bind(this)
        )
        
        // 获取配置的端口
        for (const port of (function * () {
            // 先打开 remote ssh 文件夹，运行代码，在远程主机上会监听 8321 端口，然后由 vscode 转发到本地，但是转发的端口监听的是 127.0.0.1:8321
            // 再打开本地文件夹，运行代码，在本地主机上 8321 依旧监听成功，因为监听的地址是 *:8321
            // 因此，如果插件在远程运行，如 remote-ssh, 那么端口从后往前找第一个可用的，避免转发的端口与本地端口冲突的情况
            // https://code.visualstudio.com/api/advanced-topics/remote-extensions
            // Opening something in a local browser or application
            if (extensions.getExtension('dolphindb.dolphindb-vscode').extensionKind === ExtensionKind.Workspace)  // running remotely
                for (const range of 
                    workspace.getConfiguration('dolphindb')
                        .get<string>('ports')
                        .split(',')
                        .reverse()
                ) {
                    const [left, right] = range.split('-')
                        .map(x => 
                            Number(x))
                    
                    if (!right)
                        yield left
                    
                    for (let i = right;  i >= left;  i--)
                        yield i
                }
            else
                for (const range of 
                    workspace.getConfiguration('dolphindb')
                        .get<string>('ports')
                        .split(',')
                ) {
                    const [left, right] = range.split('-')
                        .map(x => 
                            Number(x))
                    
                    if (!right)
                        yield left
                    
                    for (let i = left;  i <= right;  i++)
                        yield i
                }
        })())
            try {
                await new Promise<void>((resolve, reject) => {
                    this.server_http.once('error', error => {
                        console.log(`端口 ${port} 监听失败：${error.message}`)
                        reject(error)
                    })
                    
                    this.server_http.listen(port, resolve)
                })
                this.port = port
                this.web_url = `http://localhost:${port}/`
                console.log('dolphindb http server started:', this.web_url)
                break
            } catch (error) {
                if (error.code !== 'EADDRINUSE')
                    throw error
            }
    }
    
    
    on_upgrade (request: IncomingMessage, socket: Duplex, head: Buffer) {
        // url 只有路径部分
        const {
            url, 
            headers: { host = '', 'user-agent': ua },
        } = request
        
        const ip = (request.socket.remoteAddress as string).replace(/^::ffff:/, '')
        
        console.log(`${new Date().to_time_str()}    ${(ip || '').pad(40)}  ${(ua || '').limit(40)}  ${'websocket'.pad(10).magenta}    ${'connect'.pad(10).magenta}${host.pad(20)}  ${url.pad(60).yellow}`)
        
        this.server_ws.handleUpgrade(request, socket, head, ws => {
            ws.binaryType = 'arraybuffer'
            this.server_ws.emit('connection', ws, request)
        })
    }
    
    
    override async router (ctx: Context) {
        let {
            request: { path }
        } = ctx
        
        if (path === '/')
            path = '/index.html'
        
        if (path === '/window')
            path = '/window.html'
        
        if (path === '/webview')
            path = '/webview.html'
        
        return this.try_send(
            ctx,
            path,
            {
                root: `${fpd_ext}dataview/`,
                log_404: false
            }
        )
    }
}

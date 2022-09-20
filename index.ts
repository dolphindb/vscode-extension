import zlib from 'zlib'
import { createServer, type IncomingMessage } from 'http'
import type { Duplex } from 'stream'

import {
    window,
    workspace,
    
    commands,
    
    languages,
    
    extensions, ExtensionKind,
    
    ThemeIcon, ThemeColor,
    
    MarkdownString,
    
    type TextDocument,
    Range,
    type Position,
    
    EventEmitter, type Event,
    
    type ExtensionContext,
    
    type Terminal, type TerminalDimensions,
    
    Hover,
    
    SignatureInformation, SignatureHelp, ParameterInformation,
    
    CompletionItem, CompletionItemKind,
    
    type TreeView, TreeItem, TreeItemCollapsibleState, type TreeDataProvider, type ProviderResult,
    
    type CancellationToken,
    
    type WebviewView,
    
    StatusBarAlignment, type StatusBarItem,
    
    InputBoxValidationSeverity,
    
    ConfigurationTarget, type ConfigurationChangeEvent,
} from 'vscode'

import path from 'upath'
import dayjs from 'dayjs'
import { WebSocket, WebSocketServer } from 'ws'
import { default as Koa, type Context } from 'koa'

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
    genid,
    assert,
} from 'xshell'
import { Server } from 'xshell/server.js'
import {
    DDB,
    DdbForm,
    DdbObj,
    DdbType,
    DdbFunctionType,
    format,
    formati,
    type DdbMessage,
    type DdbFunctionDefValue,
    type DdbVectorValue,
    type InspectOptions,
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

const constants_lower = constants.map(constant => constant.toLowerCase())

const funcs = Object.keys(docs)
const funcs_lower = funcs.map(func => func.toLowerCase())

const icon_empty = `${fpd_ext}icons/radio.empty.svg`
const icon_checked = `${fpd_ext}icons/radio.checked.svg`


let extctx: ExtensionContext

let server: DdbServer

let explorer: DdbExplorer


/** 底部代码执行状态 status bar */
let statbar = {
    bgerr: new ThemeColor('statusBarItem.errorBackground'),
    
    bar: null as StatusBarItem,
    
    init () {
        this.bar = window.createStatusBarItem({
            name: t('DolphinDB 执行状态'),
            id: 'ddb_statbar',
            alignment: StatusBarAlignment.Right,
            // priority: 暂不设置
        } as any)
        
        this.bar.command = 'dolphindb.cancel'
        this.bar.tooltip = t('取消作业')
        
        this.set_idle()
    },
    
    set_running () {
        this.set(true)
    },
    
    set_idle () {
        this.set(false)
    },
    
    set (running: boolean) {
        this.bar.text = running ? t('执行中') : t('空闲中')
        this.bar.backgroundColor = running ? this.bgerr : null
        this.bar.show()
    }
}

let formatter = {
    bar: null as StatusBarItem,
    
    decimals: null as number | null,
    
    
    init () {
        this.bar = window.createStatusBarItem({
            name: t('DolphinDB 小数显示位数'),
            id: 'ddb_formatter',
            alignment: StatusBarAlignment.Right,
            // priority: 暂不设置
        } as any)
        
        this.bar.command = 'dolphindb.set_decimals'
        this.bar.tooltip = t('设置 DolphinDB 小数显示位数')
        
        this.read_config()
        
        this.update_bar()
    },
    
    update_bar () {
        this.bar.text = `${t('小数位数:')} ${ this.decimals ?? '实际' }`
        this.bar.show()
    },
    
    read_config () {
        this.decimals = workspace.getConfiguration('dolphindb').get('decimals')
        console.log(`formatter.decimals: ${this.decimals}`)
    },
    
    save_config () {
        workspace.getConfiguration('dolphindb').update('decimals', this.decimals, ConfigurationTarget.Global)
        console.log(`formatter.decimals: ${this.decimals}`)
    },
    
    async prompt () {
        const value = await window.showInputBox({
            prompt: t('设置小数点后显示的位数 (可取 0 ~ 20) (置空时重置为实际数据的位数)'),
            placeHolder: t('实际数据的位数'),
            value: this.decimals === null || this.decimals === undefined ? '' : String(this.decimals),
            ignoreFocusOut: true,
            validateInput (value: string) {
                if (value === '' || /^\s*((1)?[0-9]|20)\s*$/.test(value)) {
                    const value_ = value.replace(/\s+/g, '')
                    return { message: `${'设置小数位数为:'} ${value_ === '' ? t('实际数据的位数') : value_}`, severity: InputBoxValidationSeverity.Info }
                } else
                    return { message: t('小数位数应为空或介于 0 - 20'), severity: InputBoxValidationSeverity.Error }
            }
        })
        
        if (value === undefined) {  // 通过按 esc 取消
            console.log('formatter.prompt: cancelled')
            return
        }
        
        this.decimals = value ? Number(value) : null
        
        this.save_config()
        // 会触发 on_config_change, 不需要再 this.update_bar()
    },
    
    async on_config_change (event: ConfigurationChangeEvent) {
        if (event.affectsConfiguration('dolphindb.decimals')) {
            console.log(t('dolphindb.decimals 配置被修改'))
            this.read_config()
            this.update_bar()
            
            if (explorer.connection.vars)
                await explorer.connection.update()
        }
    },
}


type DdbTerminal = Terminal & { printer: EventEmitter<string> }

let term: DdbTerminal


type ViewMessageHandler = (message: Message, view: WebviewView) => void | any[] | Promise<void | any[]>

/** 基于 vscode webview 相关的消息函数 postMessage, onDidReceiveMessage, window.addEventListener('message', ...) 实现的 rpc  */
let dataview = {
    view: null as WebviewView,
    
    /** map<id, message handler>: 通过 rpc message.id 找到对应的 handler, unary rpc 接收方不需要设置 handlers, 发送方需要 */
    handlers: new Map<number, ViewMessageHandler>(),
    
    print: false,
    
    
    subscribers_repl: [ ] as ((message: DdbMessage, ddb: DDB, options?: InspectOptions) => void)[],
    
    subscribers_inspection: [ ] as ((ddbvar: Partial<DdbVar>, open: boolean, options?: InspectOptions, buffer?: Uint8Array, le?: boolean) => any)[],
    
    
    /** 通过 rpc message.func 被调用的 rpc 函数 */
    funcs: {
        async subscribe_repl ({ id }, view) {
            console.log(t('webview 已订阅 repl'))
            
            function subscriber ({ type, data }: DdbMessage, ddb: DDB, options?: InspectOptions) {
                dataview.send(
                    {
                        id,
                        data: (() => {
                            switch (type) {
                                case 'print':
                                case 'error':
                                    return [type, data]
                                
                                case 'object':
                                    return [type, data.pack(), data.le, options]
                            }
                        })()
                    }
                )
            }
            
            dataview.subscribers_repl.push(subscriber)
            
            view.onDidDispose(() => {
                console.log(t('webview 的 repl 订阅被关闭，因为 dataview 被关闭'))
                dataview.subscribers_repl = dataview.subscribers_repl.filter(s => s !== subscriber)
            })
        },
        
        async subscribe_inspection ({ id }, view) {
            console.log(t('webview 已订阅 inspection'))
            
            function subscriber (ddbvar: Partial<DdbVar>, open: boolean, options?: InspectOptions, buffer?: Uint8Array, le?: boolean) {
                dataview.send({ id, data: [ddbvar, open, options, buffer, le] })
            }
            
            dataview.subscribers_inspection.push(subscriber)
            
            view.onDidDispose(() => {
                console.log(t('webview 的 inspection 订阅被关闭，因为 dataview 被关闭'))
                dataview.subscribers_inspection = dataview.subscribers_inspection.filter(s => s !== subscriber)
            })
        },
        
        async eval ({ data: [node, script] }: Message<[string, string]>, view) {
            let { ddb } = explorer.connections.find(({ name }) => name === node)
            const { buffer, le } = await ddb.eval(script, { parse_object: false })
            return [buffer, le]
        }
    } as Record<string, ViewMessageHandler>,
    
    
    register () {
        window.registerWebviewViewProvider(
            'dolphindb.dataview',
            {
                async resolveWebviewView (view, ctx, canceller) {
                    dataview.view = view
                    view.webview.options = { enableCommandUris: true, enableScripts: true }
                    view.webview.onDidReceiveMessage(dataview.handle, dataview)
                    view.webview.html = (
                        await fread(`${fpd_ext}dataview/webview.html`)
                    ).replace(/\{host\}/g, `localhost:${server.port}`)
                }
            },
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    },
    
    
    /** 发送或连接出错时自动清理 message.id 对应的 handler */
    async send (message: Message) {
        if (!message.id)
            message.id = genid()
        
        try {
            assert(await this.view.webview.postMessage(Remote.pack(message).buffer))
        } catch (error) {
            this.handlers.delete(message.id)
            throw error
        }
    },
    
    
    /** 处理接收到的 websocket message 并解析, 根据 id dispatch 到对应的 handler 进行处理  
        如果 message.done == true 则清理 handler  
        如果 handler 返回了值，则包装为 message 发送 */
    async handle (buffer: ArrayBuffer) {
        const message = Remote.parse(buffer)
        
        const { id, func, done } = message
        
        if (this.print)
            console.log(message)
        
        let handler: ViewMessageHandler
        
        if (func)
            handler = this.funcs[func]
        else {
            handler = this.handlers.get(id)
            if (done)
                this.handlers.delete(id)
        }
        
        try {
            if (handler) {
                const data = await handler(message, this.view)
                if (data)
                    await this.send({ id, data })
            } else if (message.error)
                throw message.error
            else
                throw new Error(`cannot find rpc handler: ${func ? `func: ${func.quote()}` : `id: ${id}`}`)
        } catch (error) {
            // handle 出错并不意味着 rpc 一定会结束，可能 error 是运行中的正常数据，所以不能清理 handler
            
            if (!message.error)  // 防止无限循环往对方发送 error, 只有在对方无错误时才可以发送
                try { await this.send({ id, error, /* 不能设置 done 清理对面 handler, 理由同上 */ }) } catch { }
            
            // 再往上层抛出错误没有意义了，上层调用栈是 websocket.on('message') 之类的
            console.log(error)
        }
    },
    
    
    /** 调用 remote 中的 func, 适用于最简单的一元 rpc (请求, 响应) */
    async call <TReturn extends any[] = any[]> (func: string, args?: any[]) {
        return new Promise<TReturn>(async (resolve, reject) => {
            const id = genid()
            
            this.handlers.set(id, (message: Message<TReturn>) => {
                const { error, data } = message
                if (error)
                    reject(error)
                else
                    resolve(data)
                this.handlers.delete(id)
            })
            
            await this.send({ id, func, data: args })  // 不需要 done: true, 因为对面的 remote.handlers 中不会有这个 id 的 handler
        })
    }
}


let lastvar: DdbVar


async function _execute (text: string) {
    const { web_url } = server
    
    if (!term) {
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
                        console.log(t('dolphindb 终端被关闭'))
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
    let { printer } = term
    
    const time_start = dayjs()
    
    printer.fire(
        '\r\n' +
        `${time_start.format('YYYY.MM.DD HH:mm:ss.SSS')}  ${connection.name}\r\n`
    )
    
    connection.running = true
    statbar.set_running()
    
    try {
        const obj = await ddb.eval(
            text.replace(/\r\n/g, '\n'),
            {
                listener (message) {
                    const { type, data } = message
                    if (type === 'print')
                        printer.fire(data.replace(/\n/g, '\r\n') + '\r\n')
                    
                    for (const subscriber of dataview.subscribers_repl)
                        subscriber(message, ddb, { decimals: formatter.decimals })
                    
                    for (const subscriber of server.subscribers_repl)
                        subscriber(message, ddb, { decimals: formatter.decimals })
                }
            }
        )
        
        lastvar = new DdbVar({ ...obj, obj, bytes: 0n })
        
        printer.fire(
            (() => {
                switch (obj.form) {
                    case DdbForm.vector:
                    case DdbForm.set:
                    case DdbForm.matrix:
                    case DdbForm.table:
                    case DdbForm.chart:
                        return obj.inspect_type().replace(/\n/g, '\r\n').blue + '\r\n'
                    
                    default: {
                        return obj.type === DdbType.void ?
                                ''
                            :
                                inspect(obj, { decimals: formatter.decimals } as InspectOptions).replace(/\n/g, '\r\n') + '\r\n'
                    }
                }
             })() +
            `(${delta2str(dayjs().diff(time_start))})\r\n`
        )
        
        await connection.update()
    } catch (error) {
        console.log(error)
        printer.fire(`${error.message.replace(/\n/g, '\r\n').red}\r\n`)
    } finally {
        connection.running = false
        statbar.set_idle()
    }
}


const ddb_commands = [
    async function execute () {
        await _execute(get_text('selection or line'))
    },
    
    async function execute_line () {
        await _execute(get_text('line'))
    },
    
    async function execute_selection () {
        await _execute(get_text('selection'))
    },
    
    async function execute_file () {
        await _execute(get_text('all'))
    },
    
    async function cancel () {
        let { connection } = explorer
        
        if (!connection.running)
            return
        
        const answer = await window.showWarningMessage(t('是否取消执行中的任务？'), t('是'), t('否'))
        
        if (answer !== t('是') || !connection.running)
            return
        
        // LOCAL
        // await remote.call('cancel', [connection.name])
        await connection.ddb.cancel()
        
        connection.running = false
        statbar.set_idle()
    },
    
    function set_connection (name: string) {
        explorer.set_connection(name)
    },
    
    function disconnect_connection (connection: DdbConnection) {
        console.log(t('断开 dolphindb 连接:'), connection)
        connection.disconnect()
    },
    
    async function inspect_variable (ddbvar: DdbVar) {
        console.log(t('查看 dolphindb 变量:'), ddbvar)
        lastvar = ddbvar
        await ddbvar.inspect()
    },
    
    async function open_variable (ddbvar: DdbVar = lastvar) {
        console.log(t('在新窗口查看变量:'), ddbvar)
        await ddbvar.inspect(true)
    },
    
    function reload_dataview () {
        const { webview } = dataview.view
        webview.html = webview.html + ' '
    },
    
    async function upload_file () {
        const key_fp_remote = 'dolphindb.fp_remote'
        
        const fp_remote = await window.showInputBox({
            title: t('上传到服务器端的路径'),
            value: extctx.globalState.get(key_fp_remote)
        })
        
        if (!fp_remote)
            return
        
        await window.activeTextEditor.document.save()
        
        extctx.globalState.update(key_fp_remote, fp_remote)
        
        await _upload_file(explorer.connection, fp_remote, get_text('all'))
        
        window.showInformationMessage(t('文件上传成功'))
    },
    
    function set_decimals () {
        formatter.prompt()
    }
]


export async function activate (ctx: ExtensionContext) {
    extctx = ctx
    
    // 命令注册
    for (const func of ddb_commands)
        ctx.subscriptions.push(commands.registerCommand(`dolphindb.${func.name}`, func))
    
    
    // 连接、变量管理
    explorer = new DdbExplorer()
    
    explorer.view = window.createTreeView('dolphindb.explorer', { treeDataProvider: explorer })
    
    formatter.init()
    statbar.init()
    
    // 监听配置，dispatch 修改 event
    workspace.onDidChangeConfiguration(event => {
        formatter.on_config_change(event)
        explorer.on_config_change(event)
    })
    
    
    // 函数补全
    ctx.subscriptions.push(
        languages.registerCompletionItemProvider('dolphindb', {
            provideCompletionItems (doc, pos, canceller, ctx) {
                const keyword = doc.getText(doc.getWordRangeAtPosition(pos))
                
                let fns: string[]
                let _constants: string[]
                
                if (keyword.length === 1) {
                    const c = keyword[0].toLowerCase()
                    fns = funcs.filter((func, i) => funcs_lower[i].startsWith(c))
                    _constants = constants.filter((constant, i) => constants_lower[i].startsWith(c))
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
                    ...keywords.filter(kw => kw.startsWith(keyword))
                        .map(kw => ({ label: kw, kind: CompletionItemKind.Keyword })),
                    
                    ... _constants.map(constant => ({ label: constant, kind: CompletionItemKind.Constant })),
                    
                    ...fns.map(fn => ({ label: fn, kind: CompletionItemKind.Function }) as CompletionItem),
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
                const md = get_func_md(doc.getText(doc.getWordRangeAtPosition(pos)))
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
                let sig = new SignatureInformation(signature, get_func_md(func_name))
                
                for (let param of params)
                    sig.parameters.push(new ParameterInformation(param))
                
                let help = new SignatureHelp()
                help.signatures.push(sig)
                help.activeParameter = index > params.length - 1 ? params.length - 1 : index
                
                return help
            }
        }, '(', ',')
    )
    
    
    // HTTP Server
    server = new DdbServer()
    await server.start()
    
    dataview.register()
    
    console.log(t('DolphinDB 插件已初始化'))
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

const token_ends = new Set(Object.values(token_map))

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
            .map(conn => new DdbConnection(conn))
        
        this.connection = this.connections[0]
        this.connection.iconPath = icon_checked
    }
    
    on_config_change (event: ConfigurationChangeEvent) {
        if (event.affectsConfiguration('dolphindb.connections')) {
            explorer.load_connections()
            explorer.refresher.fire()
        }
    }
    
    set_connection (name: string) {
        for (let connection of this.connections)
            if (connection.name === name) {
                connection.iconPath = icon_checked
                this.connection = connection
            } else
                connection.iconPath = icon_empty
        
        console.log(t('切换连接:'), this.connection)
        
        statbar.set(this.connection.running)
        
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
                const locations = [local, shared].filter(node => node.vars.length)
                return locations.length === 1 ? this.getChildren(locations[0]) : locations
            }
            
            case node instanceof DdbVarLocation: {
                const { scalar, object, pair, vector, set, dict, matrix, table, chart, chunk } = node as DdbVarLocation
                return [scalar, object, pair, vector, set, dict, matrix, table, chart, chunk].filter(node => node.vars.length)
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
    // --- 配置参数
    
    /** 连接名称 (连接 id)，如 local8848, controller, datanode0 */
    name: string
    
    /** 参考 DDB.connect 方法 */
    url: string
    
    autologin: boolean
    
    username: string
    
    password: string
    
    python: boolean
    
    // --- 状态
    
    ddb: DDB
    
    vars: DdbVar[]
    
    // varsmap: Record<string, DdbVar>
    
    local: DdbVarLocation
    
    shared: DdbVarLocation
    
    running = false
    
    
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
        console.log(`${t('连接成功:')} ${this.name}`)
        
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
                    return _type.endsWith('[]') ? DdbType[_type.slice(0, -2)] + 64 : DdbType[_type]
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
                `(${imutables.map(({ name }) => name).join(', ')}, 0)${ this.python ? '.toddb()' : '' }`
            )
            
            for (let i = 0;  i < values.length - 1;  i++)
                imutables[i].obj = values[i]
        }
        
        this.vars = vars_data.map(data => new DdbVar(data))
        
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
        super(shared ? t('共享变量') : t('本地变量'), TreeItemCollapsibleState.Expanded)
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


class DdbVar <TObj extends DdbObj = DdbObj> extends TreeItem {
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
    obj: TObj
    
    
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
                        return ` ${this.rows}r × ${this.cols}c`
                    
                    case DdbForm.dict:
                        return ` ${this.rows} keys`
                    
                    case DdbForm.matrix:
                        return `<${tname}> ${this.rows}r × ${this.cols}c`
                    
                    case DdbForm.object:
                        return ''
                    
                    default:
                        return ` ${DdbForm[this.form]} ${tname}`
                }
            })()
            
            const value = (() => {
                switch (this.form) {
                    case DdbForm.scalar:
                        return ' = ' + format(this.type, this.obj.value, this.obj.le, { colors: false, decimals: formatter.decimals })
                    
                    case DdbForm.pair:
                        return ' = [' +
                            formati(this.obj as DdbObj<DdbVectorValue>, 0, { colors: false, decimals: formatter.decimals }) +
                            ', ' +
                            formati(this.obj as DdbObj<DdbVectorValue>, 1, { colors: false, decimals: formatter.decimals }) +
                        ']'
                    
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
    
    /** - open?: 是否在新窗口中打开 */
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
            { decimals: formatter.decimals },
            ... (this.obj ? [this.obj.pack(), this.obj.le] : [ ]) as [Uint8Array, boolean],
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
                    inspect(this.obj, { colors: false, decimals: formatter.decimals } as InspectOptions)
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
    
    subscribers_repl = [ ] as ((message: DdbMessage, ddb: DDB, options?: InspectOptions) => void)[]
    
    subscribers_inspection = [ ] as ((ddbvar: Partial<DdbVar>, open: boolean, options?: InspectOptions, buffer?: Uint8Array, le?: boolean) => any)[]
    
    
    remote = new Remote ({
        funcs: {
            async subscribe_repl ({ id }, websocket) {
                console.log(t('page 已订阅 repl'))
                
                function subscriber ({ type, data }: DdbMessage, ddb: DDB, options?: InspectOptions) {
                    server.remote.send(
                        {
                            id,
                            data: (() => {
                                switch (type) {
                                    case 'print':
                                    case 'error':
                                        return [type, data]
                                    
                                    case 'object':
                                        return [type, data.pack(), data.le, options]
                                }
                            })()
                        },
                        websocket
                    )
                }
                
                server.subscribers_repl.push(subscriber)
                
                function on_close () {
                    console.log(t('page 的 repl 订阅被关闭，因为 websocket 连接被关闭'))
                    websocket.removeEventListener('close', on_close)
                    server.subscribers_repl = server.subscribers_repl.filter(s => s !== subscriber)
                }
                
                websocket.addEventListener('close', on_close)
            },
            
            async subscribe_inspection ({ id }, websocket) {
                console.log(t('page 已订阅 inspection'))
                
                function subscriber (ddbvar: Partial<DdbVar>, open: boolean, options?: InspectOptions, buffer?: Uint8Array, le?: boolean) {
                    server.remote.send({ id, data: [ddbvar, open, options, buffer, le] }, websocket)
                }
                
                server.subscribers_inspection.push(subscriber)
                
                function on_close () {
                    console.log(t('page 的 inspection 订阅被关闭，因为 websocket 连接被关闭'))
                    websocket.removeEventListener('close', on_close)
                    server.subscribers_inspection = server.subscribers_inspection.filter(s => s !== subscriber)
                }
                
                websocket.addEventListener('close', on_close)
            },
            
            async eval ({ data: [node, script] }: Message<[string, string]>, websocket) {
                let { ddb } = explorer.connections.find(({ name }) => name === node)
                const { buffer, le } = await ddb.eval(script, { parse_object: false })
                return [buffer, le]
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
        
        app.use(this.entry.bind(this))
        
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
        
        app.use(KoaCors({ credentials: true }))
        
        app.use(KoaUserAgent)
        
        app.use(this._router.bind(this))
        
        this.app = app
        
        this.handler = this.app.callback()
        
        this.server_http = createServer(this.handler)
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
                for (const range of workspace.getConfiguration('dolphindb').get<string>('ports').split(',').reverse()) {
                    const [left, right] = range.split('-').map(x => Number(x))
                    
                    if (!right)
                        yield left
                    
                    for (let i = right;  i >= left;  i--)
                        yield i
                }
            else
                for (const range of workspace.getConfiguration('dolphindb').get<string>('ports').split(',')) {
                    const [left, right] = range.split('-').map(x => Number(x))
                    
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


async function _upload_file (connection: DdbConnection, fp_remote: string, ftext: string) {
    if (!connection.connected) {
        connection.disconnect()
        await connection.connect()
    }
    
    const fpd_remote = fp_remote.fdir
    
    const { ddb } = connection
    
    if (!(
        await ddb.call<DdbObj<boolean>>('exists', [fpd_remote])
    ).value)
        await ddb.call('mkdir', [fpd_remote])
    
    await ddb.call('saveTextFile', [ftext, fp_remote])
}


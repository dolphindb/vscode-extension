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
    
    type Event,
    
    type TreeView,
    type TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
} from 'vscode'


import dayjs from 'dayjs'
import { DDB, DdbForm, DdbObj, DdbType } from 'dolphindb'
import WebSocket from 'ws'
import { inspect, set_inspect_options } from 'xshell'


import { t } from './i18n'
import { ddb_constants, ddb_keywords } from './dolphindb.language'

import docs from './docs.json'


set_inspect_options()


const ddb_constants_lower = ddb_constants.map(constant => 
    constant.toLowerCase())

const funcs = Object.keys(docs)
const funcs_lower = funcs.map(func => 
    func.toLowerCase())


type DdbTerminal = Terminal & { printer: EventEmitter<string> }

let ddbext = {
    explorer: null as DdbExplorer,
    shell: null as DdbTerminal,
}


export function activate (ctx: ExtensionContext) {
    for (const func of ext_commands)
        ctx.subscriptions.push(
            commands.registerCommand(`dolphindb.${func.name}`, func)
        )
    
    let explorer = ddbext.explorer = new DdbExplorer()
    
    explorer.view = window.createTreeView('dolphindb.explorer', {
        treeDataProvider: explorer
    })
    
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
        if (!ddbext.shell || ddbext.shell.exitStatus) {
            let printer = new EventEmitter<string>()
            
            await new Promise<void>(resolve => {
                let shell = ddbext.shell = window.createTerminal({
                    name: 'DolphinDB',
                    
                    pty: {
                        open (init_dimensions: TerminalDimensions | undefined) {
                            printer.fire(
                                `DolphinDB Shell\r\n\r\n`
                            )
                            resolve()
                        },
                        
                        close () {
                            console.log('ddbext.shell.close()')
                        },
                        
                        onDidWrite: printer.event,
                    },
                }) as DdbTerminal
                
                shell.printer = printer
                
                ddbext.shell.show(true)
            })
        }
        
        let {
            shell: { printer },
            explorer: { connection },
        } = ddbext
        
        if (!connection.connected) {
            connection.disconnect()
            await connection.connect()
            
            connection.ddb.printer = message => {
                printer.fire(`${message.replace(/\n/g, '\r\n')}\r\n`)
            }
        }
        
        let { ddb } = connection
        
        try {
            printer.fire(
                `\r\n${dayjs().format('YYYY.MM.DD HH:mm:ss.SSS')}  ${connection.name}\r\n`
            )
            
            const obj = await ddb.eval(
                get_text('selection or line').replace(/\r\n/g, '\n')
            )
            
            printer.fire(
                `${inspect(obj).replace(/\n/g, '\r\n')}\r\n`
            )
        } catch (error) {
            printer.fire(
                `${error.message.red}\r\n`
            )
        }
        
        await connection.update()
    },
    
    async function set_connection (name: string) {
        ddbext.explorer.set_connection(name)
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


class DdbExplorer implements TreeDataProvider<TreeItem> {
    view: TreeView<TreeItem>
    
    refresher: EventEmitter<TreeItem | undefined | void> = new EventEmitter<TreeItem | undefined | void>()
    
    onDidChangeTreeData: Event<void | TreeItem> = this.refresher.event
    
    connections: DdbConnection[]
    
    connection: DdbConnection
    
    constructor () {
        this.load_connections()
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
        this.connection.iconPath = new ThemeIcon('pass-filled')
    }
    
    set_connection (name: string) {
        for (let connection of this.connections)
            if (connection.name === name) {
                connection.iconPath = new ThemeIcon('pass-filled')
                this.connection = connection
            } else
                connection.iconPath = new ThemeIcon('circle-large-outline')
        
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
                const { scalar, vector, pair, matrix, set, dict, table, chart, chunk } = node as DdbVarLocation
                return [scalar, vector, pair, matrix, set, dict, table, chart, chunk].filter(node => 
                    node.vars.length
                )
            }
            
            case node instanceof DdbVarForm:
                return (node as DdbVarForm).vars
        }
    }
}


class DdbConnection extends TreeItem {
    /** 连接名称 (连接 id)，如 local8848, controller, datanode0 */
    name: string
    
    /** 参考 DDB.connect 方法 */
    url: string
    
    login: boolean
    
    username: string
    
    password: string
    
    python: boolean
    // ---
    
    
    ddb: DDB
    
    vars: DdbVar[]
    
    varsmap: Record<string, DdbVar>
    
    local: DdbVarLocation
    
    shared: DdbVarLocation
    
    
    get connected () {
        return this.ddb?.websocket?.readyState === WebSocket.OPEN
    }
    
    
    constructor (data: Partial<DdbConnection>) {
        super(`${data.name} `, TreeItemCollapsibleState.None)
        
        Object.assign(this, data)
        
        this.description = this.url
        this.iconPath = new ThemeIcon('circle-large-outline')
        
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
        ddbext.explorer.refresher.fire(this)
    }
    
    
    disconnect () {
        this.ddb?.disconnect()
        this.collapsibleState = TreeItemCollapsibleState.None
        ddbext.explorer.refresher.fire(this)
    }
    
    
    async update () {
        const objs = this.python ?
            await this.ddb.eval('objs(True)')
        :
            await this.ddb.call('objs', [true])
        
        if (this.ddb?.websocket.readyState === WebSocket.OPEN && this.collapsibleState === TreeItemCollapsibleState.None)
            this.collapsibleState = TreeItemCollapsibleState.Expanded
        
        let rows = objs.to_rows()
            .map(row => {
                const _type = (row.type as string).toLowerCase()
                row.type = DdbType[_type] ?? _type
                
                let _form = (row.form as string).toLowerCase()
                if (_form === 'dictionary')
                    _form = 'dict'
                row.form = DdbForm[_form] ?? _form
                
                row.cols = row.columns
                delete row.columns
                
                return row
            })
        
        let light_rows = rows.filter(row =>
            row.bytes < 4096n)
        
        if (light_rows.length) {
            const { value: values } = await this.ddb.eval<DdbObj<DdbObj[]>>(
                '(' +
                    light_rows.map(row => 
                        row.name
                    ).join(', ') + 
                `, 0)`
            )
            
            for (let i = 0;  i < values.length - 1;  i++)
                light_rows[i].value = values[i]
        }
        
        this.vars = rows.map(row => 
            new DdbVar(row)
        )
        
        this.varsmap = this.vars.reduce<Record<string, any>>((acc, row) => {
                acc[row.name] = row
                return acc
            }, { })
        
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
        
        ddbext.explorer.refresher.fire(this)
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
    
    
    constructor (connection: DdbConnection, shared: boolean) {
        super(
            shared ? '共享变量' : '本地变量',
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
    }
    
    update (vars: DdbVar[]) {
        this.vars = vars
    }
}


class DdbVar<T extends DdbObj = DdbObj> extends TreeItem {
    name: string
    
    form: DdbForm
    
    type: DdbType
    
    rows: number
    
    cols: number
    
    bytes: bigint
    
    shared: boolean
    
    extra: string
    
    value?: T
    
    
    constructor (data: Partial<DdbVar>) {
        super(data.name, TreeItemCollapsibleState.None)
        
        Object.assign(this, data)
        
        this.label = 
            this.name +
            ' = ' +
            (this.value ? 
                inspect(this.value, { colors: false, compact: true })
            :
                `${this.get_value_type()}(${Number(this.bytes).to_fsize_str()})`
            )
        
        this.tooltip = inspect(this.value, { colors: false })
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
                return `table[${this.rows} rows][${this.cols} cols]`
            
            case DdbForm.dict:
                return `dict[${this.rows}]`
            
            case DdbForm.matrix:
                return `matrix[${this.rows} rows][${this.cols} cols]`
            
            default:
                return `${DdbForm[this.form]} ${tname}`
        }
    }
}


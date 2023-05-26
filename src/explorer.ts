import {
    window,
    workspace,
    
    commands,
    
    ThemeIcon,
    
    EventEmitter, type Event,
    
    type TreeView, TreeItem, TreeItemCollapsibleState, type TreeDataProvider, type ProviderResult,
    
    type CancellationToken,
    
    type ConfigurationChangeEvent, 
    
    ProgressLocation,
} from 'vscode'

import { inspect, assert, defer, delay } from 'xshell'

import {
    DDB,
    DdbForm,
    DdbObj,
    DdbType,
    DdbFunctionType,
    format, formati,
    type DdbFunctionDefValue,
    type DdbVectorValue,
    type InspectOptions,
    type DdbOptions,
} from 'dolphindb'


import { t } from './i18n/index.js'
import { dev, fpd_root, fpd_ext, type DdbMessageItem } from './index.js'
import { statbar } from './statbar.js'
import { formatter } from './formatter.js'
import { server } from './server.js'
import { dataview } from './dataview/dataview.js'
import { open_connection_settings } from './commands.js'


let icon_empty: string
let icon_checked: string


export class DdbExplorer implements TreeDataProvider<TreeItem> {
    view: TreeView<TreeItem>
    
    refresher: EventEmitter<TreeItem | undefined | void> = new EventEmitter<TreeItem | undefined | void>()
    
    onDidChangeTreeData: Event<void | TreeItem> = this.refresher.event
    
    single_connection_mode: boolean = false
    
    /** 从 dolphindb.connections 连接配置生成的，在面板中的显示所有连接  
        每个连接维护了一个 ddb api 的实际连接，当出错需要重置时，需要用新的连接替换出错连接 */
    connections: DdbConnection[]
    
    /** 当前选中的连接 */
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
        
        const config = workspace.getConfiguration('dolphindb')
        
        this.single_connection_mode = config.get<boolean>('single_connection_mode')
        
        this.connections = config
            .get<{ url: string, name?: string }[]>('connections')
            .map(({ url, name, ...options }) => new DdbConnection(url, name, options))
        
        this.connection = this.connections[0]
        if (this.connection)
            this.connection.iconPath = icon_checked
    }
    
    
    on_config_change (event: ConfigurationChangeEvent) {
        if (event.affectsConfiguration('dolphindb.connections') || event.affectsConfiguration('dolphindb.single_connection_mode')) {
            explorer.load_connections()
            explorer.refresher.fire()
        }
    }
    
    
    /** 执行连接操作后，如果超过 1s 还未完成，则显示进度 */
    async connect (connection: DdbConnection) {
        connection.iconPath = icon_checked
        this.connection = connection
        
        for (let _connection of this.connections)
            if (_connection !== connection) {
                _connection.iconPath = icon_empty
                
                if (this.single_connection_mode && _connection.connected)
                    this.disconnect(_connection)
            }
        
        
        console.log(t('连接:'), connection)
        statbar.update()
        this.refresher.fire()
        
        let done = false
        
        const pconnect = (async () => {
            try {
                await connection.connect()
                await connection.update()
            } finally {
                // 先在这里更新 done, 等后面 catch 了错误处理之后，可能会重试连接，会包含下一个连接进度
                done = true
                
                statbar.update()
                this.refresher.fire(connection)
                this.view.reveal(connection, { expand: 3 })
            }
        })()
        
        // 1s 还未完成，则显示进度
        ;(async () => {
            await delay(1000)
            
            if (!done)
                try {
                    await window.withProgress({
                        cancellable: false,
                        title: t('正在连接'),
                        location: ProgressLocation.Notification,
                    }, async (progress, token) => {
                        progress.report({ message: `${connection.name} (${connection.url})` })
                        return pconnect
                    })
                } catch {
                    // 忽略错误，下面已经 await pconnect 了
                }
        })()
        
        
        try {
            await pconnect
        } catch (error) {
            const answer = await window.showErrorMessage<DdbMessageItem>(
                error.message,
                {
                    detail: 
                        (connection.connected ?
                            t('数据库连接被断开，请检查网络是否稳定、网络转发节点是否会自动关闭 websocket 长连接、server 日志\n')
                        :
                            t('连接数据库失败，当前连接配置为:\n') +
                            inspect(
                                {
                                    name: connection.name,
                                    url: connection.url,
                                    ... connection.options
                                },
                                { colors: false }
                            ) + '\n' +
                            t('先尝试用浏览器访问对应的 server 地址，如: {{url}}\n', { url: connection.url.replace(/^ws(s?):\/\//, 'http$1://') }) +
                            t('如果可以打开网页且正常登录使用，再检查:\n') +
                            t('- 执行 `version()` 函数，返回的 DolphinDB Server 版本应不低于 `1.30.16` 或 `2.00.4`\n') +
                            t('- 如果有配置系统代理，则代理软件以及代理服务器需要支持 WebSocket 连接，否则请在系统中关闭代理，或者将 DolphinDB Server IP 添加到排除列表，然后重启 VSCode\n')) +
                        t('调用栈:\n') +
                        error.stack,
                    modal: true
                },
                {
                    title: t('确认'),
                    isCloseAffordance: true
                },
                {
                    title: t('重连'),
                    async action () {
                        await explorer.reconnect(connection)
                    },
                },
                ... connection.connected ? [ ] : [
                    {
                        title: t('编辑配置'),
                        async action () {
                            await open_connection_settings()
                        },
                    }
                ]
            )
            
            await answer?.action?.()
            
            throw error
        }
    }
    
    
    disconnect (connection: DdbConnection) {
        console.log(t('断开 dolphindb 连接:'), connection)
        
        /** 如果断开的是当前选中的连接，那么断开连接后恢复选中状态 */
        const selected = connection.name === this.connection.name
        
        connection.disconnect()
        
        const index = this.connections.findIndex(conn => conn === connection)
        if (index === -1)
            return
        
        this.connections[index] = new DdbConnection(connection.url, connection.name, connection.options)
        
        if (selected) {
            this.connection = this.connections.find(conn => conn.name === connection.name)
            this.connection.iconPath = icon_checked
        }
        
        statbar.update()
        this.refresher.fire()
    }
    
    
    async reconnect (connection: DdbConnection) {
        console.log(t('重连连接:'), connection)
        explorer.disconnect(connection)
        await explorer.connect(
            explorer.connections.find(conn => conn.name === connection.name)
        )
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
                return [local, shared].filter(node => node.vars.length)
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


/** 连接、变量管理 */
export let explorer: DdbExplorer




const pyobjs = new Set(['list', 'tuple', 'dict', 'set', '_ddb', 'Exception', 'AssertRaise', 'PyBox'])


/** 维护一个 ddb api 连接 */
export class DdbConnection extends TreeItem {
    /** 连接名称 (连接 id)，如 local8848, controller, datanode0 */
    name: string
    
    url: string
    
    /** 这里设置的值为默认值，需要和 webpack 中的属性默认值保持一致 */
    options: DdbOptions = {
        autologin: true,
        
        username: 'admin',
        
        password: '123456',
        
        python: false,
        
        verbose: false,
    }
    
    // --- 状态
    
    ddb: DDB
    
    /** 和 ddb.connected 含义不同，这里表示是否连接成功过，用来区分错误提示 */
    connected = false
    
    /** 是否调用了 connection.disconnect */
    disconnected = false
    
    vars: DdbVar[]
    
    // varsmap: Record<string, DdbVar>
    
    local: DdbVarLocation
    
    shared: DdbVarLocation
    
    running = false
    
    
    constructor (url: string, name: string = url, options: DdbOptions = { }) {
        super(`${name} `, TreeItemCollapsibleState.None)
        
        try {
            assert(
                url && typeof url === 'string' && (url.startsWith('ws://') || url.startsWith('wss://')),
                t('dolphindb 连接配置中的 url 非法: url 应该非空，类型是字符串，且以 ws:// 或 wss:// 开头')
            )
            
            this.url = url
        } catch (error) {
            window.showErrorMessage(error.message)
            throw error
        }
        
        this.name = name
        
        for (const key in this.options) {
            const value = options[key]
            if (value !== undefined)
                this.options[key] = value
        }
        
        this.description = this.url
        this.iconPath = icon_empty
        this.contextValue = 'disconnected'
        
        this.ddb = new DDB(this.url, this.options)
        
        this.command = {
            command: 'dolphindb.connect',
            title: 'dolphindb.connect',
            arguments: [this],
        }
        
        this.local = new DdbVarLocation(this, false)
        this.shared = new DdbVarLocation(this, true)
    }
    
    
    /** 调用 this.ddb.connect(), 确保和数据库的连接是正常的，更新连接显示状态 */
    async connect () {
        if (this.ddb.connected && /* 有可能 websocket 连接成功但 login 失败 */ this.connected)  // 这个方法后面有些操作会有副作用，已连接的话直接跳过吧
            return
        
        await this.ddb.connect()
        
        console.log(`${t('连接成功:')} ${this.name}`)
        this.connected = true
        this.description = this.url + ' ' + t('已连接')
        
        this.collapsibleState = TreeItemCollapsibleState.Expanded
        this.contextValue = 'connected'
    }
    
    
    disconnect () {
        this.ddb.disconnect()
        this.disconnected = true
        this.collapsibleState = TreeItemCollapsibleState.None
        this.contextValue = 'disconnected'
        this.description = this.url
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
         ``` */
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
            })).filter(v => 
                v.name !== 'pnode_run' && 
                !(v.form === DdbForm.object && pyobjs.has(v.name))
            )
        
        let immutables = vars_data.filter(v => v.form === DdbForm.scalar || v.form === DdbForm.pair)
        
        if (immutables.length) {
            const { value: values } = await this.ddb.eval<DdbObj<DdbObj[]>>(
                `(${immutables.map(({ name }) => name).join(', ')}, 0)${ this.options.python ? '.toddb()' : '' }`
            )
            
            for (let i = 0, len = values.length - 1;  i < len;  i++)
                immutables[i].obj = values[i]
        }
        
        this.vars = vars_data.map(data => new DdbVar(data))
        
        // this.varsmap = this.vars.reduce<Record<string, any>>((acc, row) => {
        //         acc[row.name] = row
        //         return acc
        //     }, { })
        
        // console.log(this.varsmap)
        
        let locals: DdbVar[] = [ ]
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
    static form_names = {
        [DdbForm.scalar]: t('标量'),
        [DdbForm.vector]: t('向量'),
        [DdbForm.pair]: t('数对'),
        [DdbForm.matrix]: t('矩阵'),
        [DdbForm.set]: t('集合'),
        [DdbForm.dict]: t('词典'),
        [DdbForm.table]: t('表格'),
        [DdbForm.chart]: t('绘图'),
        [DdbForm.object]: t('对象'),
    } as const
    
    
    connection: DdbConnection
    
    shared: boolean
    
    form: DdbForm
    
    vars: DdbVar[]
    
    
    constructor (connection: DdbConnection, shared: boolean, form: DdbForm) {
        super(DdbVarForm.form_names[form] || DdbForm[form], TreeItemCollapsibleState.Expanded)
        this.connection = connection
        this.shared = shared
        this.form = form
        this.iconPath = `${ dev ? fpd_root : fpd_ext }icons/${DdbForm[form]}.svg`
    }
    
    
    update (vars: DdbVar[]) {
        this.vars = vars
    }
}


export class DdbVar <TObj extends DdbObj = DdbObj> extends TreeItem {
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
                        return `<${ 64 <= this.type && this.type < 128 ? `${DdbType[this.type - 64]}[]` : tname }> ${this.rows} ${t('个元素')}`
                    
                    case DdbForm.set:
                        return `<${tname}> ${this.rows} ${t('个元素')}`
                    
                    case DdbForm.table:
                        return ` ${this.rows} ${t('行')} ${this.cols} ${t('列')}`
                    
                    case DdbForm.dict:
                        return ` ${this.rows} ${t('个键')}`
                    
                    case DdbForm.matrix:
                        return `<${tname}> ${this.rows} ${t('行')} ${this.cols} ${t('列')}`
                    
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
                        return ` (${Number(this.bytes).to_fsize_str()})`
                }
            })()
            
            return this.name + type + value
        })()
        
        // scalar, pair 不显示 inspect actions, 作特殊区分
        this.contextValue = DdbVar.contexts[this.form] || 'var'
        
        this.iconPath = DdbVar.icon
        
        this.command = {
            title: 'dolphindb.inspect_variable',
            command: 'dolphindb.inspect_variable',
            arguments: [this],
        }
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
        if (open) {
            if (!server.subscribers_inspection.length) {
                dataview.ppage = defer<void>()
                
                await commands.executeCommand('vscode.open', server.web_url)
                
                await dataview.ppage
            }
        } else {
            // 遇到 dataview 还未加载时，先等待其加载，再 inspect 变量
            if (!dataview.view)
                await commands.executeCommand('workbench.view.extension.ddbpanel')
            
            await dataview.pwebview
            
            dataview.view.show(true)
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


export function register_explorer () {
    icon_empty = `${ dev ? fpd_root : fpd_ext }icons/radio.empty.svg`
    icon_checked = `${ dev ? fpd_root : fpd_ext }icons/radio.checked.svg`
    
    explorer = new DdbExplorer()
    explorer.view = window.createTreeView('dolphindb.explorer', { treeDataProvider: explorer })
}

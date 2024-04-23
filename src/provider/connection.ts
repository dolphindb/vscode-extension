import {
    window,
    
    commands,
    
    ThemeIcon,
    
    EventEmitter, type Event,
    
    type TreeView, TreeItem, TreeItemCollapsibleState, type TreeDataProvider, type ProviderResult,
    
    ProgressLocation,
} from 'vscode'


import dayjs from 'dayjs'

import { inspect, assert, defer, delay } from 'xshell'

import {
    DDB,
    SqlStandard,
    DdbForm,
    DdbObj,
    DdbType,
    DdbFunctionType,
    format, formati,
    type DdbFunctionDefValue,
    type DdbVectorValue,
    type InspectOptions,
    type DdbOptions,
    type DdbTableObj,
} from 'dolphindb'


import { t } from '../i18n/index.js'
import { fpd_ext, type DdbMessageItem } from '../index.js'
import { statbar } from '../statbar.js'
import { formatter } from '../formatter.js'
import { server, start_server } from '../server.js'
import { dataview } from '../dataview/dataview.js'
import { open_connection_settings } from '../commands.js'
import { icon_checked, icon_empty, model } from '../model.js'


export class DdbConnectionProvider implements TreeDataProvider<TreeItem> {
    view: TreeView<TreeItem>
    
    refresher: EventEmitter<TreeItem | undefined | void> = new EventEmitter<TreeItem | undefined | void>()
    
    onDidChangeTreeData: Event<void | TreeItem> = this.refresher.event
    
    
    getParent (element: TreeItem): ProviderResult<TreeItem> {
        if (element instanceof DdbConnectionProvider)
            return
        
        if (element instanceof DdbConnection)
            return connection_provider.view
    }
    
    
    /** 执行连接操作后，如果超过 1s 还未完成，则显示进度 */
    async connect (connection: DdbConnection) {
        connection.iconPath = icon_checked
        model.connection = connection
        
        for (let _connection of model.connections)
            if (_connection !== connection) {
                _connection.iconPath = icon_empty
                
                if (model.single_connection_mode && _connection.connected)
                    this.disconnect(_connection)
            }
        
        model.change_language_mode()
        
        console.log(t('连接:'), connection)
        statbar.update()
        this.refresher.fire()
        
        
        
        let done = false
        
        const pconnect = (async () => {
            try {
                await connection.connect()
                await connection.check_license_expiration()
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
            const { autologin, username, password, python, sql } = connection.options
            
            const answer = await window.showErrorMessage<DdbMessageItem>(
                error.message,
                {
                    detail: 
                        ((connection.connected ?
                            t('数据库连接被断开，请检查网络是否稳定、网络转发节点是否会自动关闭 websocket 长连接、server 日志\n')
                        :
                            t('连接数据库失败，当前连接的一部分配置如下:\n') +
                            inspect(
                                {
                                    name: connection.name,
                                    url: connection.url,
                                    autologin,
                                    username,
                                    password,
                                    python, 
                                    sql
                                },
                                { colors: false, compact: true }
                            ) + '\n' +
                            t('先尝试用浏览器访问对应的 server 地址，如: {{url}}\n', { url: connection.url.replace(/^ws(s?):\/\//, 'http$1://') }) +
                            t('如果可以打开网页且正常登录使用，再检查:\n') +
                            t('- 执行 `version()` 函数，返回的 DolphinDB Server 版本应不低于 `1.30.16` 或 `2.00.4`\n') +
                            t('- 如果有配置系统代理，则代理软件以及代理服务器需要支持 WebSocket 连接，否则请在系统中关闭代理，或者将 DolphinDB Server IP 添加到排除列表，然后重启 VSCode\n')) +
                        t('调用栈:\n') +
                        error.stack).slice(0, 600),
                    modal: true
                },
                {
                    title: t('确认'),
                    isCloseAffordance: true
                },
                {
                    title: t('重连'),
                    async action () {
                        await connection_provider.reconnect(connection)
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
        
        const { name, url, options } = connection
        
        /** 如果断开的是当前选中的连接，那么断开连接后恢复选中状态 */
        const selected = name === model.connection.name
        
        connection.disconnect()
        
        const index = model.connections.findIndex(conn => conn === connection)
        if (index === -1)
            return
        
        model.connections[index] = new DdbConnection(url, name, options)
        
        if (selected) {
            model.connection = model.connections.find(conn => conn.name === name)
            model.connection.iconPath = icon_checked
        }
        
        statbar.update()
        this.refresher.fire()
    }
    
    
    async reconnect (connection: DdbConnection) {
        console.log(t('重连连接:'), connection)
        connection_provider.disconnect(connection)
        await connection_provider.connect(
            model.connections.find(conn => conn.name === connection.name)
        )
    }
    
    
    getTreeItem (node: TreeItem): TreeItem | Thenable<TreeItem> {
        return node
    }
    
    
    getChildren (node?: TreeItem) {
        // switch (true) {
        //     case !node:
        //         return this.connections
                
        //     case node instanceof DdbConnection: {
        //         const { local, shared } = node as DdbConnection
        //         return [local, shared].filter(node => node.vars.length)
        //     }
            
        //     case node instanceof DdbVarLocation: {
        //         const { scalar, object, pair, vector, set, dict, matrix, table, chart, chunk } = node as DdbVarLocation
        //         return [scalar, object, pair, vector, set, dict, matrix, table, chart, chunk].filter(node => node.vars.length)
        //     }
            
        //     case node instanceof DdbVarForm:
        //         return (node as DdbVarForm).vars
        // }
        return node ? null : model.connections
    }
}


export let connection_provider: DdbConnectionProvider


const pyobjs = new Set(['list', 'tuple', 'dict', 'set', '_ddb', 'Exception', 'AssertRaise', 'PyBox'])


enum LicenseTypes {
    /** 其他方式 */
    Other = 0,
    
    /** 机器指纹绑定 */
    MachineFingerprintBind = 1,
    
    /** 在线验证 */
    OnlineVerify = 2,
    
    /** LicenseServer 验证 */
    LicenseServerVerify = 3,
}


interface DdbLicense {
    authorization: string
    licenseType: LicenseTypes
    maxMemoryPerNode: number
    maxCoresPerNode: number
    clientName: string
    bindCPU: boolean
    expiration: number
    maxNodes: number
    version: string
    modules: bigint
}


/** 维护一个 ddb api 连接 */
export class DdbConnection extends TreeItem {
    /** 连接名称 (连接 id)，如 local8848, controller, datanode0 */
    name: string
    
    url: string
    
    /** 这里设置的值为默认值，需要和 webpack 中的属性默认值保持一致 */
    options: DdbOptions & {
        mappings: Record<string, string>
    } = {
        autologin: true,
        
        username: 'admin',
        
        password: '123456',
        
        python: false,
        
        sql: SqlStandard.DolphinDB,
        
        verbose: false,
        
        mappings: null
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
    
    mappings: Record<string, string>
    
    load_table_variable_schema_defined = false
    
    
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
        
        this.mappings = this.options.mappings
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
        
        this.contextValue = 'connected'
    }
    
    
    disconnect () {
        this.ddb.disconnect()
        this.disconnected = true
        this.contextValue = 'disconnected'
        this.description = this.url
        connection_provider.refresher.fire(this)
    }
    
    
    async define_load_table_variable_schema () {
        if (this.load_table_variable_schema_defined)
            return
        
        await this.ddb.eval(
            'def load_table_variable_schema (table_name) {\n' +
            '    return schema(objByName(table_name))\n' +
            '}\n'
        )
        
        this.load_table_variable_schema_defined = true
    }
    
    
    async check_license_expiration () {
        const license = (
            await this.ddb.call<DdbTableObj>('license')
        ).to_dict<DdbLicense>({ strip: true })
        
        // license.expiration 是以 date 为单位的数字
        const expiration_date = dayjs(license.expiration * 86400000)
        const now = dayjs()
        const after_two_week = now.add(2, 'week')
        const is_license_expired = now.isAfter(expiration_date, 'day')
        const is_license_expire_soon = after_two_week.isAfter(expiration_date, 'day')
        
        // 不用等 showErrorMessage 的 result
        if (is_license_expired) 
            window.showErrorMessage(t('DolphinDB License 已过期，请联系管理人员立即更新，避免数据库关闭'))
        else if (is_license_expire_soon)
            window.showWarningMessage(t('DolphinDB License 将在两周内过期，请提醒管理人员及时更新，避免数据库过期后自动关闭'))
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
            
            for (let i = 0, len = values.length - 1;  i < len;  i++) {
                immutables[i].obj = values[i]
                
                // 此处需要用变量值的类型来替换 objs(true) 中获取的变量的类型，因为当变量类型为 string 且变量值很长时，server 返回的变量值的类型是 blob
                immutables[i].type = values[i].type
            }
                
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
        
        connection_provider.refresher.fire(this)
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
        this.iconPath = `${fpd_ext}icons/${DdbForm[form]}.svg`
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
        [DdbForm.table]: 'table',
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
    
    /**  - open?: 是否在新窗口中打开 
         - schema?: 是否是查看表结构 */
    async inspect (open = false, schema = false) {
        if (open) {
            if (!server)
                await start_server()
            
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
        
        let obj = this.obj
        
        if (schema) {
            await model.connection.define_load_table_variable_schema()
            obj = await this.ddb.call('load_table_variable_schema', [this.name])
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
            ... (obj ? [obj.pack(), obj.le] : [null, DdbObj.le_client]) as [Uint8Array, boolean],
        ] as const
        
        
        for (const subscriber of dataview.subscribers_inspection)
            subscriber(...args)
        
        if (server)
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


export function register_connection_provider () {
    connection_provider = new DdbConnectionProvider()
    connection_provider.view = window.createTreeView('dolphindb.connection', { treeDataProvider: connection_provider })
}

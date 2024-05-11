import {
    window,
    EventEmitter, 
    TreeItem, 
    TreeItemCollapsibleState, 
    ProgressLocation,
    workspace,
    type Event,
    type TreeView, 
    type TreeDataProvider,
    type ConfigurationChangeEvent,
    languages,
} from 'vscode'


import dayjs from 'dayjs'

import { inspect, assert, delay, strcmp } from 'xshell'

import {
    DDB,
    SqlStandard,
    DdbForm,
    type DdbObj,
    DdbType,
    type DdbOptions,
    type DdbTableObj,
    type DdbVectorStringObj,
    DdbFunctionType,
} from 'dolphindb'


import { t } from '../i18n/index.js'

import { statbar } from './statbar.js'
import { open_connection_settings } from './commands.js'

import { type DdbNode, NodeType, type DdbLicense, pyobjs, DdbNodeState } from './constant.js'

import { DdbVar, DdbVarLocation, variables } from './variables.js'
import { DdbDatabase, DdbGroup, DdbTable, databases } from './databases.js'

import { fpd_ext, type DdbMessageItem } from './index.js'


let icon_empty: string
let icon_checked: string


export class DdbConnector implements TreeDataProvider<TreeItem> {
    view: TreeView<TreeItem>
    
    refresher: EventEmitter<TreeItem | undefined | void> = new EventEmitter<TreeItem | undefined | void>()
    
    onDidChangeTreeData: Event<void | TreeItem> = this.refresher.event
    
    single_connection_mode: boolean = false
    
    /** 从 dolphindb.connections 连接配置生成的，在面板中的显示所有连接  
        每个连接维护了一个 ddb api 的实际连接，当出错需要重置时，需要用新的连接替换出错连接 */
    connections: DdbConnection[]
    
    /** 当前选中的连接 */
    connection: DdbConnection
    
    /** 上传模块是否加密 */
    encrypt?: boolean | undefined
    
    
    constructor () {
        this.load_connections()
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
        
        this.change_language_mode()
        
        console.log(t('连接:'), connection)
        statbar.update()
        this.refresher.fire()
        
        let done = false
        
        const pconnect = (async () => {
            try {
                await connection.connect()
                await connection.check_license_expiration()
                await connection.update(true)
            } finally {
                // 先在这里更新 done, 等后面 catch 了错误处理之后，可能会重试连接，会包含下一个连接进度
                done = true
                
                statbar.update()
                this.refresh(true)
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
                        await connector.reconnect(connection)
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
        const selected = name === this.connection.name
        
        connection.disconnect()
        
        const index = this.connections.findIndex(conn => conn === connection)
        if (index === -1)
            return
        
        this.connections[index] = new DdbConnection(url, name, options)
        
        if (selected) {
            this.connection = this.connections.find(conn => conn.name === name)
            this.connection.iconPath = icon_checked
        }
        
        statbar.update()
        this.refresh(true)
    }
    
    
    async reconnect (connection: DdbConnection) {
        console.log(t('重连连接:'), connection)
        connector.disconnect(connection)
        await connector.connect(
            this.connections.find(conn => conn.name === connection.name)
        )
    }
    
    
    getTreeItem (node: TreeItem): TreeItem | Thenable<TreeItem> {
        return node
    }
    
    
    getChildren (node?: TreeItem) {
        return node ? null : this.connections
    }
    
    load_connections () {
        if (this.connections)
            for (const connection of this.connections)
                connection.disconnect()
        
        const config = workspace.getConfiguration('dolphindb')
        
        this.single_connection_mode = config.get<boolean>('single_connection_mode')
        
        this.connections = config
            .get<{ url: string, name?: string, sql?: string }[]>('connections')
            .map(({ url, name, ...options }) =>
                // 传入的 config 中 sql 为 string 类型，需要将其转换为对应的 SqlStandard 类型
                new DdbConnection(url, name, {
                    ...options,
                    sql: SqlStandard[options.sql] as SqlStandard,
                })
            )
        
        this.connection = this.connections[0]
        if (this.connection)
            this.connection.iconPath = icon_checked
        
        this.change_language_mode()
    }
    
    
    on_config_change (event: ConfigurationChangeEvent) {
        if (event.affectsConfiguration('dolphindb.connections') || event.affectsConfiguration('dolphindb.single_connection_mode')) {
            this.load_connections()
            this.refresh(true)
        }
    }
    
    
    change_language_mode () {
        const languageId = window.activeTextEditor?.document?.languageId
        const { python } = this.connection.options
        
        if ((languageId === 'dolphindb' && python) || (languageId === 'dolphindb-python' && !python))
            languages.setTextDocumentLanguage(
                window.activeTextEditor.document,
                python ? 'dolphindb-python' : 'dolphindb'
            )
    }
    
    refresh (database: boolean) {
        this.refresher.fire()
        variables.refresher.fire()
        if (database)
            databases.refresher.fire()
    }
}


export let connector: DdbConnector


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
    
    /** server 版本号, 格式为 x.x.x.x */
    version: string
    
    /** 和 ddb.connected 含义不同，这里表示是否连接成功过，用来区分错误提示 */
    connected = false
    
    /** 是否调用了 connection.disconnect */
    disconnected = false
    
    children: Array<DdbGroup | DdbDatabase> = [ ]
    
    vars: DdbVar[]
    
    // varsmap: Record<string, DdbVar>
    
    local: DdbVarLocation
    
    shared: DdbVarLocation
    
    running = false
    
    mappings: Record<string, string>
    
    load_table_variable_schema_defined = false
    
    get_csv_content_defined = false
    
    load_table_schema_defined = false
    
    load_database_schema_defined = false
    
    peek_table_defined = false
    
    // --- 通过 getClusterPerf 拿到的集群节点信息
    nodes: DdbNode[]
    
    node: DdbNode
    
    /** 控制节点 */
    controller: DdbNode
    
    /** 通过 getClusterPerf 取集群中的某个数据节点，方便后续 rpc 到数据节点执行操作 */
    datanode: DdbNode
    
    node_type: NodeType
    
    /** 通过 getControllerAlias 得到 */
    controller_alias: string
    
    node_alias: string
    
    
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
        
        this.local = new DdbVarLocation(false)
        this.shared = new DdbVarLocation(true)
    }
    
    
    /** 调用 this.ddb.connect(), 确保和数据库的连接是正常的，更新连接显示状态 */
    async connect () {
        if (this.ddb.connected && /* 有可能 websocket 连接成功但 login 失败 */ this.connected)  // 这个方法后面有些操作会有副作用，已连接的话直接跳过吧
            return false
        
        await this.ddb.connect()
        
        await Promise.all([
            this.get_node_type(),
            this.get_node_alias(),
            this.get_controller_alias(),
            this.get_formatted_version()
        ])
        await this.get_cluster_perf()
        
        console.log(`${t('连接成功:')} ${this.name}`)
        this.connected = true
        this.description = this.url + ' ' + t('已连接')
        
        this.contextValue = 'connected'
        
        return true
    }
    
    
    disconnect () {
        this.ddb.disconnect()
    }
    
    
    async define_load_table_variable_schema () {
        if (!this.load_table_variable_schema_defined) {
            await this.ddb.eval(
                this.options.python ?
                    ('def load_table_variable_schema (table_name):\n' +
                    '    return schema(objByName(table_name))\n')
                :
                    ('def load_table_variable_schema (table_name) {\n' +
                    '    return schema(objByName(table_name))\n' +
                    '}\n')
            )
            
            this.load_table_variable_schema_defined = true
        }
    }
    
    
    async define_peek_table () {
        if (!this.peek_table_defined) {
            await this.ddb.eval(
                this.options.python ?
                    ('def peek_table (db_path, tb_name):\n' +
                    '    return select top 100 * from loadTable(db_path, tb_name)\n')
                :
                    ('def peek_table (db_path, tb_name) {\n' +
                    '    return select top 100 * from loadTable(db_path, tb_name)\n' +
                    '}\n')
            )
            
            this.peek_table_defined = true
        }
    }
        
    
    async define_load_table_schema () {
        if (!this.load_table_schema_defined) {
            await this.ddb.eval(
                this.options.python ?
                    ('def load_table_schema (db_path, tb_name):\n' +
                    '    return schema(loadTable(db_path, tb_name))\n')
                :
                    ('def load_table_schema (db_path, tb_name) {\n' +
                    '    return schema(loadTable(db_path, tb_name))\n' +
                    '}\n')
            )
            
            this.load_table_schema_defined = true
        }
    }
    
    
    async define_load_database_schema () {
        if (!this.load_database_schema_defined) {
            await this.ddb.eval(
                this.options.python ?
                    'def load_database_schema (db_path):\n' +
                    '    return schema(database(db_path))\n'
                :
                    'def load_database_schema (db_path) {\n' +
                    '    return schema(database(db_path))\n' +
                    '}\n'
            )
            
            this.load_database_schema_defined = true
        }
    }
    
    
    async define_get_csv_content () { 
        if (!this.get_csv_content_defined) {
            await this.ddb.eval(
                this.options.python ?
                    'def get_csv_content (name_or_obj):\n' +
                    '    type = typestr(name_or_obj)\n' +
                    "    if type == 'CHAR' or type == 'STRING':\n" +
                    '        obj = objByName(name_or_obj)\n' +
                    '    else:\n' +
                    '        obj = name_or_obj\n' +
                    '        \n' +
                    '    table_size = size(obj)\n' +
                    "    return generateTextFromTable((select * from obj limit table_size), 0, table_size, 0, char(','), True)\n"
                :
                    'def get_csv_content (name_or_obj) {\n' +
                    '    type = typestr name_or_obj\n' +
                    "    if (type =='CHAR' || type =='STRING')\n" +
                    '        obj = objByName(name_or_obj)\n' +
                    '    else\n' +
                    '        obj = name_or_obj\n' +
                    '        \n' +
                    '    table_size = size obj\n' +
                    "    return generateTextFromTable((select * from obj limit table_size), 0, table_size, 0, ',', true)\n" +
                    '}\n'
                )
            
            this.get_csv_content_defined = true
        }  
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
    async update_vars () {
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
                
                connection: this,
                
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
    }
    
    
    async update_databases () {
        // 当前无数据节点和计算节点存活，且当前节点不为单机节点，则不进行数据库表获取
        if (!this.connected || this.node.mode !== NodeType.single && !this.has_data_and_computing_nodes_alive()) 
            return
        
        // ['dfs://数据库路径(可能包含/)/表名', ...]
        // 不能直接使用 getClusterDFSDatabases, 因为新的数据库权限版本 (2.00.9) 之后，用户如果只有表的权限，调用 getClusterDFSDatabases 无法拿到该表对应的数据库
        // 但对于无数据表的数据库，仍然需要通过 getClusterDFSDatabases 来获取。因此要组合使用
        const [{ value: table_paths }, { value: db_paths }] = await Promise.all([
            this.ddb.call<DdbVectorStringObj>('getClusterDFSTables'),
            // 可能因为用户没有数据库的权限报错，单独 catch 并返回空数组
            this.ddb.call<DdbVectorStringObj>('getClusterDFSDatabases').catch(() => {
                console.error('load_dbs: getClusterDFSDatabases error')
                return { value: [ ] }
            }),
        ])
        
        // const db_paths = [
        //     'dfs://db1',
        //     'dfs://g1.db1',
        //     'dfs://g1.db2',
        //     'dfs://g1./db1',
        // ...]
        
        // const table_paths = [
        //     'dfs://db1/tb1',
        //     'dfs://g1.db1/tb1',
        //     'dfs://g1.db1/tb.2',
        //     'dfs://g1./db1/tb2',
        //     'dfs://long.g1.sg1.ssg1.sssg1.db1/tb1',
        //     // 即使有两个连续点号，也不进行任何特殊处理。用户在界面上看到的将会有一个 group 的标题为空
        //     'dfs://double-dot..g1/db1/tb',
        //     'dfs://double-dot..g1.sg1.db1/tb',
        //     'dfs://double-dot..g1.sg2.db1/tb',
        //     'dfs://db-with-slash/db1/tb1',
        //     'dfs://group_with_slash/g1.sg1.db1/tb1'
        // ]
        
        // 将 db_paths 和 table_paths 合并到 merged_paths 中。db_paths 内可能存在 table_paths 中没有的 db，例如能查到无表的库
        // 需要手动为 db_paths 中的每个路径加上斜杠结尾
        const merged_paths = db_paths.map((path: string) => `${path}/`).concat(table_paths).sort()
        
        // 假定所有的 table_name 值都不会以 / 结尾
        // 库和表之间以最后一个 / 隔开。表名不可能有 /
        // 全路径中可能没有组（也就是没有点号），但一定有库和表
        const hash_map = new Map<string, DdbGroup | DdbDatabase>()
        
        this.children = [ ]
        
        for (const path of merged_paths) {
            // 找到数据库最后一个斜杠位置，截取前面部分的字符串作为库名
            const index_slash = path.lastIndexOf('/')
            
            const db_path = `${path.slice(0, index_slash)}/`
            const table_name = path.slice(index_slash + 1)
            
            let parent: DdbConnection | DdbGroup | DdbDatabase = this
            
            // for 循环用来处理 database group
            for (let index = 0;  index = db_path.indexOf('.', index) + 1;  ) {
                const group_key = path.slice(0, index)
                const group = hash_map.get(group_key)
                if (group)
                    parent = group
                else {
                    const group = new DdbGroup(group_key, this)
                    ;(parent as DdbConnection | DdbGroup).children.push(group)
                    hash_map.set(group_key, group)
                    parent = group
                }
            }
            
            // 处理 database
            const db = hash_map.get(db_path) as DdbDatabase
            if (db)
                parent = db
            else {
                const db = new DdbDatabase(db_path, this)
                ;(parent as DdbConnection | DdbGroup).children.push(db)
                hash_map.set(db_path, db)
                parent = db
            }
            
            // 处理 table，如果 table_name 为空表明当前路径是 db_path 则不处理
            if (table_name) {
                const table = new DdbTable(parent as DdbDatabase, `${path}/`)
                ;(parent as DdbDatabase).tables.push(table)
            }
        }
        
        // TEST: 测试多级数据库树
        // for (let i = 0;  i <100 ;  i++) {
        //     for (let j =0; j< 500; j++){
        //         const path = `dfs://${i}.${j}`
        //         const tables = [new TableEntity({name: `table_of_${i}_${j}`, ddb_path:path, labels:['sdsadfs'], column_schema:[{name:'Id', type:5}]})]
        //         dbs.set(path, new DdbEntity({ path ,tables}))
        //     }
        //  }
    }
    
    
    async update (database: boolean) {
        await Promise.all([
            this.update_vars(), 
            ...(database ? [this.update_databases()] : [ ])
        ])
    }
    
    
    async get_node_type () {
        const { value: node_type } = await this.ddb.call<DdbObj<NodeType>>('getNodeType', [ ], { urgent: true })
        this.node_type = node_type
        return node_type
    }
    
    
    async get_node_alias () {
        const { value: node_alias } = await this.ddb.call<DdbObj<string>>('getNodeAlias', [ ], { urgent: true })
        this.node_alias = node_alias
        return node_alias
    }
    
    
    async get_controller_alias () {
        const { value: controller_alias } = await this.ddb.call<DdbObj<string>>('getControllerAlias', [ ], { urgent: true })
        this.controller_alias = controller_alias
        return controller_alias
    }
        
    
    /** 获取 nodes 和 node 信息
    https://www.dolphindb.cn/cn/help/FunctionsandCommands/FunctionReferences/g/getClusterPerf.html  
    Only master or single mode supports function getClusterPerf. */
    async get_cluster_perf () {
        const nodes = (
            await this.ddb.call<DdbObj<DdbObj[]>>('getClusterPerf', [true], {
                urgent: true,
                
                ... this.node_type === NodeType.controller || this.node_type === NodeType.single ? 
                    { }
                :
                    {
                        node: this.controller_alias,
                        func_type: DdbFunctionType.SystemFunc
                    },
            })
        ).to_rows<DdbNode>()
        .sort((a, b) => strcmp(a.name, b.name))
        
        let node: DdbNode, controller: DdbNode, datanode: DdbNode
        
        for (const _node of nodes) {
            if (_node.name === this.node_alias)
                node = _node
            
            if (_node.mode === NodeType.controller)
                if (_node.isLeader)
                    controller = _node
                else
                    controller ??= _node
            
            if (_node.mode === NodeType.data)
                datanode ??= _node
        }
        
        this.nodes = nodes
        this.node = node
        this.controller = controller
        this.datanode = datanode
    }
    
    
    async get_formatted_version () {
        const { value } = await this.ddb.call<DdbObj<string>>('version')
        let version = value.split(' ')[0]
        // 将 x.x.x 这样的三位版本号补全为 x.x.x.0 的四位版本号
        version += '.0'.repeat(4 - version.split('.').length)
        this.version = version
    }
    
    
    /** 判断当前集群是否有数据节点或计算节点正在运行 */
    has_data_and_computing_nodes_alive () {
        return Boolean(
            this.nodes.find(node =>
                (node.mode === NodeType.data || node.mode === NodeType.computing) && 
                node.state === DdbNodeState.online)
        )
    }
}


export function register_connector () {
    icon_empty = `${fpd_ext}icons/radio.empty.svg`
    icon_checked = `${fpd_ext}icons/radio.checked.svg`
    
    connector = new DdbConnector()
    connector.view = window.createTreeView('dolphindb.connector', { treeDataProvider: connector })
}

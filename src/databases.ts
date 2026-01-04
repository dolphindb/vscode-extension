import {
    window, EventEmitter, type Event,
    type TreeView, TreeItem, TreeItemCollapsibleState, type TreeDataProvider
} from 'vscode'

import { assert } from 'xshell/utils.js'

import { DdbFunction, DdbFunctionType, type DdbDictObj, type DdbVectorStringObj } from 'dolphindb'

import { t } from '@i18n'


import { NodeType } from './commons.ts'

import { connector, funcdefs, type DdbConnection } from './connector.ts'

import { fpd_ext } from './index.ts'


export class Databases implements TreeDataProvider<TreeItem> {
    view: TreeView<TreeItem>
    
    refresher: EventEmitter<TreeItem | undefined | void> = new EventEmitter<TreeItem | undefined | void>()
    
    onDidChangeTreeData: Event<void | TreeItem> = this.refresher.event
    
    
    getTreeItem (node: TreeItem): TreeItem | Thenable<TreeItem> {
        return node
    }
    
    
    getChildren (node?: Catalog | DatabaseGroup | Database) {
        if (!node)
            return connector.connection.children
        
        return node.children
    }
}


export let databases: Databases


export class Catalog extends TreeItem {
    override iconPath = `${fpd_ext}icons/catalog.svg`
    
    name: string
    
    children: (Database | OrcaTable)[] = [ ]
    
    constructor (name: string) {
        super(name, TreeItemCollapsibleState.Collapsed)
        this.name = name
    }
}


export class DatabaseGroup extends TreeItem {
    children: (DatabaseGroup | Database)[] = [ ]
    
    constructor (path: string) {
        super(
            path.slice('dfs://'.length, -1).slice_from('.', { last: true }), 
            TreeItemCollapsibleState.Collapsed)
        
        this.iconPath = `${fpd_ext}icons/database-group.svg`
    }
}


export class Database extends TreeItem {
    override contextValue = 'database'
    
    override iconPath = `${fpd_ext}icons/database.svg`
    
    connection: DdbConnection
    
    children: Table[] = [ ]
    
    path: string
    
    name: string
    
    catalog?: Catalog
    
    
    constructor (
        connection: DdbConnection, 
        path: string, 
        name = path.slice('dfs://'.length, -1).slice_from('.', { last: true }),
        catalog?: Catalog
    ) {
        assert(path.startsWith('dfs://'), t('数据库路径应该以 dfs:// 开头'))
        
        super(name, TreeItemCollapsibleState.Collapsed)
        
        this.name = name
        this.connection = connection
        this.path = path
        this.catalog = catalog
    }
    
    
    async get_schema () {
        let { connection } = connector
        let { ddb } = connection
        
        return ddb.call<DdbDictObj<DdbVectorStringObj>>(
            await ddb.define(funcdefs.load_database_schema[ddb.language]),
            // 调用该函数时，数据库路径不能以 / 结尾
            [this.path.slice(0, -1)],
            connection.node_type === NodeType.controller ? { node: connection.datanode.name } : { })
    }
}


export class Table extends TreeItem {
    database: Database
    
    name: string
    
    override contextValue = 'table'
    
    override iconPath = `${fpd_ext}icons/table.svg`
    
    
    constructor (database: Database, path: string) {
        const name = path.slice(database.path.length, -1)
        
        super(name)
        
        this.name = name
        this.database = database
        this.command = {
            title: 'dolphindb.inspect_table',
            command: 'dolphindb.inspect_table',
            arguments: [this]
        }
    }
    
    
    async inspect () {
        let { connection } = connector
        let { ddb } = connection
        let obj = await ddb.call(
            await ddb.define(funcdefs.peek_table[ddb.language]),
            [this.database.path.slice(0, -1), this.name],
            connection.node_type === NodeType.controller ? { node: connection.datanode.name } : undefined)
        obj.name = `${this.name} (${t('前 100 行')})`
        return obj
    }
    
    
    async get_schema () {
        let { connection } = connector
        let { ddb } = connection
        
        return ddb.call<DdbDictObj<DdbVectorStringObj>>(
            await ddb.define(funcdefs.load_table_schema[ddb.language]),
            // 调用该函数时，数据库路径不能以 / 结尾
            [this.database.path.slice(0, -1), this.name],
            connection.node_type === NodeType.controller ? { node: connection.datanode.name } : undefined)
    }
}


export class OrcaTable extends TreeItem {
    name: string
    
    fullname: string
    
    meta: TableMeta
    
    /** 和 table 的 contextValue 不同，作区分，目前右键菜单不同 */
    override contextValue = 'orca_table'
    
    override iconPath = `${fpd_ext}icons/table.svg`
    
    
    constructor (meta: TableMeta) {
        const name = meta.name.slice_from('.')
        
        super(name)
        
        this.meta = meta
        
        this.name = name
        this.fullname = meta.fullname
        
        this.command = {
            title: 'dolphindb.inspect_table',
            command: 'dolphindb.inspect_table',
            arguments: [this]
        }
    }
    
    
    async inspect () {
        let { connection } = connector
        let { ddb } = connection
        let obj = await ddb.eval(`select top 100 * from ${this.fullname}`)
        obj.name = `${this.name} (${t('前 100 行')})`
        return obj
    }
    
    
    get_schema () {
        let { connection } = connector
        let { ddb } = connection
        
        return ddb.call<DdbDictObj<DdbVectorStringObj>>(
            'useOrcaStreamTable',
            // 调用该函数时，数据库路径不能以 / 结尾
            [this.fullname, new DdbFunction('schema', DdbFunctionType.SystemFunc)])
    }
}


export interface TableMeta {
    name: string
    
    fullname: string
    
    id: string
    
    graph_refs: string[]
}


export function register_databases () {
    databases = new Databases()
    databases.view = window.createTreeView('dolphindb.databases', { treeDataProvider: databases })
    databases.view.message = t('请选择连接并登录后查看')
}


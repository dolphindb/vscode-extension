import {
    window,
    
    EventEmitter, type Event,
    
    type TreeView, TreeItem, TreeItemCollapsibleState, type TreeDataProvider
} from 'vscode'

import { assert } from 'xshell/utils.js'

import { type DdbDictObj, type DdbVectorStringObj } from 'dolphindb'

import { t } from '@i18n'


import { NodeType } from './constant.ts'

import { connector, funcdefs, type DdbConnection } from './connector.ts'

import { fpd_ext } from './index.ts'


export class DdbDatabases implements TreeDataProvider<TreeItem> {
    view: TreeView<TreeItem>
    
    refresher: EventEmitter<TreeItem | undefined | void> = new EventEmitter<TreeItem | undefined | void>()
    
    onDidChangeTreeData: Event<void | TreeItem> = this.refresher.event
    
    
    getTreeItem (node: TreeItem): TreeItem | Thenable<TreeItem> {
        return node
    }
    
    
    getChildren (node?: TreeItem) {
        switch (true) {
            case !node: 
                return connector.connection.children
            
            case (node instanceof DdbGroup || node instanceof DdbCatalog): 
                return node.children
            
            case node instanceof DdbDatabase:
                return node.tables
        }
    }
}


export let databases: DdbDatabases


export class DdbCatalog extends TreeItem {
    children: DdbDatabase[] = [ ]
    
    constructor (title: string) {
        super(title, TreeItemCollapsibleState.Collapsed)
        this.iconPath = `${fpd_ext}icons/catalog.svg`
    }
}


export class DdbGroup extends TreeItem {
    children: (DdbGroup | DdbDatabase)[] = [ ]
    
    constructor (path: string) {
        super(path.slice('dfs://'.length, -1).split('.').at(-1), TreeItemCollapsibleState.Collapsed)
        this.iconPath = `${fpd_ext}icons/database-group.svg`
    }
}


export class DdbDatabase extends TreeItem {
    connection: DdbConnection
    
    tables: DdbTable[] = [ ]
    
    path: string
    
    
    constructor (path: string, connection: DdbConnection, title?: string) {
        super(title ?? path.slice('dfs://'.length, -1).split('.').at(-1), TreeItemCollapsibleState.Collapsed)
        assert(path.startsWith('dfs://'), t('数据库路径应该以 dfs:// 开头'))
        this.connection = connection
        this.path = path
        this.contextValue = 'database'
        this.iconPath = `${fpd_ext}icons/database.svg`
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


export class DdbTable extends TreeItem {
    database: DdbDatabase
    
    name: string
    
    constructor (database: DdbDatabase, path: string) {
        const name = path.slice(database.path.length, -1)
        super(name, TreeItemCollapsibleState.None)
        this.database = database
        this.iconPath = `${fpd_ext}icons/table.svg`
        this.contextValue = 'table'
        this.name = name
        this.command = {
            title: 'dolphindb.inspect_table',
            command: 'dolphindb.inspect_table',
            arguments: [this],
        }
    }
    
    
    async get_obj () {
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


export function register_databases () {
    databases = new DdbDatabases()
    databases.view = window.createTreeView('dolphindb.databases', { treeDataProvider: databases })
    databases.view.message = t('请选择连接并登录后查看')
}


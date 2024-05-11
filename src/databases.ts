import {
    window,
    
    EventEmitter, type Event,
    
    type TreeView, TreeItem, TreeItemCollapsibleState, type TreeDataProvider
} from 'vscode'

import { assert } from 'xshell/utils.js'

import { type DdbDictObj, DdbFunctionType, type DdbVectorStringObj, type DdbObj } from 'dolphindb'

import { t } from '../i18n/index.js'


import { NodeType } from './constant.js'

import { connector, type DdbConnection } from './connector.js'

import { fpd_ext } from './index.js'


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
            
            case node instanceof DdbGroup: 
                return node.children
            
            case node instanceof DdbDatabase:
                return node.tables
        }
    }
}


export let databases: DdbDatabases


export class DdbGroup extends TreeItem {
    connection: DdbConnection
    
    children: Array<DdbGroup | DdbDatabase> = [ ]
    
    path: string
    
    
    constructor (path: string, connection: DdbConnection) {
        super(path.slice('dfs://'.length, -1).split('.').at(-1), TreeItemCollapsibleState.Collapsed)
        this.connection = connection
        this.path = path
        this.iconPath = `${fpd_ext}icons/database-group.svg`
    }
}


export class DdbDatabase extends TreeItem {
    connection: DdbConnection
    
    tables: DdbTable[] = [ ]
    
    path: string
    
    schema: DdbDictObj<DdbVectorStringObj>
    
    constructor (path: string, connection: DdbConnection) {
        super(path.slice('dfs://'.length, -1).split('.').at(-1), TreeItemCollapsibleState.Collapsed)
        assert(path.startsWith('dfs://'), t('数据库路径应该以 dfs:// 开头'))
        this.connection = connection
        this.path = path
        this.contextValue = 'database'
        this.iconPath = `${fpd_ext}icons/database.svg`
    }
    
    async get_schema () {
        if (this.schema)
            return this.schema
        else {
            await connector.connection.define_load_database_schema()
            
            return this.schema = await connector.connection.ddb.call<DdbDictObj<DdbVectorStringObj>>(
                // 这个函数在 define_load_database_schema 中已定义
                'load_database_schema',
                // 调用该函数时，数据库路径不能以 / 结尾
                [this.path.slice(0, -1)],
                connector.connection.node_type === NodeType.controller ? { node: connector.connection.datanode.name, func_type: DdbFunctionType.UserDefinedFunc } : { }
            )
        }
    }
}


export class DdbTable extends TreeItem {
    database: DdbDatabase
    
    name: string
    
    obj: DdbObj
    
    schema: DdbDictObj<DdbVectorStringObj>
    
    
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
        if (this.obj) 
            return this.obj
        else {
            await connector.connection.define_peek_table()
            let obj = await connector.connection.ddb.call(
                'peek_table',
                [this.database.path.slice(0, -1), this.name],
                connector.connection.node_type === NodeType.controller ? { node: connector.connection.datanode.name, func_type: DdbFunctionType.UserDefinedFunc } : { }
            )
            obj.name = `${this.name} (${t('前 100 行')})`
            return this.obj = obj
        }
    }
    
    
    async get_schema () {
        if (this.schema)
            return this.schema
        else {
            await connector.connection.define_load_table_schema()
            return this.schema = await connector.connection.ddb.call<DdbDictObj<DdbVectorStringObj>>(
                // 这个函数在 define_load_table_schema 中已定义
                'load_table_schema',
                // 调用该函数时，数据库路径不能以 / 结尾
                [this.database.path.slice(0, -1), this.name],
                connector.connection.node_type === NodeType.controller ? { node: connector.connection.datanode.name, func_type: DdbFunctionType.UserDefinedFunc } : { }
            )
        }
    }
}


export function register_databases () {
    databases = new DdbDatabases()
    databases.view = window.createTreeView('dolphindb.databases', { treeDataProvider: databases })
}


import {
    window,
    
    commands,
    
    EventEmitter, type Event,
    
    type TreeView, TreeItem, TreeItemCollapsibleState, type TreeDataProvider, type ProviderResult,
} from 'vscode'
import { type DdbConnection } from './connection.js'
import { fpd_ext } from '../index.js'
import { assert } from 'xshell/utils.js'
import { t } from '../i18n/index.js'
import { model } from '../model.js'
import { type DdbDictObj, DdbFunctionType, type DdbVectorStringObj, type DdbObj } from 'dolphindb'
import { NodeType } from '../constant.js'


export class DdbDatabaseProvider implements TreeDataProvider<TreeItem> {
    view: TreeView<TreeItem>
    
    refresher: EventEmitter<TreeItem | undefined | void> = new EventEmitter<TreeItem | undefined | void>()
    
    onDidChangeTreeData: Event<void | TreeItem> = this.refresher.event
    
    
    getTreeItem (node: TreeItem): TreeItem | Thenable<TreeItem> {
        return node
    }
    
    
    getChildren (node?: TreeItem) {
        switch (true) {
            case !node: {
                const { groups, databases } = model.connection
                return [...groups, ...databases]
            }
            
            case node instanceof DdbGroup: {
                const { groups, databases } = node as DdbGroup
                return [...groups, ...databases]
            }
            
            case node instanceof DdbDatabase:
                return (node as DdbDatabase).tables
        }
    }
}


export let database_provider: DdbDatabaseProvider


export class DdbGroup extends TreeItem {
    connection: DdbConnection
    
    groups: DdbGroup[] = [ ]
    
    databases: DdbDatabase[] = [ ]
    
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
    
    constructor (path: string, connection: DdbConnection) {
        super(path.slice('dfs://'.length, -1).split('.').at(-1), TreeItemCollapsibleState.Collapsed)
        assert(path.startsWith('dfs://'), t('数据库路径应该以 dfs:// 开头'))
        this.connection = connection
        this.path = path
        this.iconPath = `${fpd_ext}icons/database.svg`
    }
}


export class DdbTable extends TreeItem {
    connection: DdbConnection
    
    database: DdbDatabase
    
    name: string
    
    obj: DdbObj
    
    schema: DdbDictObj<DdbVectorStringObj>
    
    constructor (database: DdbDatabase, path: string, connection: DdbConnection) {
        const name = path.slice(database.path.length, -1)
        super(name, TreeItemCollapsibleState.None)
        this.connection = connection
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
        if (!this.obj) {
            await this.connection.define_peek_table()
            let obj = await this.connection.ddb.call(
                'peek_table',
                [this.database.path.slice(0, -1), this.name],
                model.connection.node_type === NodeType.controller ? { node: this.connection.datanode.name, func_type: DdbFunctionType.UserDefinedFunc } : { }
            )
            obj.name = `${this.name} (${t('前 100 行')})`
            this.obj = obj
        }
        return this.obj
    }
    
    
    async get_schema () {
        if (!this.schema) {
            await this.connection.define_load_table_schema()
            this.schema = await this.connection.ddb.call<DdbDictObj<DdbVectorStringObj>>(
                // 这个函数在 define_load_schema 中已定义
                'load_table_schema',
                // 调用该函数时，数据库路径不能以 / 结尾
                [this.database.path.slice(0, -1), this.name],
                this.connection.node_type === NodeType.controller ? { node: this.connection.datanode.name, func_type: DdbFunctionType.UserDefinedFunc } : { }
            )
        }
        
        return this.schema
    }
}


export function register_database_provider () {
    database_provider = new DdbDatabaseProvider()
    database_provider.view = window.createTreeView('dolphindb.database', { treeDataProvider: database_provider })
}


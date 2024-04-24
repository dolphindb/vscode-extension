import { window, workspace, type ConfigurationChangeEvent, languages } from 'vscode'


import { SqlStandard } from 'dolphindb'

import { DdbConnection, connection_provider } from './provider/connection.js'
import { fpd_ext } from './index.js'
import { var_provider } from './provider/var.js'
import { database_provider } from './provider/database.js'


export let icon_empty: string
export let icon_checked: string


export class DdbModel {
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
            connection_provider.refresher.fire()
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
    
    refresh (connection?: DdbConnection) {
        connection_provider.refresher.fire(connection)
        var_provider.refresher.fire()
        database_provider.refresher.fire()
    }
}


/** 全局状态管理 */
export let model: DdbModel


export function init_model () {
    icon_empty = `${fpd_ext}icons/radio.empty.svg`
    icon_checked = `${fpd_ext}icons/radio.checked.svg`
    
    model = new DdbModel()
}

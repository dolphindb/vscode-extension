import {
    window,
    
    ThemeColor,
    
    StatusBarAlignment, type StatusBarItem,
} from 'vscode'

import { t } from '../i18n/index.js'
import { connector } from './connector.js'


/** 底部代码执行状态 status bar */
export let statbar = {
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
        
        this.set(false)
    },
    
    
    /** 更新当前连接状态至状态栏 */
    update () {
        this.set(connector.connection?.running)
    },
    
    
    /** @private */
    set (running: boolean) {
        this.bar.text = running ? t('执行中') : t('空闲中')
        this.bar.backgroundColor = running ? this.bgerr : null
        this.bar.show()
    }
}

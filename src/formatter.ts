import {
    window,
    workspace,
    
    StatusBarAlignment, type StatusBarItem,
    
    InputBoxValidationSeverity,
    
    ConfigurationTarget, type ConfigurationChangeEvent, 
} from 'vscode'

import { t } from './i18n/index.js'
import { model } from './model.js'


export let formatter = {
    bar: null as StatusBarItem,
    
    decimals: null as number | null,
    
    
    init () {
        this.bar = window.createStatusBarItem({
            name: t('DolphinDB 小数显示位数'),
            id: 'ddb_formatter',
            alignment: StatusBarAlignment.Right,
            // priority: 暂不设置
        } as any)
        
        this.bar.command = 'dolphindb.set_decimals'
        this.bar.tooltip = t('设置 DolphinDB 小数显示位数')
        
        this.read_config()
        
        this.update_bar()
    },
    
    update_bar () {
        this.bar.text = `${t('小数位数:')} ${ this.decimals ?? t('实际') }`
        this.bar.show()
    },
    
    read_config () {
        this.decimals = workspace.getConfiguration('dolphindb').get('decimals')
        console.log(`formatter.decimals: ${this.decimals}`)
    },
    
    save_config () {
        workspace.getConfiguration('dolphindb').update('decimals', this.decimals, ConfigurationTarget.Global)
        console.log(`formatter.decimals: ${this.decimals}`)
    },
    
    async prompt () {
        const value = await window.showInputBox({
            prompt: t('设置小数点后显示的位数 (可取 0 ~ 20) (置空时重置为实际数据的位数)'),
            placeHolder: t('实际数据的位数'),
            value: this.decimals === null || this.decimals === undefined ? '' : String(this.decimals),
            ignoreFocusOut: true,
            validateInput (value: string) {
                if (value === '' || /^\s*((1)?[0-9]|20)\s*$/.test(value)) {
                    const value_ = value.replace(/\s+/g, '')
                    return { message: `${t('设置小数位数为:')} ${value_ === '' ? t('实际数据的位数') : value_}`, severity: InputBoxValidationSeverity.Info }
                } else
                    return { message: t('小数位数应为空或介于 0 - 20'), severity: InputBoxValidationSeverity.Error }
            }
        })
        
        if (value === undefined) {  // 通过按 esc 取消
            console.log(t('用户已取消设置小数位数'))
            return
        }
        
        this.decimals = value ? Number(value) : null
        
        this.save_config()
        // 会触发 on_config_change, 不需要再 this.update_bar()
    },
    
    async on_config_change (event: ConfigurationChangeEvent) {
        const { connection } = model
        
        if (event.affectsConfiguration('dolphindb.decimals')) {
            console.log(t('dolphindb.decimals 配置被修改'))
            this.read_config()
            this.update_bar()
            
            if (connection.vars)
                await connection.update()
        }
    },
}

import util from 'util'

import {
    window,
    workspace,
    
    commands,
    
    extensions, ExtensionMode,
    
    type ExtensionContext,
    
    type ProviderResult,
    
    ConfigurationTarget,
    
    debug, type DebugConfiguration,
    
    type MessageItem
} from 'vscode'

import 'xshell/polyfill.browser.js'
import { set_inspect_options } from 'xshell'


import { t } from '../i18n/index.ts'

import { load_docs, register_docs } from './docs.ts'
import { server } from './server.ts'
import { dataview } from './dataview/dataview.ts'
import { statbar } from './statbar.ts'
import { formatter } from './formatter.ts'
import { ddb_commands } from './commands.ts'
import { register_terminal_link_provider } from './terminal.ts'
import { connector, register_connector } from './connector.ts'
import { register_variables } from './variables.ts'
import { register_databases } from './databases.ts'


export type DdbMessageItem = MessageItem & { action?: () => void | Promise<void> }

type TokenColorCustomizations = {
    textMateRules?: Array<TextMateRule>
}

type TextMateRule = {
    scope: string | string[]
    settings: {
        foreground?: string
        background?: string
        fontStyle?: string
    }
}

if (util.inspect.styles.number !== 'green')
    set_inspect_options()


/** 插件运行目录: 可能是 out 文件夹或实际安装文件夹 */
export const fpd_ext = extensions.getExtension('dolphindb.dolphindb-vscode').extensionPath.fpd


export let extctx: ExtensionContext

export let dev = false


export async function activate (ctx: ExtensionContext) {
    extctx = ctx
    
    dev = ctx.extensionMode === ExtensionMode.Development
    console.log(t('dolphindb 插件运行在{{mode}}模式下，版本为 {{version}}', {
        mode: dev ? t('开发') : t('生产'),
        version: EXTENSION_VERSION
    }))
    
    
    // 命令注册
    for (const func of ddb_commands)
        ctx.subscriptions.push(commands.registerCommand(`dolphindb.${func.name}`, func))
    
    
    // 在 package.json 中设置 configurationDefaults 不生效，只好通过 api 修改
    let config_window = workspace.getConfiguration('window')
    if (config_window.get<'native' | 'custom'>('dialogStyle') === 'native')
        await config_window.update('dialogStyle', 'custom', ConfigurationTarget.Global)
    
    
    register_connector()
    register_variables()
    register_databases()
    
    window.onDidChangeActiveTextEditor(() => {
        connector.change_language_mode()    
    })
    
    
    formatter.init()
    statbar.init()
    
    // 监听配置，dispatch 修改 event
    workspace.onDidChangeConfiguration(event => {
        formatter.on_config_change(event)
        connector.on_config_change(event)
    })
    
    register_terminal_link_provider()
    
    await load_docs()
    register_docs(ctx)
    
    
    dataview.register()
    
    
    ctx.subscriptions.push(debug.registerDebugConfigurationProvider('dolphindb', {
        resolveDebugConfiguration (folder, config, token): ProviderResult<DebugConfiguration> {
            // 默认使用当前插件连接的 server 作为 debugger
            const { connection: { url, options: { python, password, username, autologin } } } = connector
            
            if (python) {
                window.showWarningMessage(t('python parser 暂不支持调试功能'))
                return
            }
            
            const languageId = window.activeTextEditor?.document.languageId
            
            // if launch.json is missing or empty
            if (
                !config.type && 
                !config.request && 
                !config.name && 
                languageId === 'dolphindb'
            ) {
                config.type = 'dolphindb'
                config.request = 'launch'
                config.name = t('调试当前 DolphinDB 脚本文件')
                config.program = '${file}'
            }
            
            config.url ??= url
            config.username ??= username
            config.password ??= password
            config.autologin = autologin
            
            // 并不能在这里限制非. dos 文件被选中作为 debugee，此时 ${file} 还未被解析成绝对路径
            if (!config.program) {
                window.showInformationMessage(t('调试配置 program 字段为空，请指定为待调试的脚本路径'))
                return
            }
            
            return config
        }
    }))
    
    /** 添加 decorator 颜色 */
    const config = workspace.getConfiguration('editor')
    
    // 获取当前的 tokenColorCustomizations，不存在则创建
    const token_color_customizations: TokenColorCustomizations = config.get<TokenColorCustomizations>('tokenColorCustomizations') || { }
    const textmate_rules: TextMateRule[] = token_color_customizations.textMateRules || [ ]
    
    // 添加新的规则
    const new_rule: TextMateRule = {
        scope: 'meta.decorator.dolphindb',
        settings: {
            foreground: '#aa6f00'
        }
    }
    
    // 检查是否已经存在该规则，避免重复添加
    const rule_exists = textmate_rules.some((rule: TextMateRule) => rule.scope === 'meta.decorator.dolphindb')
    if (!rule_exists) {
        textmate_rules.push(new_rule)
        token_color_customizations.textMateRules = textmate_rules
        
        // 更新配置
        config.update('tokenColorCustomizations', token_color_customizations, ConfigurationTarget.Global)
            .then(() => {
                // 更新规则成功，什么也不做
            }, _ => {
                window.showErrorMessage('Failed to update token color customization')
            })
    }
    console.log(t('DolphinDB 插件初始化成功'))
}


export function deactivate (ctx: ExtensionContext) {
    server?.stop()
}

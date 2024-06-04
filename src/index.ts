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

import { set_inspect_options } from 'xshell'


import { t } from '../i18n/index.js'

import './polyfill.js'
import { load_docs, register_docs } from './docs.js'
import { server } from './server.js'
import { dataview } from './dataview/dataview.js'
import { statbar } from './statbar.js'
import { formatter } from './formatter.js'
import { ddb_commands } from './commands.js'
import { register_terminal_link_provider } from './terminal.js'
import { connector, register_connector } from './connector.js'
import { register_variables } from './variables.js'
import { register_databases } from './databases.js'
import * as path from 'path';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node.js';

let client: LanguageClient;


declare global {
    const FPD_ROOT: string
}

export type DdbMessageItem = MessageItem & { action?: () => void | Promise<void> }


if (util.inspect.styles.number !== 'green')
    set_inspect_options()


/** 插件运行目录: 可能是 out 文件夹或实际安装文件夹 */
export const fpd_ext = extensions.getExtension('dolphindb.dolphindb-vscode').extensionPath.fpd


export let extctx: ExtensionContext

export let dev = false


export async function activate(ctx: ExtensionContext) {
    extctx = ctx

    dev = ctx.extensionMode === ExtensionMode.Development
    console.log(t('dolphindb 插件运行在{{mode}}模式下', { mode: dev ? t('开发') : t('生产') }))


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

    load_docs()

    // 监听配置，dispatch 修改 event
    workspace.onDidChangeConfiguration(event => {
        formatter.on_config_change(event)
        connector.on_config_change(event)
    })

    register_terminal_link_provider()

    register_docs(ctx)


    dataview.register()


    ctx.subscriptions.push(debug.registerDebugConfigurationProvider('dolphindb', {
        resolveDebugConfiguration(folder, config, token): ProviderResult<DebugConfiguration> {
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

    /**
     * 初始化 Language Server
     */
    // The server is implemented in node
    let serverModule = ctx.asAbsolutePath(path.join('server', 'server.js'));
    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    let serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    // Options to control the language client
    let clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
        documentSelector: [{ scheme: 'file', language: 'dolphindb' }],
        synchronize: {
            // Notify the server about file changes to '.clientrc files contained in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
        }
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'ddbls',
        'Dolphin DB Language Server',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    client.start();

    console.log(t('DolphinDB 插件初始化成功'))
}


export function deactivate(ctx: ExtensionContext) {
    server?.stop()

    /**
     * 停止 Language Server 连接
     */
    if (!client) {
        return undefined;
    }
    return client.stop();
}

import dayjs from 'dayjs'

import { window, workspace, commands, ConfigurationTarget, ProgressLocation, Uri } from 'vscode'

import { path, Timer, delay, inspect } from 'xshell'

import { DdbConnectionError, DdbForm, DdbObj, DdbType, InspectOptions } from 'dolphindb'


import { t } from './i18n/index.js'
import { type DdbMessageItem } from './index.js'
import { type DdbConnection, explorer, DdbVar } from './explorer.js'
import { server } from './server.js'
import { statbar } from './statbar.js'
import { get_text, open_workbench_settings_ui } from './utils.js'
import { dataview } from './dataview/dataview.js'
import { formatter } from './formatter.js'
import { create_terminal, terminal } from './terminal.js'


let lastvar: DdbVar


/** 截取长脚本前三个非空行，或前两行 + ... */
function truncate_text (lines: string[]) {
    let i_first_non_empty = null
    let i_non_empty_end = null
    for (let i = 0;  i < lines.length;  i++) 
        if (lines[i].trim()) {
            if (i_first_non_empty === null)
                i_first_non_empty = i
            i_non_empty_end = i + 1
        }
    
    // 未找到非空行
    if (i_first_non_empty === null) {
        i_first_non_empty = 0
        i_non_empty_end = 0
    }
    
    const too_much = i_non_empty_end - i_first_non_empty > 3
    
    let lines_ = lines.slice(i_first_non_empty, too_much ? i_first_non_empty + 2 : i_non_empty_end)
    
    if (too_much)
        lines_.push('...')
    
    return lines_
}


/** 将 mappings 的 key 和 value 都进行 path.normalize，如果有类型的错误匹配，扔出错误 */
function normalize_mappings (mappings: Record<string, string>) {
    return mappings ?
        Object.fromEntries(
            Object.entries(mappings)
                .map(([key, value]) => {
                    const normalized_key = path.normalize(key)
                    const normalized_value = path.normalize(value)
                    
                    if (normalized_key === 'default' ? !normalized_value.isdir : (normalized_key.isdir !== normalized_value.isdir))
                        throw Error(t('配置文件中的 dolphindb.mappings 中存在路径类型错误映射项（1. "文件夹" 路径错误映射到 "文件" 路径；2. "文件" 路径错误映射到 "文件夹" 路径；3. "default" 没有映射到 "文件夹" 路径。）请检查后修改。'))
                    
                    return [normalized_key, normalized_value]
                })
        )
    :
         { }
}


let should_remind_setting_mappings = true

/** 展示 modal 提醒用户设置 mappings */
async function remind_mappings () {
    const { title } = await window.showInformationMessage(
        t('您未配置 dolphindb.mappings，是否现在配置？'), 
        { modal: true },   
        { title: t('是') },  
        { title: t('否'), isCloseAffordance: true }, 
        { title: t('不再提醒') }
    )
    
    switch (title) {
        case t('是'):
            await commands.executeCommand('dolphindb.open_settings', 'mappings')
            return false
        case t('否'):
            return true
        case t('不再提醒'):
            should_remind_setting_mappings = false
            return false
    }
}


/** 根据传入的本地路径，获取映射的 server 路径  
    - fp_local: 本地文件或文件夹的绝对路径
    - mappings: 映射配置
    - fpd_home: 以 / 结尾的文件夹路径  
    @example
    resolve_remote_path('D:/aaa/bbb/ccc.txt', { 'D:/aaa/': '/data/', default: '/default/' }, '/home/')
    // /data/bbb/ccc.txt */
function resolve_remote_path (fp_local: string, mappings: Record<string, string>, fpd_home: string) {
    for (let fp = fp_local, fp_last = null;  fp !== fp_last;  fp_last = fp, fp = fp.fdir)
        if (fp in mappings)
            return mappings[fp] + fp_local.slice(fp.length)
    
    return (mappings.default || `${fpd_home}uploads/`) + fp_local.fname
}


async function execute (text: string) {
    let { connection } = explorer
    
    if (connection.running) {
        terminal.printer.fire(t('当前连接 ({{connection}}) 正在执行作业，请等待\r\n', { connection: connection.name }).yellow)
        return
    }
    
    if (!terminal)
        await create_terminal()
    
    
    let { ddb } = connection
    let { printer } = terminal
    
    let timer = new Timer()
    
    printer.fire(
        '\r\n' +
        `${dayjs(timer.started).format('HH:mm:ss.SSS')}  ${connection.name}\r\n` +
        truncate_text(text.split_lines()).join('\r\n') + 
        (text.trim().length ? '\r\n' : '')
    )
    
    connection.running = true
    statbar.update()
    
    let obj: DdbObj
    
    try {
        await connection.connect()
        
        // TEST: 测试 RefId 错误链接
        // throw new Error('xxxxx. RefId: S00001. xxxx RefId: S00002')
        
        obj = await ddb.eval(
            text.replace(/\r\n/g, '\n'),
            {
                listener (message) {
                    if (connection.disconnected)
                        return
                    
                    const { type, data } = message
                    if (type === 'print')
                        printer.fire(data.replace(/\n/g, '\r\n') + '\r\n')
                    
                    for (const subscriber of dataview.subscribers_repl)
                        subscriber(message, ddb, { decimals: formatter.decimals })
                    
                    for (const subscriber of server.subscribers_repl)
                        subscriber(message, ddb, { decimals: formatter.decimals })
                }
            }
        )
    } catch (error) {
        connection.running = false
        statbar.update()
        
        terminal.show(true)
        
        console.log(error)
        
        let message = error.message as string
        
        if (message.includes('RefId:'))
            message = message.replaceAll(/RefId:\s*(\w+)/g, 'RefId: $1'.blue.underline)
        
        printer.fire((
            message.replaceAll('\n', '\r\n') + 
            (connection === explorer.connection ? '' : ` (${connection.name})`) + 
            '\r\n'
        ).red)
        
        if (error instanceof DdbConnectionError) {
            const answer = await window.showErrorMessage<DdbMessageItem>(
                error.message,
                {
                    detail: t('数据库连接被断开，请检查网络是否稳定、网络转发节点是否会自动关闭 websocket 长连接、server 日志\n') +
                        t('调用栈:\n') +
                        error.stack,
                    modal: true
                },
                {
                    title: t('确认'),
                    isCloseAffordance: true
                },
                {
                    title: t('重连'),
                    async action () {
                        await explorer.reconnect(connection)
                    }
                },
            )
            
            await answer?.action?.()
        }
        
        
        // 执行 ddb 脚本遇到错误是可以预期的，也做了处理，不需要再向上抛出，直接返回
        return
    }
    
    timer.stop()
    
    if (connection.disconnected)
        return
    
    await connection.update()
    
    connection.running = false
    statbar.update()
    
    let to_inspect = false
    let objstr: string
    
    switch (obj.form) {
        case DdbForm.vector:
        case DdbForm.set:
        case DdbForm.matrix:
        case DdbForm.table:
        case DdbForm.chart:
        case DdbForm.dict:
            lastvar = new DdbVar({ ...obj, obj, bytes: 0n })
            to_inspect = true
            objstr = obj.inspect_type().replaceAll('\n', '\r\n').blue + '\r\n'
            break
        
        default:
            terminal.show(true)
            
            objstr = obj.type === DdbType.void ?
                    ''
                :
                    inspect(obj, { decimals: formatter.decimals } as InspectOptions).replaceAll('\n', '\r\n') + '\r\n'
    }
    
    printer.fire(
        objstr +
        timer.getstr(true) + (connection === explorer.connection ? '' : ` (${connection.name})`) + '\r\n'
    )
    
    if (to_inspect)
        await lastvar.inspect()
}


/** 执行代码后，如果超过 1s 还未完成，则显示进度 */
async function execute_with_progress (text: string) {
    let { connection } = explorer
    
    let done = false
    
    const pexecute = execute(text)
    
    // 1s 还未完成，则显示进度
    ;(async () => {
        await delay(1000)
        
        if (!done)
            try {
                await window.withProgress({
                    cancellable: true,
                    title: t('正在执行'),
                    location: ProgressLocation.Notification,
                }, async (progress, token) => {
                    token.onCancellationRequested(async () => {
                        if (connection.ddb.connected)
                            await cancel(connection)
                    })
                    
                    progress.report({ message: text.slice(0, 196) + (text.length > 196 ? '···' : '') })
                    
                    return pexecute
                })
            } catch {
                // 忽略错误，下面已经 await pexecute 了
            }
    })()
    
    try {
        await pexecute
    } finally {
        done = true
    }
}


async function cancel (connection: DdbConnection = explorer.connection) {
    if (!connection.running)
        return
    
    const answer = await window.showWarningMessage<DdbMessageItem>(
        t('是否取消执行中的作业？点击取消作业后，会发送指令并等待当前正在执行的子任务完成后停止'),
        {
            title: t('取消作业'),
            async action () {
                await connection.ddb.cancel()
            }
        },
        {
            title: t('断开连接'),
            action () {
                explorer.disconnect(connection)
            }
        },
        { title: t('不要取消'), isCloseAffordance: true }
    )
    
    if (!connection.running)
        return
    
    await answer?.action?.()
}


export async function open_connection_settings () {
    await commands.executeCommand('dolphindb.open_settings', 'connections')
}


/** 和 webpack 中的 commands 定义需要一一对应 */
export const ddb_commands = [
    async function execute () {
        await execute_with_progress(get_text('selection or line'))
    },
    
    
    async function execute_selection_or_line () {
        try {
            await execute_with_progress(get_text('selection or line'))
            // 点击图标执行 execute_ddb_line 时直接向上层 throw error 不能展示出错误 message, 因此调用 api 强制显示
        } catch (error) {
            window.showErrorMessage(error.message)
        }
    },
    
    
    async function execute_file () {
        try {
            await execute_with_progress(get_text('all'))
        } catch (error) {
            window.showErrorMessage(error.message)
        }
    },
    
    
    cancel,
    
    
    async function connect (connection: DdbConnection) {
        await explorer.connect(connection)
    },
    
    
    function disconnect (connection: DdbConnection) {
        explorer.disconnect(connection)
    },
    
    
    async function reconnect (connection: DdbConnection) {
        await explorer.reconnect(connection)
    },
    
    
    async function open_settings (setting?: string) {
        const connectionsInspection = workspace.getConfiguration('dolphindb').inspect(setting)
        
        let target = ConfigurationTarget.Global
        switch (true) {
            case !!connectionsInspection.workspaceValue:
                target = ConfigurationTarget.Workspace
                break
            case !!connectionsInspection.workspaceFolderValue:
                target = ConfigurationTarget.WorkspaceFolder
                break
            default:
                break
        }
        
        await open_workbench_settings_ui(target, { query: `@ext:dolphindb.dolphindb-vscode${setting ? ` ${setting}` : ''}` })
    },
    
    
    open_connection_settings,
    
    
    async function inspect_variable (ddbvar: DdbVar) {
        console.log(t('查看 dolphindb 变量:'), ddbvar)
        lastvar = ddbvar
        await ddbvar.inspect()
    },
    
    
    async function open_variable (ddbvar: DdbVar = lastvar) {
        console.log(t('在新窗口查看变量:'), ddbvar)
        await ddbvar.inspect(true)
    },
    
    
    function reload_dataview () {
        const { webview } = dataview.view
        webview.html = webview.html + ' '
    },
    
    
    /** 上传文件预填写默认路径 `getHomeDir() + /uploads/ + 需要上传的文件名` */
    async function upload_file (uri: Uri) {
        // 文件上点右键 upload 时直接向上层 throw error 不能展示出错误 message, 因此调用 api 强制显示
        try {
            const mappings = normalize_mappings(workspace.getConfiguration('dolphindb').get('mappings'))
            
            if (should_remind_setting_mappings && !Object.keys(mappings).length && !await remind_mappings())
                return
            
            let { connection } = explorer
            
            await connection.connect()
            
            let { ddb } = connection
            
            const fp_remote = await window.showInputBox({
                title: t('上传到服务器端的路径'),
                value: resolve_remote_path(
                    uri.fsPath.fp,
                    mappings,
                    (await ddb.call<DdbObj<string>>('getHomeDir')).value
                )
            })
            
            if (!fp_remote) {
                if (fp_remote === '') 
                    window.showErrorMessage(t('文件上传路径不能为空'))
                return
            }
            
            const fpd_remote = fp_remote.fdir
            
            let text: string
            if (uri.scheme === 'untitled')
                text = get_text('all')
            else {
                await workspace.textDocuments.find(doc => doc.fileName === uri.fsPath)?.save()
                text = new TextDecoder('utf-8').decode(
                    await workspace.fs.readFile(Uri.file(uri.fsPath))
                )
            }
            
            if (!(
                await ddb.call<DdbObj<boolean>>('exists', [fpd_remote])
            ).value)
                await ddb.call('mkdir', [fpd_remote])
            
            // Usage: saveTextFile(content, filename,[append=false],[lastModified]). 
            // content must be a string or string vector which stores the text to save.
            await ddb.call('saveTextFile', [text, fp_remote])
            
            window.showInformationMessage(`${t('文件成功上传到: ')}${fp_remote}`)
        } catch (error) {
            window.showErrorMessage(error.message)
            throw error
        }
    },
    
    
    function set_decimals () {
        formatter.prompt()
    },
    
    async function synchronize_module (uri: Uri) {
        try {
            let { connection } = explorer
            
            await connection.connect()
            
            let { ddb } = connection
            
            await workspace.textDocuments.find(doc => doc.fileName === uri.fsPath)?.save()
            const text = new TextDecoder('utf-8').decode(
                await workspace.fs.readFile(Uri.file(uri.fsPath))
            )
            
            // 第二个参数表示如果已存在对应文件，是否要覆盖。如果是false且目录下已存在对应文件，会报错，true直接覆盖旧的文件
            // 第三个参数表示是否加密。false不加密，生成dos文件；true加密，生成dom文件 
            // 返回值为上传路径或错误信息
            const fp = await ddb.call('uploadModule', [text, true, true])
            
            window.showInformationMessage(`${t('文件成功同步到: ')}${fp.value}`)
        } catch (error) {
            window.showErrorMessage(error.message)
            throw error
        }
    }
]

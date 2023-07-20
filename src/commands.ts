import dayjs from 'dayjs'
import path from 'upath'

import { window, workspace, commands, ConfigurationTarget, ProgressLocation, Uri, FileType } from 'vscode'

import { Timer, delay, inspect } from 'xshell'

import { DdbConnectionError, DdbForm, DdbObj, DdbType, InspectOptions } from 'dolphindb'


import { t } from './i18n/index.js'
import { type DdbMessageItem } from './index.js'
import { type DdbConnection, explorer, DdbVar } from './explorer.js'
import { server } from './server.js'
import { statbar } from './statbar.js'
import { get_text, get_common_path, open_workbench_settings_ui, upload_dir, upload_single_file, run_promise_queue } from './utils.js'
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
    
    
    async function open_settings (query?: string) {
        const connectionsInspection = workspace.getConfiguration('dolphindb').inspect('connections')
        
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
        
        await open_workbench_settings_ui(target, { query: `@ext:dolphindb.dolphindb-vscode${query ? ` ${query}` : ''}` })
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
    
    
    /** 上传文件预填写默认路径 `getHomeDir() + /uploads/ + 需要上传的文件名`
        uri为右键选中的文件，uri_list为所有选中的文件列表  */
    async function upload_file (uri: Uri, uri_list: Uri[]) {
        // 文件上点右键 upload 时直接向上层 throw error 不能展示出错误 message, 因此调用 api 强制显示
        try {
            
            // 是否为多文件上传
            const is_multiple = uri_list.length > 1
            const common_path = is_multiple ? get_common_path(uri_list.map(item => item.fsPath)) : ''
            
            let { connection } = explorer
                     
            await connection.connect()
            
            let { ddb } = connection
            
            let { value: fpd_home } = await ddb.call<DdbObj<string>>('getHomeDir')    
    
            const fp_remote = await window.showInputBox({
                title: t('上传到服务器端的路径'),
                value: `${path.normalizeTrim(fpd_home)}/uploads/${is_multiple ? '' : path.basename(uri.path)}`
            })
            
            
            if (!fp_remote) {
                if (fp_remote === '') 
                    window.showErrorMessage(t('文件上传路径不能为空'))
                return
            }
            
            
            const value = await window.showWarningMessage(t('请确认是否将选中的 {{file_num}} 个文件上传至 {{fp_remote}}', { file_num: uri_list.length, fp_remote }), { }, { title: '确认' })
            if (!value)
                return 
            
            
            const upload_list = uri_list.map( async file_uri => { 
                const { type } = await workspace.fs.stat(file_uri)
                
                // 多文件场景下所有文件的公共父目录映射为填入的文件夹，需要手动替换
                const file_path = is_multiple ? file_uri.fsPath.replace(common_path, fp_remote) : fp_remote
                
                if (type === FileType.Directory)
                    return upload_dir(file_uri, file_path, ddb)
                else
                    return upload_single_file(file_uri, file_path, ddb)
            })
            
            await run_promise_queue(upload_list)
            
            window.showInformationMessage(`${t('文件成功上传到: ')}${fp_remote}`)
        } catch (error) {
            window.showErrorMessage(error.message)
            throw error
        }
    },
    
    
    function set_decimals () {
        formatter.prompt()
    }
]

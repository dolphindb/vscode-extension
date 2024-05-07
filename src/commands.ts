import dayjs from 'dayjs'

import { window, workspace, commands, ConfigurationTarget, ProgressLocation, Uri, FileType, debug } from 'vscode'

import { path, Timer, delay, inspect, vercmp, encode } from 'xshell'

import { DdbConnectionError, DdbForm, type DdbObj, DdbType, type InspectOptions } from 'dolphindb'


import type { Variable } from '@vscode/debugadapter'

import { i18n, language, t } from '../i18n/index.js'

import { server } from './server.js'
import { statbar } from './statbar.js'
import { get_text, open_workbench_settings_ui, fdupload, fupload, fdmupload, fmupload, get_formatted_version } from './utils.js'
import { dataview } from './dataview/dataview.js'
import { formatter } from './formatter.js'
import { create_terminal, terminal } from './terminal.js'
import { type DdbConnection, connector } from './connector.js'
import { DdbVar } from './variables.js'
import { databases, type DdbTable } from './databases.js'

import type { DdbMessageItem } from './index.js'


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
        lines_.push(t('··· 共 {{total_lines}} 行 ···', { total_lines: i_non_empty_end - i_first_non_empty }))
    
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
                        throw Error(t('当前连接配置中的 mappings 中存在路径类型错误映射项（1. "文件夹" 路径错误映射到 "文件" 路径；2. "文件" 路径错误映射到 "文件夹" 路径；3. "default" 没有映射到 "文件夹" 路径。）请检查后修改。'))
                    
                    return [normalized_key, normalized_value]
                })
        )
    :
        { }
}


let should_remind_setting_mappings = true

/** 展示 modal 提醒用户设置 mappings, 返回是否还要继续后面的操作 */
async function remind_mappings () {
    const { title } = await window.showInformationMessage(
        t('当前连接未配置路径映射关系，文件会默认上传至 {getHomeDir()}/uploads/ 文件夹下。建议在 dolphindb.connections 的每个连接配置对象中添加 mappings 属性，将本地路径关联到远程路径，后续上传会根据 mappings 进行路径匹配。是否现在配置？'), 
        { modal: true },   
        { title: t('是') },  
        { title: t('否'), isCloseAffordance: true }, 
        { title: t('查看文档') },
        { title: t('不再提醒') }
    )
    
    switch (title) {
        case t('是'):
            await commands.executeCommand('dolphindb.open_settings', 'connections')
            return false
        case t('否'):
            return true
        case t('查看文档'):
            await commands.executeCommand('vscode.open', `https://github.com/dolphindb/vscode-extension${i18n.language === 'zh' ? '/blob/main/README.zh.md#9-文件上传' : '#9-file-upload'}`)
            return false
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
    for (let fp = fp_local, fp_last = null, fp_: string;  fp !== fp_last;  fp_last = fp, fp = fp.fdir)
        if (fp_ = mappings[fp])
            return fp_ + fp_local.slice(fp.length)
    
    return (mappings.default || `${fpd_home}uploads/`) + fp_local.fname
}


async function execute (text: string, testing = false) {
    let { connection } = connector
    
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
    let refresh_database: boolean
    
    try {
        refresh_database = await connection.connect()
        
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
                    
                    if (server)
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
            message = message.replaceAll(/RefId:\s*(\w+)/g, (_, ref_id) => 
                language === 'en' && Number(ref_id.slice(1)) >= 4 
                    ? ''
                    :  `RefId: ${ref_id}`.blue.underline)
        
        printer.fire((
            message.replaceAll('\n', '\r\n') + 
            (connection === connector.connection ? '' : ` (${connection.name})`) + 
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
                        await connector.reconnect(connection)
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
    
    await connection.update(refresh_database)
    connector.refresh(refresh_database)
    
    connection.running = false
    statbar.update()
    
    
    function get_execution_end () {
        return timer.getstr(true) + (connection === connector.connection ? '' : ` (${connection.name})`) + '\r\n'
    }
    
    
    if (testing) {
        printer.fire(
            ((obj.value as (string | null))?.replaceAll('\n', '\r\n').blue || '') +
            get_execution_end()
        )
        
        return
    }
    
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
        
        default:  // DdbForm.scalar, 其他未知类型
            terminal.show(true)
            
            objstr = obj.type === DdbType.void ?
                    ''
                :
                    inspect(obj, { decimals: formatter.decimals } as InspectOptions).replaceAll('\n', '\r\n') + '\r\n'
    }
    
    printer.fire(objstr + get_execution_end())
    
    if (to_inspect)
        await lastvar.inspect()
}


/** 执行代码后，如果超过 1s 还未完成，则显示进度 */
async function execute_with_progress (text: string, testing?: boolean) {
    let { connection } = connector
    
    let done = false
    
    const pexecute = execute(text, testing)
    
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


async function cancel (connection: DdbConnection = connector.connection) {
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
                connector.disconnect(connection)
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


export async function upload (uri: Uri, uris: Uri[], silent = false) {
    let { connection } = connector
    
    if (should_remind_setting_mappings && !connection.mappings && !await remind_mappings())
        return [ ]
    
    const mappings = normalize_mappings(connection.mappings)
    
    await connection.connect()
    
    let { ddb } = connection
    
    const fdp_home = (await ddb.call<DdbObj<string>>('getHomeDir')).value.fpd
    
    let remote_fps = await Promise.all(
        uris.map(async uri =>
            resolve_remote_path(
                (await workspace.fs.stat(uri)).type === FileType.Directory ? uri.fsPath.fpd : uri.fsPath.fp,
                mappings,
                fdp_home
            )
        )
    )
    
    // 单文件场景下用户可以手动填入路径
    if (uris.length === 1) {
        if (!silent)
            remote_fps[0] = await window.showInputBox({
                title: t('上传到服务器端的路径'),
                value: remote_fps[0]
            })
        
        if (!remote_fps[0]) {
            if (remote_fps[0] === '')
                window.showErrorMessage(t('文件上传路径不能为空'))
            return [ ]
        }
    }
    
    const remote_fps_str = (remote_fps.length > 10 ? remote_fps.slice(0, 10) : remote_fps).join_lines(false)
    
    if (!silent && !await window.showInformationMessage(
        t('请确认是否将选中的 {{file_num}} 个文件上传至 {{fp_remote}} {{notice}}（目前版本暂不支持上传二进制文件，二进制文件会被自动忽略）',
        { file_num: uris.length, 
          fp_remote: remote_fps_str,
          notice: remote_fps.length > 10 ? t('\n··· 等，共 {{num}} 个路径', { num: remote_fps.length }) : '' }),
        { modal: true },
        { title: t('确认') }
    ))
        return [ ]
    
    // 暂时用传入数组的方式对二进制文件进行剔除，将成功上传的文件 push 到数组中
    let uploaded_files: string[] = [ ]
    
    for (let i = 0;  i < uris.length;  i++ ) { 
        const uri = uris[i]
        
        // 多文件场景下将文件逐一映射，单文件场景下直接采用 fp_remote
        const fp = remote_fps[i]
        if (remote_fps[i].isdir)
            await fdupload(uri, fp, ddb, uploaded_files)
        else
            await fupload(uri, fp, ddb, uploaded_files)
    }
    
    if (!silent && uploaded_files.length)
        // 等待 server 支持二进制上传后可以用 remote_fps_str
        window.showInformationMessage(`${t('文件成功上传到: ')}${uploaded_files.join_lines(false)}`)
    
    return remote_fps
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
        await connector.connect(connection)
    },
    
    
    function disconnect (connection: DdbConnection) {
        connector.disconnect(connection)
    },
    
    
    async function reconnect (connection: DdbConnection) {
        await connector.reconnect(connection)
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
    
    
    async function inspect_table_variable_schema (ddbvar: DdbVar = lastvar) {
        console.log(t('查看 dolphindb 表结构:'), ddbvar)
        lastvar = ddbvar
        await ddbvar.inspect(false, true)
    },
    
    
    async function inspect_table (ddbtable: DdbTable) {  
        console.log(t('查看 dolphindb 表格:'), ddbtable)
        const obj = await ddbtable.get_obj()      
        lastvar = new DdbVar({ ...obj, obj, bytes: 0n })
        await lastvar.inspect()
    },
    
    
    async function inspect_table_schema (ddbtable: DdbTable) {  
        console.log(t('查看 dolphindb 表结构:'), ddbtable)
        const obj = await ddbtable.get_schema()
        lastvar = new DdbVar({ ...obj, obj, bytes: 0n })
        await lastvar.inspect()
    },
    
    
    async function open_variable (ddbvar?: DdbVar) {
        ddbvar ||= lastvar
        console.log(t('在新窗口查看变量:'), ddbvar)
        await ddbvar.inspect(true)
    },
    
    
    function reload_dataview () {
        const { webview } = dataview.view
        
        // 新版本设置 webview.html 好像没有触发旧 webview 的 dispose, 导致对应的 subscriber 没有清理，不知道是不是 bug, 这里先手动清理下，防止新的 rpc 报错找不到 handler
        dataview.subscribers_inspection = [ ]
        dataview.subscribers_repl = [ ]
        
        webview.html = webview.html + ' '
    },
    
    
    async function reload_databases () {
        await connector.connection.update_databases()
        databases.refresher.fire()
    },
    
    
    /** 批量上传文件  
        uri 为右键选中的文件，uris 为所有选中的文件列表  */
    async function upload_file (uri: Uri, uris: Uri[] | { groupId: 0 }) {
        // 点击图标上传时 uris 不是数组
        if (!Array.isArray(uris))
            uris = [uri]
        // 文件上点右键 upload 时直接向上层 throw error 不能展示出错误 message, 因此调用 api 强制显示
        try {
            await upload(uri, uris)
        } catch (error) {
            window.showErrorMessage(error.message)
            throw error
        }
    },
    
    
    async function unit_test (uri: Uri, uris: []) {
        try {
            for (const fp of await upload(uri, uris, true))
                await execute_with_progress(`test('${fp}')`, true)
        } catch (error) {
            window.showErrorMessage(error.message)
            throw error
        }
    },
    
    
    function set_decimals () {
        formatter.prompt()
    },
    
    
    async function upload_module (uri: Uri, uris: Uri[]) {
        // 文件上点右键 upload_module 时直接向上层 throw error 不能展示出错误 message, 因此调用 api 强制显示
        try {
            let { connection } = connector
            let title: string
            
            await connection.connect()
            
            let { ddb } = connection
            
            // 点击图标上传时 uris 不是数组
            if (!Array.isArray(uris))
                uris = [uri]
            
            if (connector.encrypt === undefined) {
                ({ title } = await window.showInformationMessage(
                    t('是否上传后加密模块？\n若加密，服务器端只保存加密后的 .dom 文件，无法查看源码\n若不加密，服务器端将保存原始文件'), 
                    { modal: true },   
                    { title: t('是') },  
                    { title: t('否') },
                    { title: t('总是加密') },  
                    { title: t('总是不加密') },
                ) || { })
                
                switch (title) {
                    case undefined:
                        return
                    
                    case t('总是加密'):
                        connector.encrypt = true
                        break
                    
                    case t('总是不加密'):
                        connector.encrypt = false
                        break
                }
            }
            
            const fps = (await Promise.all(
                uris.map(async uri =>
                    ((await workspace.fs.stat(uri)).type === FileType.Directory ? fdmupload : fmupload)(uri, title === t('是') || connector.encrypt || false, ddb)
                )
            )).flat()
            
            window.showInformationMessage(`${t('模块成功上传到: ')}${fps.join_lines()}`)
        } catch (error) {
            window.showErrorMessage(error.message)
            throw error
        }
    },
    
    
    async function export_table (ddbvar = lastvar) { 
        try {
            let { ddb } = connector.connection
            
            // 当前数据面板无变量
            if (!ddbvar) { 
                window.showErrorMessage(t('当前没有可导出的表格'))
                return
            }
            
            if (ddbvar.form !== DdbForm.table) { 
                window.showWarningMessage(t('仅支持导出表格'))
                return 
            }
            
            // 2.00.11 以上版本才能使用导出功能
            const version = await get_formatted_version(ddb)
            if (vercmp(version, '2.00.11.0') < 0) { 
                window.showWarningMessage(t('server 版本低于 2.00.11，请升级后再使用此功能'))
                return
            }
            
            // 视图展示的变量非当前连接的变量，切换至变量所属连接
            if (ddbvar && ddbvar.ddb !== ddb) {
                const var_connection = connector.connections.find(item => item.ddb === ddbvar.ddb)
                if (var_connection) {
                    await connector.connect(var_connection) 
                    ddb = connector.connection.ddb
                }
                
            }
            
            const uri = await window.showSaveDialog({
                title: t('导出表格'),
                defaultUri: Uri.file(`./${ddbvar.name || 'table'}.csv`) 
            })
            
            if (uri)  
                window.withProgress(
                    { 
                        title: t('正在导出 ···'),
                        location: ProgressLocation.Notification,
                    },
                    async () => {
                        await connector.connection.define_get_csv_content()
                        const { value: content } = await ddb.call('getCsvContent', [ddbvar.obj || (await ddb.call('objByName', [ddbvar.name]))])
                        await workspace.fs.writeFile(uri, typeof content === 'string' ? encode(content) : content as Buffer)
                        window.showInformationMessage(`${t('文件成功导出到 {{path}}', { path: uri.fsPath.fp })}`)
                    }
                )
        } catch (error) { 
            window.showErrorMessage(error.message)
            throw error
        }
    },
    
    
    async function inspect_debug_variable ({ variable: { name, variablesReference } }: { variable: Variable }) {
        try {
            let { ddb } = connector.connection
            
            // 比较 server 版本，大于 2.00.11.2 版本的 server 才能使用查看变量功能
            const valid_version = '2.00.11.2'
            const version = await get_formatted_version(ddb)
            
            // vercmp('2.00.11.2', '2.00.11.1') = 1
            if (vercmp(version, valid_version) < 0) { 
                window.showWarningMessage(t('请将 server 版本升级至 2.00.11.2 及以上再使用此功能'))
                return
            }
            
            const response = await debug.activeDebugSession.customRequest('stackTrace', { threadId: 1 })
            const frameId = response.stackFrames[0].id
            
            const vid = variablesReference & 0xffff
            
            // 获取 sessionId
            const res: [number, string] = await debug.activeDebugSession.customRequest('getCurrentSessionId')
            
            // todo: 改为用 call 调用
            const result = await ddb.eval(`getVariable(${frameId}, ${vid}, "${name}", ${res[0]})`)
            lastvar = new DdbVar({ ...result, obj: result, bytes: 0n })
            await lastvar.inspect()
        } catch (error) {
            window.showErrorMessage(error.message)
            throw error
        }
    }
]

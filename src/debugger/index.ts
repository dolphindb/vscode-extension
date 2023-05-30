// 整个 Debug 的启动流程是这样的：
// 1. 插件在初始化 (activate) 时会调用 activate.ts 中的 activateDebug 注册一个 debug configuration provider
// 2. 用户启动 debug 会话时，这个 provider 会首先从插件处获取当前连接的数据库 url，动态修改用户 launch 配置
// 3. 这个文件下的 runDebugAdapter 被调用，创建一个 debugSession(adapter)
// 4. 在 debugSession 中，vscode 会依次调用 initialize 、 launch 、 setBreakpoints 、 configurationDone 等，
//     这个过程中会连接服务端，并把用户脚本和断点情况发送过去，服务端验证断点返回，执行到第一个断点处，vscode 等待用户下一步操作

import { createServer, type Server, type Socket } from 'net'

import { DdbDebugSession } from './adapter.js'
import { t } from '../i18n/index.js'


let port = 0

for (const argv of process.argv.slice(2)) {
    const matches = /^--server=(\d{1,5})$/.exec(argv)
    if (matches) {
        port = Number(matches[0])
        break
    }
}


if (port > 0) {
    // 在指定的端口开一个 server，用于调试 debugger (workspace: launch.json: debugServer 配置项)
    console.log(t('调试服务器已启动，等待 VSCode 调试器连接端口 {{port}}', { port }))
    
    let server: Server
    let socket = await new Promise<Socket>(resolve => {
        server = createServer(resolve)
        server.listen(port)
    })
    
    console.log(t('与 VSCode 调试器建立了连接'))
    
    let pend = new Promise<void>(resolve => {
        socket.once('end', resolve)
    })
    
    const session = new DdbDebugSession()
    session.setRunAsServer(true)
    session.start(socket, socket)
    
    await pend
    console.log(t('与 VSCode 调试器的连接已断开'))
    process.exit()
} else {
    const session = new DdbDebugSession()
    
    let pend = new Promise<void>(resolve => {
        process.once('SIGTERM', resolve)
    })
    
    session.start(process.stdin, process.stdout)
    
    await pend
    
    session.shutdown()
}

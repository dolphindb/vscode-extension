import zlib from 'zlib'
import { createServer, type IncomingMessage } from 'http'
import type { Duplex } from 'stream'

import { workspace, extensions, ExtensionKind } from 'vscode'

import type { Context } from 'koa'

import { type Message, Remote } from 'xshell'
import { Server } from 'xshell/server.js'

import { type DDB, type DdbMessage, type InspectOptions } from 'dolphindb'

import { t } from './i18n/index.js'
import { dev, fpd_ext, fpd_node_modules, fpd_src } from './index.js'
import { explorer, type DdbVar } from './explorer.js'
import { dataview } from './dataview/dataview.js'


export let server: DdbServer


class DdbServer extends Server {
    web_url = 'http://localhost:8321/'
    
    subscribers_repl = [ ] as ((message: DdbMessage, ddb: DDB, options?: InspectOptions) => void)[]
    
    subscribers_inspection = [ ] as ((ddbvar: Partial<DdbVar>, open: boolean, options?: InspectOptions, buffer?: Uint8Array, le?: boolean) => any)[]
    
    
    override remote = new Remote({
        funcs: {
            async subscribe_repl ({ id }, websocket) {
                console.log(t('page 已订阅 repl'))
                
                function subscriber ({ type, data }: DdbMessage, ddb: DDB, options?: InspectOptions) {
                    server.remote.send(
                        {
                            id,
                            data: (() => {
                                switch (type) {
                                    case 'print':
                                    case 'error':
                                        return [type, data]
                                    
                                    case 'object':
                                        return [type, data.pack(), data.le, options]
                                }
                            })()
                        },
                        websocket
                    )
                }
                
                server.subscribers_repl.push(subscriber)
                
                function on_close () {
                    console.log(t('page 的 repl 订阅被关闭，因为 websocket 连接被关闭'))
                    websocket.removeEventListener('close', on_close)
                    server.subscribers_repl = server.subscribers_repl.filter(s => s !== subscriber)
                }
                
                websocket.addEventListener('close', on_close)
            },
            
            
            async subscribe_inspection ({ id }, websocket) {
                console.log(t('page 已订阅 inspection'))
                
                function subscriber (ddbvar: Partial<DdbVar>, open: boolean, options: InspectOptions, buffer: Uint8Array | null, le: boolean) {
                    server.remote.send({ id, data: [ddbvar, open, options, buffer, le] }, websocket)
                }
                
                server.subscribers_inspection.push(subscriber)
                
                function on_close () {
                    console.log(t('page 的 inspection 订阅被关闭，因为 websocket 连接被关闭'))
                    websocket.removeEventListener('close', on_close)
                    server.subscribers_inspection = server.subscribers_inspection.filter(s => s !== subscriber)
                }
                
                websocket.addEventListener('close', on_close)
            },
            
            
            async eval ({ data: [node, script] }: Message<[string, string]>, websocket) {
                let { ddb } = explorer.connections.find(({ name }) => name === node)
                const { buffer, le } = await ddb.eval(script, { parse_object: false })
                return [buffer, le]
            },
            
            
            ready (message, websocket) {
                console.log(t('page 已准备就绪'))
                dataview.ppage.resolve()
                return [ ]
            }
        }
    })
    
    
    override async start () {
        const { WebSocketServer } = await import('ws')
        
        const { default: Koa } = await import('koa')
        const { default: KoaCors } = await import('@koa/cors')
        const { default: KoaCompress } = await import('koa-compress')
        
        
        // --- init koa app
        let app = new Koa()
        
        app.on('error', (error, ctx) => {
            console.error(error)
            console.log(ctx)
        })
        
        app.use(this.entry.bind(this))
        
        app.use(
            KoaCompress({
                br: {
                    // https://nodejs.org/api/zlib.html#zlib_class_brotlioptions
                    params: {
                        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
                        [zlib.constants.BROTLI_PARAM_QUALITY]: 6  // default 11 (maximized compression), may lead to news/get generated 14mb json taking 24s
                    },
                },
                threshold: 512
            })
        )
        
        app.use(KoaCors({ credentials: true }))
        
        app.use(this._router.bind(this))
        
        this.app = app
        
        this.handler = this.app.callback()
        
        this.server_http = createServer(this.handler)
        this.server_http.unref()
        
        this.server_ws = new WebSocketServer({
            noServer: true,
            skipUTF8Validation: true,
        })
        
        this.server_ws.on('connection', (websocket, request) => {
            websocket.addEventListener('message', ({ data }) => {
                this.remote.handle(new Uint8Array(data as ArrayBuffer), websocket)
            })
        })
        
        // --- dispatch websocket 连接请求
        this.server_http.on(
            'upgrade',
            this.on_upgrade.bind(this)
        )
        
        // 获取配置的端口
        for (const port of (function * () {
            // 先打开 remote ssh 文件夹，运行代码，在远程主机上会监听 8321 端口，然后由 vscode 转发到本地，但是转发的端口监听的是 127.0.0.1:8321
            // 再打开本地文件夹，运行代码，在本地主机上 8321 依旧监听成功，因为监听的地址是 *:8321
            // 因此，如果插件在远程运行，如 remote-ssh, 那么端口从后往前找第一个可用的，避免转发的端口与本地端口冲突的情况
            // https://code.visualstudio.com/api/advanced-topics/remote-extensions
            // Opening something in a local browser or application
            if (extensions.getExtension('dolphindb.dolphindb-vscode').extensionKind === ExtensionKind.Workspace)  // running remotely
                for (const range of workspace.getConfiguration('dolphindb').get<string>('ports').split(',').reverse()) {
                    const [left, right] = range.split('-').map(x => Number(x))
                    
                    if (!right)
                        yield left
                    
                    for (let i = right;  i >= left;  i--)
                        yield i
                }
            else
                for (const range of workspace.getConfiguration('dolphindb').get<string>('ports').split(',')) {
                    const [left, right] = range.split('-').map(x => Number(x))
                    
                    if (!right)
                        yield left
                    
                    for (let i = left;  i <= right;  i++)
                        yield i
                }
        })())
            try {
                await new Promise<void>((resolve, reject) => {
                    this.server_http.once('error', error => {
                        console.log(`端口 ${port} 监听失败：${error.message}`)
                        reject(error)
                    })
                    
                    this.server_http.listen(port, resolve)
                })
                this.port = port
                this.web_url = `http://localhost:${port}/`
                console.log(t('DolphinDB 插件的 http 服务器启动成功，正在监听:'), this.web_url)
                break
            } catch (error) {
                if (error.code !== 'EADDRINUSE')
                    throw error
            }
    }
    
    
    on_upgrade (request: IncomingMessage, socket: Duplex, head: Buffer) {
        // url 只有路径部分
        const {
            url, 
            headers: { host = '', 'user-agent': ua },
        } = request
        
        const ip = (request.socket.remoteAddress as string).replace(/^::ffff:/, '')
        
        console.log(`${new Date().to_time_str()}    ${(ip || '').pad(40)}  ${(ua || '').limit(40)}  ${'websocket'.pad(10).magenta}    ${'connect'.pad(10).magenta}${host.pad(20)}  ${url.pad(60).yellow}`)
        
        this.server_ws.handleUpgrade(request, socket, head, ws => {
            ws.binaryType = 'arraybuffer'
            this.server_ws.emit('connection', ws, request)
        })
    }
    
    
    override async router (ctx: Context) {
        let { request } = ctx
        
        if (request.path === '/')
            request.path = dev ? '/index.dev.html' : '/index.html'
        
        if (request.path === '/window')
            request.path = '/window.html'
        
        const { path } = request
        
        if (dev && path.startsWith('/vendors/'))
            return this.try_send(ctx, fpd_node_modules, path.slice('/vendors/'.length), true)
        
        if (dev && await this.try_send(ctx, `${fpd_src}dataview/`, path, false))
            return true
        
        return this.try_send(ctx, `${fpd_ext}dataview/`, path, true)
    }
    
    
    override async logger (ctx: Context) {
        // 不需要打印文件请求日志
    }
}


export async function start_server () {
    server = new DdbServer()
    await server.start()
}

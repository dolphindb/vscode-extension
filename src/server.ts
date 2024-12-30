import { workspace, extensions, ExtensionKind } from 'vscode'

import type { Context } from 'koa'

import type { Message } from 'xshell'
import { Server } from 'xshell/server.js'

import { type DDB, type DdbMessage, type InspectOptions } from 'dolphindb'

import { t } from '../i18n/index.ts'

import { dataview } from './dataview/dataview.ts'
import { type DdbVar } from './variables.ts'
import { connector } from './connector.ts'

import { dev, fpd_ext } from './index.ts'


/** 懒初始化的，使用前先检查，未初始化需要调用 start_server 初始化 */
export let server: DdbServer


class DdbServer extends Server {
    web_url = 'http://localhost:8321/'
    
    subscribers_repl = [ ] as ((message: DdbMessage, ddb: DDB, options?: InspectOptions) => void)[]
    
    subscribers_inspection = [ ] as ((ddbvar: Partial<DdbVar>, open: boolean, options?: InspectOptions, buffer?: Uint8Array, le?: boolean) => any)[]
    
    
    override async router (ctx: Context) {
        let { request } = ctx
        
        if (request.path === '/')
            request.path = dev ? '/index.dev.html' : '/index.html'
        
        if (request.path === '/window')
            request.path = '/window.html'
        
        return this.try_send(ctx, request.path, { fpd_root: `${fpd_ext}dataview/` })
    }
}


export async function start_server () {
    const http_port = await Server.get_available_port(
        workspace.getConfiguration('dolphindb').get<string>('ports'),
        
        // running remotely
        extensions.getExtension('dolphindb.dolphindb-vscode').extensionKind === ExtensionKind.Workspace
    )
    
    server = new DdbServer({
        name: 'DdbServer',
        
        http: true,
        
        // 先打开 remote ssh 文件夹，运行代码，在远程主机上会监听 8321 端口，然后由 vscode 转发到本地，但是转发的端口监听的是 127.0.0.1:8321
        // 再打开本地文件夹，运行代码，在本地主机上 8321 依旧监听成功，因为监听的地址是 *:8321
        // 因此，如果插件在远程运行，如 remote-ssh, 那么端口从后往前找第一个可用的，避免转发的端口与本地端口冲突的情况
        // https://code.visualstudio.com/api/advanced-topics/remote-extensions
        // Opening something in a local browser or application
        http_port,
        
        
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
                let { ddb } = connector.connections.find(({ name }) => name === node)
                const { buffer, le } = await ddb.eval(script, { parse_object: false })
                return [buffer, le]
            },
            
            
            ready (message, websocket) {
                console.log(t('page 已准备就绪'))
                dataview.ppage.resolve()
                return [ ]
            }
        },
        
        print: {
            info: true,
            errors: true,
            logs: false
        }
    })
    
    server.web_url = `http://localhost:${http_port}/`
    
    await server.start()
    
    server.http_server.unref()
}

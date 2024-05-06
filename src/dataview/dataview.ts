import { window, type WebviewView, Uri } from 'vscode'

import { type Message, Remote, genid, assert, defer } from 'xshell'

import type { DDB, DdbMessage, InspectOptions } from 'dolphindb'


import { language, t } from '../i18n/index.js'
import { get_vendors } from '../config.js'
import { dev, fpd_ext } from '../index.js'
import { type DdbVar } from '../vars.js'
import { connector } from '../connector.js'


type ViewMessageHandler <TData extends any[] = any[]> = (message: Message<TData>, view: WebviewView) => void | any[] | Promise<void | any[]>


/** 基于 vscode webview 相关的消息函数 postMessage, onDidReceiveMessage, window.addEventListener('message', ...) 实现的 rpc  */
export let dataview = {
    view: null as WebviewView,
    
    /** map<id, message handler>: 通过 rpc message.id 找到对应的 handler, unary rpc 接收方不需要设置 handlers, 发送方需要 */
    handlers: new Map<number, ViewMessageHandler>(),
    
    print: false,
    
    
    subscribers_repl: [ ] as ((message: DdbMessage, ddb: DDB, options?: InspectOptions) => void)[],
    
    subscribers_inspection: [ ] as ((ddbvar: Partial<DdbVar>, open: boolean, options?: InspectOptions, buffer?: Uint8Array, le?: boolean) => any)[],
    
    pwebview: defer<void>(),
    
    ppage: defer<void>(),
    
    
    /** 通过 rpc message.func 被调用的 rpc 函数 */
    funcs: {
        async subscribe_repl ({ id }, view) {
            console.log(t('webview 已订阅 repl'))
            
            function subscriber ({ type, data }: DdbMessage, ddb: DDB, options?: InspectOptions) {
                dataview.send(
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
                    }
                )
            }
            
            dataview.subscribers_repl.push(subscriber)
            
            view.onDidDispose(() => {
                console.log(t('webview 的 repl 订阅被关闭，因为 dataview 被关闭'))
                dataview.subscribers_repl = dataview.subscribers_repl.filter(s => s !== subscriber)
                
                dataview.view = null
                dataview.pwebview = defer<void>()
            })
        },
        
        
        async subscribe_inspection ({ id }, view) {
            console.log(t('webview 已订阅 inspection'))
            
            function subscriber (ddbvar: Partial<DdbVar>, open: boolean, options?: InspectOptions, buffer?: Uint8Array, le?: boolean) {
                dataview.send({ id, data: [ddbvar, open, options, buffer, le] })
            }
            
            dataview.subscribers_inspection.push(subscriber)
            
            view.onDidDispose(() => {
                console.log(t('webview 的 inspection 订阅被关闭，因为 dataview 被关闭'))
                dataview.subscribers_inspection = dataview.subscribers_inspection.filter(s => s !== subscriber)
            })
        },
        
        
        async eval ({ data: [node, script] }: Message<[string, string]>, view) {
            let { ddb } = connector.connections.find(({ name }) => name === node)
            const { buffer, le } = await ddb.eval(script, { parse_object: false })
            return [buffer, le]
        },
        
        
        ready (message, view) {
            console.log(t('dataview 已准备就绪'))
            dataview.pwebview.resolve()
            return [ ]
        }
    } as Record<string, ViewMessageHandler>,
    
    
    register () {
        window.registerWebviewViewProvider(
            'ddbdataview',
            {
                async resolveWebviewView (view, ctx, canceller) {
                    dataview.view = view
                    
                    let { webview } = view
                    
                    webview.options = { enableCommandUris: true, enableScripts: true }
                    webview.onDidReceiveMessage(
                        (message: ArrayBuffer) => {
                            dataview.handle(new Uint8Array(message))
                        }
                    )
                    
                    webview.html = 
                        '<!doctype html>\n' +
                        '<html>\n' +
                        '    <head>\n' +
                        '        <title>DolphinDB</title>\n' +
                        "        <meta charset='utf-8' />\n" +
                        '        <script>\n' +
                        `            window.language = '${language}'\n` +
                        '        </script>\n' +
                        
                        get_vendors(dev)
                            .filter(fp => !fp.endsWith('.map'))
                            .map(vendor => `        <script src='${webview.asWebviewUri(Uri.file(`${fpd_ext}dataview/vendors/${vendor}`))}' defer></script>\n`)
                            .join_lines() +
                        
                        `        <script src='${webview.asWebviewUri(Uri.file(`${fpd_ext}dataview/webview.js`))}' type='module'></script>\n` +
                        '    </head>\n' +
                        '    <body>\n' +
                        "        <div class='root'></div>\n" +
                        '    </body>\n' +
                        '</html>\n'
                }
            },
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    },
    
    
    /** 发送或连接出错时自动清理 message.id 对应的 handler */
    async send (message: Message) {
        if (!message.id)
            message.id = genid()
        
        try {
            assert(await this.view.webview.postMessage(Remote.pack(message).buffer))
        } catch (error) {
            this.handlers.delete(message.id)
            throw error
        }
    },
    
    
    /** 处理接收到的 message 并解析, 根据 id dispatch 到对应的 handler 进行处理  
        如果 message.done == true 则清理 handler  
        如果 handler 返回了值，则包装为 message 发送  
        使用 Uint8Array 作为参数更灵活 https://stackoverflow.com/a/74505197/7609214  */
    async handle (data: Uint8Array) {
        const message = Remote.parse(data)
        
        const { id, func, done } = message
        
        if (this.print)
            console.log(message)
        
        let handler: ViewMessageHandler
        
        if (func)
            handler = this.funcs[func]
        else {
            handler = this.handlers.get(id)
            if (done)
                this.handlers.delete(id)
        }
        
        try {
            if (handler) {
                const data = await handler(message, this.view)
                if (data)
                    await this.send({ id, data })
            } else if (message.error)
                throw message.error
            else
                throw new Error(`${t('找不到 rpc handler')}: ${func ? `func: ${func.quote()}` : `id: ${id}`}`)
        } catch (error) {
            // handle 出错并不意味着 rpc 一定会结束，可能 error 是运行中的正常数据，所以不能清理 handler
            
            if (!message.error)  // 防止无限循环往对方发送 error, 只有在对方无错误时才可以发送
                await this.send({ id, error, /* 不能设置 done 清理对面 handler, 理由同上 */ })
            
            throw error
        }
    },
    
    
    /** 调用 remote 中的 func, 只适用于最简单的一元 rpc (请求, 响应) */
    async call <TReturn extends any[] = any[]> (func: string, args?: any[]) {
        return new Promise<TReturn>(async (resolve, reject) => {
            const id = genid()
            
            this.handlers.set(id, (message: Message<TReturn>) => {
                const { error, data } = message
                if (error)
                    reject(error)
                else
                    resolve(data)
                this.handlers.delete(id)
            })
            
            try {
                await this.send({ id, func, data: args })  // 不需要 done: true, 因为对面的 remote.handlers 中不会有这个 id 的 handler
            } catch (error) {
                reject(error)
            }
        })
    }
}

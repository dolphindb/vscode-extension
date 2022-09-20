import 'antd/dist/antd.css'

import './webview.sass'


import { default as React, useEffect } from 'react'
import { createRoot as create_root } from 'react-dom/client'

import { ConfigProvider } from 'antd'
import zh from 'antd/lib/locale/zh_CN.js'
import en from 'antd/lib/locale/en_US.js'
import ja from 'antd/lib/locale/ja_JP.js'
import ko from 'antd/lib/locale/ko_KR.js'
const locales = { zh, en, ja, ko }

import { Model } from 'react-object-model'

import { genid } from 'xshell/utils.browser.js'
import { Remote, type Message } from 'xshell/net.browser.js'
import { DdbObj, DdbForm, type InspectOptions } from 'dolphindb/browser.js'

import { language } from '../i18n/index.js'

import { Obj, DdbObjRef } from './obj.js'


interface VSCodeWebview {
    postMessage (message: any, transfer?: ArrayBuffer[]): void
    getState (): any
    setState (state: any): void
}

declare function acquireVsCodeApi (): VSCodeWebview

let vscode = acquireVsCodeApi()


/** 接收到消息后的处理函数  
    返回值可以是:
    - 数组: 会自动被封装为 { id: 相同, data: 返回值, done: true } 这样的消息并调用 websocket.send 将其发送
    - void: 什么都不做
    - 以上的 promise */
type MessageHandler = (message: Message) => void | any[] | Promise<void | any[]>

// LOCAL
// let remote = new Remote({ url: 'ws://localhost/ddb' })
let remote = {
    /** 通过 rpc message.func 被调用的 rpc 函数 */
    funcs: { } as Record<string, MessageHandler>,
    
    /** map<id, message handler>: 通过 rpc message.id 找到对应的 handler, unary rpc 接收方不需要设置 handlers, 发送方需要 */
    handlers: new Map<number, MessageHandler>(),
    
    print: false,
    
    
    init () {
        window.addEventListener('message', ({ data }) => {
            remote.handle(data)
        })
    },
    
    
    send (message: Message) {
        if (!message.id)
            message.id = genid()
        
        try {
            const { buffer } = Remote.pack(message)
            vscode.postMessage(buffer, [buffer])
        } catch (error) {
            this.handlers.delete(message.id)
            throw error
        }
    },
    
    
    /** 处理接收到的 websocket message 并解析, 根据 id dispatch 到对应的 handler 进行处理  
        如果 message.done == true 则清理 handler  
        如果 handler 返回了值，则包装为 message 发送 */
    async handle (buffer: ArrayBuffer) {
        const message = Remote.parse(buffer)
        
        const { id, func, done } = message
        
        if (this.print)
            console.log(message)
        
        let handler: MessageHandler
        
        if (func)
            handler = this.funcs[func]
        else {
            handler = this.handlers.get(id)
            if (done)
                this.handlers.delete(id)
        }
        
        try {
            if (handler) {
                const data = await handler(message)
                if (data)
                    this.send({ id, data })
            } else if (message.error)
                throw message.error
            else
                throw new Error(`找不到 rpc handler: ${func ? `func: ${func.quote()}` : `id: ${id}`}`)
        } catch (error) {
            // handle 出错并不意味着 rpc 一定会结束，可能 error 是运行中的正常数据，所以不能清理 handler
            
            if (!message.error)  // 防止无限循环往对方发送 error, 只有在对方无错误时才可以发送
                try { this.send({ id, error, /* 不能设置 done 清理对面 handler, 理由同上 */ }) } catch { }
            
            // 再往上层抛出错误没有意义了，上层调用栈是 websocket.on('message') 之类的
            console.log(error)
        }
    },
    
    
    /** 调用 remote 中的 func, 适用于最简单的一元 rpc (请求, 响应) */
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
            
            this.send({ id, func, data: args })  // 不需要 done: true, 因为对面的 remote.handlers 中不会有这个 id 的 handler
        })
    }
}


class DataViewModel extends Model<DataViewModel> {
    result?: { type: 'object', data: DdbObj } | { type: 'objref', data: DdbObjRef }
    
    options?: InspectOptions
    
    
    async init () {
        remote.init()
        
        
        // --- subscribe repl rpc (一个请求，无限个响应)
        
        const id_repl = genid()
        
        remote.handlers.set(
            id_repl,
            async ({ /* error 可能会有，但在 webview 里不关心 */ data: [type, data, le, options] }: Message<
                ['print', string] |
                ['object', Uint8Array, boolean, InspectOptions?] |
                ['error', any]
            >) => {
                if (type !== 'object')
                    return
                
                data = DdbObj.parse(data, le)
                
                switch ((data as DdbObj).form) {
                    case DdbForm.scalar:
                    case DdbForm.pair:
                        break
                    
                    default:
                        this.set({ result: { type, data }, options: options === null ? undefined : options })
                }
            })
        
        remote.send({ id: id_repl, func: 'subscribe_repl' })
        
        // --- subscribe inspection rpc (一个请求，无限个响应)
        
        const id_inspection = genid()
        
        remote.handlers.set(
            id_inspection,
            async ({ data: [ddbvar, open, options, buffer, le] }: 
                Message<[any, boolean, InspectOptions?, Uint8Array?, boolean?]>
            ) => {
                if (buffer)
                    ddbvar.obj = DdbObj.parse(buffer, le)
                
                ddbvar.bytes = BigInt(ddbvar.bytes)
                
                if (options === null)
                    options = undefined
                
                if (ddbvar.obj)
                    if (open) { } 
                    else
                        this.set({ result: { type: 'object', data: ddbvar.obj }, options })
                else {
                    const objref = new DdbObjRef(ddbvar)
                    if (open) { }
                    else
                        this.set({ result: { type: 'objref', data: objref }, options })
                }
            })
        
        remote.send({ id: id_inspection, func: 'subscribe_inspection' })
    }
}

let model = window.model = new DataViewModel()


function DataView () {
    const { result, options } = model.use(['result', 'options'])
    
    useEffect(() => {
        model.init()
    }, [ ])
    
    if (!result)
        return null
    
    const { type, data } = result
    
    return <ConfigProvider locale={locales[language] as any} autoInsertSpaceInButton={false}>{
        <div className='result webview'>{
            type === 'object' ?
                <Obj obj={data} remote={remote} ctx='webview' options={options} />
            :
                <Obj objref={data} remote={remote} ctx='webview' options={options} />
        }</div>
    }</ConfigProvider>
}


create_root(
    document.querySelector('.root')
).render(<DataView/>)

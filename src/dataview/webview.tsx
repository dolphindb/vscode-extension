import './webview.sass'
import './pagination.sass'

import { useEffect } from 'react'
import { createRoot as create_root } from 'react-dom/client'

import { ConfigProvider, App } from 'antd'
import zh from 'antd/es/locale/zh_CN.js'
import en from 'antd/locale/en_US.js'
import ja from 'antd/locale/ja_JP.js'
import ko from 'antd/locale/ko_KR.js'

import type { MessageInstance } from 'antd/es/message/interface.js'
import type { ModalStaticFunctions } from 'antd/es/modal/confirm.js'
import type { NotificationInstance } from 'antd/es/notification/interface.js'

import { Model } from 'react-object-model'

import { check, genid } from 'xshell/utils.browser.js'
import { message_symbol, pack, parse, type Message } from 'xshell/io.browser.js'
import { DdbObj, DdbForm, type InspectOptions } from 'dolphindb/browser.js'

import { language } from '@i18n/index.ts'

import { Obj, DdbObjRef } from './obj.tsx'


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
type MessageHandler <TData extends any[] = any[]> = (message: Message<TData>) => void | any[] | Promise<void | any[]>


let remote = {
    /** 通过 rpc message.func 被调用的 rpc 函数 */
    funcs: { } as Record<string, MessageHandler>,
    
    /** map<id, message handler>: 通过 rpc message.id 找到对应的 handler, unary rpc 接收方不需要设置 handlers, 发送方需要 */
    handlers: new Map<number, MessageHandler>(),
    
    verbose: false,
    
    
    init () {
        window.addEventListener('message', ({ data }) => {
            remote.handle(new Uint8Array(data))
        })
    },
    
    
    send (message: Message) {
        message[message_symbol] = true
        
        try {
            const { buffer } = pack(message).slice()
            vscode.postMessage(buffer, [buffer])
        } catch (error) {
            if (message.id)
                this.handlers.delete(message.id)
            throw error
        }
    },
    
    
    /** 处理接收到的 websocket message 并解析, 根据 id dispatch 到对应的 handler 进行处理  
        如果 message.done == true 则清理 handler  
        如果 handler 返回了值，则包装为 message 发送  
        使用 Uint8Array 作为参数更灵活 https://stackoverflow.com/a/74505197/7609214  */
    async handle (data: Uint8Array) {
        let message: Message
        try {
            check(data[0] === 0xcc, 'message 格式错误')
            message = parse<Message>(data)
        } catch (error) {
            console.log(error)
            return
        }
        
        const { id, func, done } = message
        
        if (this.verbose)
            console.log(message)
        
        let handler: MessageHandler
        
        if (func) {
            handler = this.funcs[func]
            
            // 传了 func 调用函数的情况下，如果 message.data 为 undefined, 默认为 [ ]
            if (message.data === undefined)
                message.data = [ ]
        } else {
            handler = this.handlers.get(id)
            if (done)
                this.handlers.delete(id)
        }
        
        try {
            if (handler) {
                const data = await handler(message)
                if (func || data !== undefined)
                    this.send({ id, data })
            } else
                throw message.error || new Error(`找不到 rpc handler: ${func ? `func: ${func.quote()}` : `id: ${id}`}`)
        } catch (error) {
            // handle 出错并不意味着 rpc 一定会结束，可能 error 是运行中的正常数据，所以不能清理 handler
            
            if (!message.error)  // 防止无限循环往对方发送 error, 只有在对方无错误时才可以发送
                this.send({ id, error, /* 不能设置 done 清理对面 handler, 理由同上 */ })
            
            // 这里继续往上层抛没有太大意义，上面一般都是 websocket on_message 这些，交给自定义或默认的 on_error 处理
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
            
            try {
                this.send({ id, func, data: args })  // 不需要 done: true, 因为对面的 remote.handlers 中不会有这个 id 的 handler
            } catch (error) {
                reject(error)
            }
        })
    }
}


class DataViewModel extends Model<DataViewModel> {
    result?: { type: 'object', data: DdbObj } | { type: 'objref', data: DdbObjRef }
    
    options?: InspectOptions
    
    message: MessageInstance
    
    modal: Omit<ModalStaticFunctions, 'warn'>
    
    notification: NotificationInstance
    
    
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
        
        await remote.call('ready')
    }
}

let model = window.model = new DataViewModel()

create_root(
    document.querySelector('.root')
).render(<Root />)


const locales = { zh, en, ja, ko }

function Root () {
    return <ConfigProvider
        locale={locales[language] as any}
        button={{ autoInsertSpace: false }}
        theme={{ hashed: false, token: { borderRadius: 0, motion: false } }}
    >
        <App className='app'>
            <DataView />
        </App>
    </ConfigProvider>
}


function DataView () {
    const { result, options } = model.use(['result', 'options'])
    
    // App 组件通过 Context 提供上下文方法调用，因而 useApp 需要作为子组件才能使用
    Object.assign(model, App.useApp())
    
    useEffect(() => {
        model.init()
    }, [ ])
    
    if (!result)
        return null
    
    const { type, data } = result
    
    return <div className='obj-result themed webview'>
        <Obj 
            remote={remote} 
            ctx='webview' 
            options={options} 
            {...type === 'object' ? { obj: data } : { objref: data }}
        />
    </div>
}


import 'antd/dist/antd.css'

import './webview.sass'

import { default as React, useEffect } from 'react'
import { createRoot as create_root } from 'react-dom/client'

import {
    ConfigProvider,
} from 'antd'
import zh from 'antd/lib/locale/zh_CN.js'
import en from 'antd/lib/locale/en_US.js'
import ja from 'antd/lib/locale/ja_JP.js'
import ko from 'antd/lib/locale/ko_KR.js'
const locales = { zh, en, ja, ko }

import { Model } from 'react-object-model'

import {
    Remote,
    type Message,
} from 'xshell/net.browser.js'
import {
    DdbObj,
    DdbForm,
} from 'dolphindb/browser.js'

import { language } from '../i18n/index.js'

import { Obj, DdbObjRef, open_obj } from './obj.js'



interface VSCodeWebview {
    postMessage (message: any, transfer?: ArrayBuffer[]): void
    getState (): any
    setState (state: any): void
}

declare function acquireVsCodeApi (): VSCodeWebview

let vscode = acquireVsCodeApi()


let remote = {
    id: 0,
    
    /** 调用方发起的 rpc 对应响应的 message 处理器 */
    handlers: [ ] as ((message: Message) => any)[],
    
    print: false,
    
    
    /** 被调方的 message 处理器 */
    funcs: { } as Record<
        string, 
        (message: Message) => void | Promise<void>
    >,
    
    
    init () {
        window.addEventListener(
            'message',
            ({ data }) => {
                remote.handle(data)
            }
        )
    },
    
    
    send (message: Message) {
        if (!('id' in message))
            message.id = this.id
        
        const { buffer } = Remote.pack(message)
        
        vscode.postMessage(buffer, [buffer])
    },
    
    
    /** 调用 remote 中的 func, 中间消息及返回结果可由 handler 处理，处理 done message 之后的返回值作为 call 函数的返回值 
        如果为 unary rpc, 可以不传 handler, await call 之后可以得到响应 message 的 args
    */
    async call <T extends any[] = any[]> (
        message: Message,
        handler?: (message: Message<T>) => any
    ) {
        return new Promise<T>((resolve, reject) => {
            this.handlers[this.id] = async (message: Message<T>) => {
                const { error, done } = message
                
                if (error) {
                    reject(
                        Object.assign(
                            new Error(),
                            error
                        )
                    )
                    return
                }
                
                const result = handler ?
                        await handler(message)
                    :
                        message.args
                
                if (done)
                    resolve(result)
            }
            
            this.send(message)
            
            this.id++
        })
    },
    
    
    /** 处理接收到的 message
        1. 被调用方接收 message 并开始处理
        2. 调用方处理 message 响应
    */
    async handle (buffer: ArrayBuffer) {
        const message = Remote.parse(buffer)
        
        const { func, id, done } = message
        
        if (this.print)
            console.log(message)
        
        if (func) // 作为被调方
            try {
                const handler = this.funcs[func]
                
                if (!handler)
                    throw new Error(`找不到 rpc handler for '${func}'`)
                
                await handler(message)
            } catch (error) {
                this.send(
                    {
                        id,
                        error,
                        done: true
                    },
                )
                
                throw error
            }
        else {  // 作为发起方
            this.handlers[id](message)
            
            if (done)
                this.handlers[id] = null
        }
    }
}


export type Result = { type: 'object', data: DdbObj } | { type: 'objref', data: DdbObjRef }

export class DataViewModel extends Model<DataViewModel> {
    result: Result
    
    
    async init () {
        remote.init()
        
        remote.call(
            { func: 'subscribe_repl' },
            async ({
                args: [type, data, le]
            }: Message<
                ['print', string] |
                ['object', Uint8Array, boolean] |
                ['error', any]
            >) => {
                if (type === 'object')
                    data = DdbObj.parse(data, le)
                
                if (
                    type === 'object' && 
                    (data as DdbObj).form !== DdbForm.scalar && 
                    (data as DdbObj).form !== DdbForm.pair
                )
                    this.set({
                        result: {
                            type,
                            data
                        }
                    })
            }
        )
        
        remote.call(
            { func: 'subscribe_inspection' },
            async ({
                args: [ddbvar, open, buffer, le]
            }) => {
                if (buffer)
                    ddbvar.obj = DdbObj.parse(buffer, le)
                
                ddbvar.bytes = BigInt(ddbvar.bytes)
                
                if (ddbvar.obj)
                    if (open)
                        await open_obj({
                            obj: ddbvar.obj,
                            objref: null,
                            remote
                        })
                    else
                        this.set({
                            result: {
                                type: 'object',
                                data: ddbvar.obj,
                            }
                        })
                else {
                    const objref = new DdbObjRef(ddbvar)
                    if (open)
                        await open_obj({
                            obj: null,
                            objref: objref,
                            remote
                        })
                    else
                        this.set({
                            result: {
                                type: 'objref',
                                data: objref
                            }
                        })
                }
            }
        )
    }
}

let model = window.model = new DataViewModel()


function DataView () {
    const { result } = model.use(['result'])
    
    useEffect(() => {
        model.init()
    }, [ ])
    
    if (!result)
        return <div>DolphinDB Data Browser</div>
    
    const { type, data } = result
    
    return <ConfigProvider locale={locales[language]} autoInsertSpaceInButton={false}>{
        <div className='result'>{
            type === 'object' ?
                <Obj obj={data} remote={remote} />
            :
                <Obj objref={data} remote={remote} />
        }</div>
    }</ConfigProvider>
}


create_root(
    document.querySelector('.root')
).render(<DataView/>)

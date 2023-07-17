import 'xshell/scroll-bar.sass'

import './index.sass'


import { default as React, useEffect } from 'react'
import { createRoot as create_root } from 'react-dom/client'

import {
    ConfigProvider,
    
    // @ts-ignore 使用了 antd-with-locales 之后 window.antd 变量中有 locales 属性
    locales
} from 'antd'

import { Model } from 'react-object-model'

import { genid } from 'xshell/utils.browser.js'
import { Remote, type Message } from 'xshell/net.browser.js'
import { DdbObj, DdbForm, type InspectOptions } from 'dolphindb/browser.js'

import { language } from '../i18n/index.js'

import { Obj, DdbObjRef, open_obj } from './obj.js'


const locale_names = {
    zh: 'zh_CN',
    en: 'en_US',
    ja: 'ja_JP',
    ko: 'ko_KR'
} as const


let remote = new Remote({ url: `ws://${location.host}` })


class DataViewModel extends Model<DataViewModel> {
    result?: { type: 'object', data: DdbObj } | { type: 'objref', data: DdbObjRef }
    
    options?: InspectOptions
    
    
    async init () {
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
                    if (open)
                        await open_obj({ obj: ddbvar.obj, objref: null, remote, options })
                    else
                        this.set({ result: { type: 'object', data: ddbvar.obj }, options })
                else {
                    const objref = new DdbObjRef(ddbvar)
                    if (open)
                        await open_obj({ obj: null, objref: objref, remote, options })
                    else
                        this.set({ result: { type: 'objref', data: objref }, options })
                }
            })
        
        remote.send({ id: id_inspection, func: 'subscribe_inspection' })
        
        await remote.call('ready')
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
    
    return <ConfigProvider locale={locales[locale_names[language]]} autoInsertSpaceInButton={false} theme={{ hashed: false }}>
        <div className='result page'>{
            type === 'object' ?
                <Obj obj={data} remote={remote} ctx='page' options={options} />
            :
                <Obj objref={data} remote={remote} ctx='page' options={options} />
        }</div>
    </ConfigProvider>
}


create_root(
    document.querySelector('.root')
).render(<DataView/>)

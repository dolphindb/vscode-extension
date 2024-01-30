import 'xshell/scroll-bar.sass'

import './index.sass'
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

import { genid } from 'xshell/utils.browser.js'
import { Remote, type Message } from 'xshell/net.browser.js'
import { DdbObj, DdbForm, type InspectOptions } from 'dolphindb/browser.js'

import { language } from '../i18n/index.js'

import { Obj, DdbObjRef, open_obj } from './obj.js'


let remote = new Remote({ url: `ws://${location.host}` })


class DataViewModel extends Model<DataViewModel> {
    result?: { type: 'object', data: DdbObj } | { type: 'objref', data: DdbObjRef }
    
    options?: InspectOptions
    
    message: MessageInstance
    
    modal: Omit<ModalStaticFunctions, 'warn'>
    
    notification: NotificationInstance
    
    
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


create_root(
    document.querySelector('.root')
).render(<Root />)


const locales = { zh, en, ja, ko }

function Root () {
    return <ConfigProvider
        locale={locales[language] as any}
        autoInsertSpaceInButton={false}
        theme={{ hashed: false, token: { borderRadius: 0, motion: false } }}
    >
        <App>
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
    
    return <div className='obj-result themed page themed-pagination'>{
        type === 'object' ?
            <Obj obj={data} remote={remote} ctx='page' options={options} />
        :
            <Obj objref={data} remote={remote} ctx='page' options={options} />
    }</div>
}


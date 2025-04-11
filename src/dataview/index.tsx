import 'xshell/scroll-bar.sass'

import './index.sass'
import './pagination.sass'


import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'

import { ConfigProvider, App } from 'antd'
import zh from 'antd/es/locale/zh_CN.js'
import en from 'antd/locale/en_US.js'
import ja from 'antd/locale/ja_JP.js'
import ko from 'antd/locale/ko_KR.js'

import type { MessageInstance } from 'antd/es/message/interface.d.ts'
import type { HookAPI as ModalHookAPI } from 'antd/es/modal/useModal/index.d.ts'
import type { NotificationInstance } from 'antd/es/notification/interface.d.ts'

import { Model } from 'react-object-model'

import { noop } from 'xshell/prototype.browser.js'
import { timeout } from 'xshell/utils.browser.js'
import { Remote } from 'xshell/net.browser.js'
import { DdbObj, DdbForm, type InspectOptions } from 'dolphindb/browser.js'

import { language } from '@i18n'

import { Obj, DdbObjRef, open_obj } from './obj.tsx'


let remote = new Remote({ url: `ws://${location.host}` })


class DataViewModel extends Model<DataViewModel> {
    result?: { type: 'object', data: DdbObj } | { type: 'objref', data: DdbObjRef }
    
    options?: InspectOptions
    
    message: MessageInstance
    
    modal: ModalHookAPI
    
    notification: NotificationInstance
    
    
    async init () {
        type ReplData = 
            ['print', string] |
            ['object', Uint8Array, boolean, InspectOptions?] |
            ['error', any] |
            undefined
        
        await timeout(
            2000,
            Promise.all([
                remote.subscribe<ReplData>(
                    'subscribe_repl',
                    ([type, data, le, options]) => {
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
                    },
                    // error 可能会有，但在 dataview 里不关心
                    { on_error: noop }
                ),
                
                remote.subscribe<[any, boolean, InspectOptions?, Uint8Array?, boolean?]>(
                    'subscribe_inspection', 
                    async ([ddbvar, open, options, buffer, le]) => {
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
                    },
                    // error 可能会有，但在 dataview 里不关心
                    { on_error: noop }
                )
            ])
        )
        
        await remote.call('ready')
    }
}


let model = window.model = new DataViewModel()


createRoot(
    document.querySelector('.root')
).render(<Root />)


const locales = { zh, en, ja, ko }

function Root () {
    return <ConfigProvider
        locale={locales[language] as any}
        button={{ autoInsertSpace: false }}
        theme={{ hashed: false, token: { borderRadius: 0, motion: false, controlOutlineWidth: 0 } }}
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
    
    return <div className='obj-result themed page'>{
        type === 'object' ?
            <Obj obj={data} remote={remote} ctx='page' options={options} />
        :
            <Obj objref={data} remote={remote} ctx='page' options={options} />
    }</div>
}


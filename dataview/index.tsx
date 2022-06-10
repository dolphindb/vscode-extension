import 'antd/dist/antd.css'

import 'xshell/scroll-bar.sass'

import './myfont.sass'

import './index.sass'


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



export type Result = { type: 'object', data: DdbObj } | { type: 'objref', data: DdbObjRef }

export class DataViewModel extends Model<DataViewModel> {
    remote = new Remote({
        url: `ws://${location.host}`,
    })
    
    result: Result
    
    
    async init () {
        this.remote.call(
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
        
        this.remote.call(
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
                            remote: this.remote
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
                            remote: this.remote
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
    const { result, remote } = model.use(['result', 'remote'])
    
    useEffect(() => {
        model.init()
    }, [ ])
    
    if (!result || !remote)
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

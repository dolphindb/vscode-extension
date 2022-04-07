import './index.sass'
import 'xshell/scroll-bar.sass'
import 'xshell/myfont.sass'

import { default as React, useEffect } from 'react'
import ReactDOM from 'react-dom'
import {
    ConfigProvider,
} from 'antd'
import zh from 'antd/lib/locale/zh_CN'
import en from 'antd/lib/locale/en_US'
import ja from 'antd/lib/locale/ja_JP'
import ko from 'antd/lib/locale/ko_KR'


import { Model } from 'react-object-model'

import { delay } from 'xshell/utils.browser'
import {
    Remote,
    type Message,
} from 'xshell/net.browser'
import {
    DdbObj,
    type DdbMessage,
} from 'dolphindb/browser'

import { language } from '../i18n'

import { Obj, DdbObjRef, open_obj } from './obj'


const locales = { zh, en, ja, ko }

export type Result = DdbMessage | { type: 'objref', data: DdbObjRef }

export class DataViewModel extends Model<DataViewModel> {
    remote = new Remote({
        url: 'ws://localhost:8321/',
    })
    
    results: Result[] = [ ]
    
    
    async init () {
        await this.remote.connect()
        
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
                
                await this.append_result({ type, data })
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
                        await this.append_result({ type: 'object', data: ddbvar.obj })
                else {
                    const objref = new DdbObjRef(ddbvar)
                    if (open)
                        await open_obj({
                            obj: null,
                            objref: objref,
                            remote: this.remote
                        })
                    else
                        await this.append_result({ type: 'objref', data: objref })
                }
            }
        )
    }
    
    
    async append_result (result: Result) {
        console.log('append', result)
        this.results.push(result)
        
        this.render(['results'])
        
        await delay(100)
        window.scrollTo(0, document.body.scrollHeight)
    }
}

let model = window.model = new DataViewModel()


function DataView () {
    const { results, remote } = model.use(['results', 'remote'])
    
    useEffect(() => {
        model.init()
    }, [ ])
    
    if (!results.length || !remote)
        return <div>DolphinDB DataView</div>
    
    return <ConfigProvider locale={locales[language]} autoInsertSpaceInButton={false}>{
        results.map(({ type, data }, i) =>
            <div key={i} className='result'>{
                (() => {
                    switch (type) {
                        case 'print':
                            return <div className='print'>{data}</div>
                            
                        case 'error':
                            return <div className='error'>{data.message}</div>
                        
                        case 'object':
                            return <Obj obj={data} remote={remote} />
                            
                        case 'objref':
                            return <Obj objref={data} remote={remote} />
                    }
                })()
            }</div>
        )
    }</ConfigProvider>
}


ReactDOM.render(
    <DataView/>,
    document.querySelector('.root')
)

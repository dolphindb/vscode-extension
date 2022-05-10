import 'antd/dist/antd.css'

import 'xshell/scroll-bar.sass'

import '../fonts/myfont.sass'

import './window.sass'


import { default as React, useEffect } from 'react'
import { createRoot as create_root } from 'react-dom/client'

import { ConfigProvider } from 'antd'
import zh from 'antd/lib/locale/zh_CN'
import en from 'antd/lib/locale/en_US'
import ja from 'antd/lib/locale/ja_JP'
import ko from 'antd/lib/locale/ko_KR'


import { Model } from 'react-object-model'

import { language } from '../i18n'
import { DdbForm, type DdbObj } from 'dolphindb/browser'
import { delay } from 'xshell/utils.browser'

import {
    Obj,
    type DdbObjRef,
    type Remote,
} from './obj'


const locales = { zh, en, ja, ko }


export class WindowModel extends Model<WindowModel> {
    obj: DdbObj
    objref: DdbObjRef
    
    remote: Remote
}

let model = window.model = new WindowModel()


function DdbObjWindow () {
    const { obj, objref, remote } = model.use(['obj', 'objref', 'remote'])
    
    useEffect(() => {
        (async () => {
            let i = 0
            while (!(window as any).resolve) {
                if (i >= 10)
                    return
                await delay(200)
                i++
            }
            
            ;(window as any).resolve()
        })()
    }, [ ])
    
    useEffect(() => {
        if (!obj && !objref)
            return
        
        const { name, form } = obj || objref
        
        document.title = `${ name || DdbForm[form] } - DolphinDB`
        
        ;(async () => {
            await delay(200)
            const $obj = document.querySelector<HTMLElement>('.root > div')
            const $table = document.querySelector<HTMLTableElement>('table')
            if (!$obj || !$table)
                return
            window.resizeTo(
                Math.min($table.offsetWidth + 40, screen.width - 100),
                Math.min($obj.offsetHeight + 80,  screen.height - 100),
            )
        })()
    }, [obj, objref])
    
    if (!obj && !objref)
        return <div>DolphinDB Window</div>
    
    return <ConfigProvider locale={locales[language]} autoInsertSpaceInButton={false}>{
        <div className='result'>
            <Obj obj={obj} objref={objref} ctx='window' remote={remote} />
        </div>
    }</ConfigProvider>
}

create_root(
    document.querySelector('.root')
).render(<DdbObjWindow/>)


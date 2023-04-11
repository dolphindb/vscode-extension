import 'xshell/scroll-bar.sass'

import './window.sass'


import { default as React, useEffect } from 'react'
import { createRoot as create_root } from 'react-dom/client'

import {
    ConfigProvider,
    
    // @ts-ignore 使用了 antd-with-locales 之后 window.antd 变量中有 locales 属性
    locales
} from 'antd'


import { Model } from 'react-object-model'

import { language } from '../i18n/index.js'
import {
    DdbForm,
    type DDB,
    type DdbObj,
    type InspectOptions,
} from 'dolphindb/browser.js'
import { delay } from 'xshell/utils.browser.js'

import {
    Obj,
    type DdbObjRef,
    type Remote,
} from './obj.js'


const locale_names = {
    zh: 'zh_CN',
    en: 'en_US',
    ja: 'ja_JP',
    ko: 'ko_KR'
} as const


export class WindowModel extends Model<WindowModel> {
    obj?: DdbObj
    objref?: DdbObjRef
    
    remote?: Remote
    
    ddb?: DDB
    
    options?: InspectOptions
}

let model = window.model = new WindowModel()


function DdbObjWindow () {
    const { obj, objref, remote, ddb, options } = model.use(['obj', 'objref', 'remote', 'ddb', 'options'])
    
    useEffect(() => {
        (async () => {
            let i = 0
            while (!(window as any).resolve) {
                if (i >= 10)
                    return
                await delay(200)
                i++
            }
            
            (window as any).resolve()
        })()
    }, [ ])
    
    useEffect(() => {
        if (!obj && !objref)
            return
        
        const { name, form } = obj || objref
        
        document.title = `${ name || DdbForm[form] } - DolphinDB`
        
        ;(async () => {
            await delay(200)
            
            const $table = document.querySelector<HTMLTableElement>('table')
            if (!$table)
                return
            
            window.resizeTo(
                Math.min($table.offsetWidth + 40, screen.width - 100),
                Math.min($table.offsetHeight + 140,  screen.height - 100),
            )
        })()
    }, [obj, objref])
    
    if (!obj && !objref)
        return <div>DolphinDB Window</div>
    
    return <ConfigProvider locale={locales[locale_names[language]]} autoInsertSpaceInButton={false}>{
        <div className='result window'>
            <Obj obj={obj} objref={objref} ctx='window' remote={remote} ddb={ddb} options={options} />
        </div>
    }</ConfigProvider>
}

create_root(
    document.querySelector('.root')
).render(<DdbObjWindow/>)


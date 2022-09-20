import 'antd/dist/antd.css'

import 'xshell/scroll-bar.sass'

import './myfont.sass'

import './window.sass'


import { default as React, useEffect } from 'react'
import { createRoot as create_root } from 'react-dom/client'

import { ConfigProvider } from 'antd'
import zh from 'antd/lib/locale/zh_CN.js'
import en from 'antd/lib/locale/en_US.js'
import ja from 'antd/lib/locale/ja_JP.js'
import ko from 'antd/lib/locale/ko_KR.js'


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


const locales = { zh, en, ja, ko }


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
            
            const $table = document.querySelector<HTMLTableElement>('table')
            if (!$table)
                return
            
            window.resizeTo(
                Math.min($table.offsetWidth + 40, screen.width - 100),
                Math.min($table.offsetHeight + 200,  screen.height - 100),
            )
        })()
    }, [obj, objref])
    
    if (!obj && !objref)
        return <div>DolphinDB Window</div>
    
    return <ConfigProvider
        locale={locales[language] as any}
        autoInsertSpaceInButton={false}
    >{
        <div className='result window'>
            <Obj obj={obj} objref={objref} ctx='window' remote={remote} ddb={ddb} options={options} />
        </div>
    }</ConfigProvider>
}

create_root(
    document.querySelector('.root')
).render(<DdbObjWindow/>)


import './window.sass'
import 'xshell/scroll-bar.sass'
import 'xshell/myfont.sass'

import { default as React, useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { ConfigProvider } from 'antd'
import zh from 'antd/lib/locale/zh_CN'
import en from 'antd/lib/locale/en_US'
import ja from 'antd/lib/locale/ja_JP'
import ko from 'antd/lib/locale/ko_KR'


import { Model } from 'react-object-model'

import { language, t } from '../i18n'
import { type DdbObj } from 'dolphindb/browser'
import { type Remote } from 'xshell/net.browser'
import { delay } from 'xshell/utils.browser'

import {
    Obj,
    type DdbObjRef,
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
            while (!(window as any).resolve)
                await delay(100)
            ;(window as any).resolve()
        })()
    }, [ ])
    
    if (!obj && !objref)
        return <div>DolphinDB Window</div>
    
    return <ConfigProvider locale={locales[language]} autoInsertSpaceInButton={false}>{
        <Obj obj={obj} objref={objref} win remote={remote} />
    }</ConfigProvider>
}

ReactDOM.render(
    <DdbObjWindow/>,
    document.querySelector('.root')
)

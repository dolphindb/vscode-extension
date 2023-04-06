import './obj.sass'

import { default as React, useEffect, useRef, useState } from 'react'

import {
    Pagination,
    Table as AntTable,
    Tooltip,
    Tree,
    Button,
    Switch,
    Select, type SelectProps,
    type TableColumnType,
} from 'antd'

import {
    default as _Icon,
    CaretRightOutlined,
    PauseOutlined,
} from '@ant-design/icons'
const Icon: typeof _Icon.default = _Icon as any

import { Line, Pie, Bar, Column, Scatter, Area, DualAxes, Histogram, Stock } from '@ant-design/plots'

import { genid } from 'xshell/utils.browser.js'


import {
    DDB,
    DdbObj,
    DdbForm,
    DdbType,
    DdbChartType,
    nulls,
    formati,
    format,
    winsize,
    type InspectOptions,
    type DdbValue,
    type DdbVectorValue,
    type DdbMatrixValue,
    type DdbChartValue,
    type DdbDictObj,
    type DdbVectorObj,
    type DdbTableObj,
    type DdbMatrixObj,
    type DdbChartObj,
    type StreamingData,
} from 'dolphindb/browser.js'
import { assert, delay } from 'xshell/utils.browser.js'

import { t } from '../i18n/index.js'

import SvgLink from './link.icon.svg'
import { type WindowModel } from './window.js'


const page_sizes = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 5000, 10000, 100000]

const views = {
    [DdbForm.vector]: Vector,
    [DdbForm.set]: Vector,
    [DdbForm.table]: Table,
    [DdbForm.matrix]: Matrix,
    [DdbForm.chart]: Chart,
    [DdbForm.dict]: Dict,
}

const UpSelect: React.FC<SelectProps> & { Option: typeof Select.Option } = Object.assign(
    props => <Select {...props} size='small' placement='topLeft' listHeight={128} />,
    { Option: Select.Option }
)


export type Context = 'page' | 'webview' | 'window' | 'embed'

export interface Remote {
    /** 调用 remote 中的 func, 只适用于最简单的一元 rpc (请求, 响应) */
    call <TReturn extends any[] = any[]> (func: string, args?: any[]): Promise<TReturn>
}


export function Obj ({
    obj,
    objref,
    ctx = 'webview',
    remote,
    ddb,
    options,
}: {
    obj?: DdbObj
    objref?: DdbObjRef
    ctx?: Context
    remote?: Remote
    ddb?: DDB
    options?: InspectOptions
}) {
    const info = obj || objref
    
    const View = views[info.form] || Default
    
    return <View obj={obj} objref={objref} ctx={ctx} remote={remote} ddb={ddb} options={options} />
}


/** 对应 ddb.ext 中的 DdbVar, 是从 objs(true) 中获取到的变量信息 */
export class DdbObjRef <T extends DdbValue = DdbValue> {
    static size_limit = 10240n
    
    node: string
    
    // --- by objs(true)
    name: string
    
    form: DdbForm
    
    type: DdbType
    
    rows: number
    
    cols: number
    
    bytes: bigint
    
    shared: boolean
    
    extra: string
    
    /** this.bytes <= DdbVar.size_limit */
    obj: DdbObj<T>
    
    
    constructor (data: Partial<DdbObjRef>) {
        Object.assign(this, data)
    }
}


export async function open_obj ({
    obj,
    objref,
    remote,
    ddb,
    options,
}: {
    obj?: DdbObj
    objref?: DdbObjRef
    remote?: Remote
    ddb?: DDB
    options?: InspectOptions
}) {
    let win = window.open('./window.html', new Date().toString(), 'left=100,top=100,width=1000,height=640,popup')
    
    await new Promise<void>(resolve => {
        (win as any).resolve = resolve
    })
    
    ;(win.model as WindowModel).set({
        obj,
        objref,
        remote,
        ddb,
        options,
    })
}


function Default ({ obj, objref, options }: { obj?: DdbObj, objref?: DdbObjRef, options?: InspectOptions }) {
    return <div>{(obj || objref).toString(options)}</div>
}

function Dict ({
    obj,
    objref,
    remote,
    ddb,
    ctx,
    options,
}: {
    obj?: DdbDictObj
    objref?: DdbObjRef<DdbDictObj['value']>
    remote?: Remote
    ddb?: DDB
    ctx?: Context
    options?: InspectOptions
}) {
    const render = useState({ })[1]
    
    const _obj = obj || objref.obj
    
    useEffect(() => {
        (async () => {
            if (_obj)
                return
            
            const { node, name } = objref
            
            console.log(`dict.fetch:`, name)
            
            objref.obj = ddb ?
                await ddb.eval<DdbDictObj>(name)
            :
                DdbObj.parse(... await remote.call<[Uint8Array, boolean]>('eval', [node, name])) as DdbDictObj
            
            render({ })
        })()
    }, [obj, objref])
    
    
    if (!_obj)
        return null
    
    return <div className='dict'>
        <Tree
            treeData={build_tree_data(_obj, { remote, ddb, ctx, options })}
            defaultExpandAll
            focusable={false}
            blockNode
            showLine
            motion={null}
        />
        
        <div className='bottom-bar'>
            <div className='info'>
                <span className='desc'>{_obj.rows} {t('个键')}{ objref ? ` (${Number(objref.bytes).to_fsize_str()}) ` : '' }</span>
                <span className='type'>{t('的词典')}</span>
            </div> 
        </div>
    </div>
}


function build_tree_data (
    obj: DdbDictObj,
    { remote, ctx, ddb, options }: { remote?: Remote, ctx?: Context, ddb?: DDB, options?: InspectOptions }
) {
    const dict_key = obj.value[0]
    const dict_value = obj.value[1]
    
    let tree_data = new Array(dict_key.rows)
    
    for (let i = 0;  i < dict_key.rows;  i++) {
        let node = { }
        let key = formati(dict_key, i, options)
        
        let valueobj = dict_value.value[i]
        
        if (valueobj instanceof DdbObj) 
            if (valueobj.form === DdbForm.dict) 
                node = {
                    title: key + ': ',
                    key: genid(),
                    children: build_tree_data(valueobj, { remote, ctx, ddb })
                }
             else if (valueobj.form === DdbForm.scalar) {
                let value = format(valueobj.type, valueobj.value, valueobj.le, { ...options, quote: true, nullstr: true })
                node = {
                    title: key + ': ' + value,
                    key: genid()
                }
            } else {
                const View = views[valueobj.form] || Default
                
                node = {
                    title: key + ':',
                    key: genid(),
                    children: [
                        {
                            title: <View obj={valueobj} ctx={ctx} ddb={ddb} remote={remote} />,
                            key: genid()
                        }
                    ]
                }
            }
         else
            node = {
                title: key + ': ' + formati(dict_value, i, options),
                key: genid()
            }
        
        tree_data.push(node)
    }
    
    return tree_data
}


function Vector ({
    obj,
    objref,
    ctx,
    remote,
    ddb,
    options,
}: {
    obj?: DdbVectorObj
    objref?: DdbObjRef<DdbVectorValue>
    ctx: Context
    remote?: Remote
    ddb?: DDB
    options?: InspectOptions
}) {
    const info = obj || objref
    
    const ncols = Math.min(
        10,
        info.rows
    )
    
    const [page_size, set_page_size] = useState(
        (ctx === 'page' || ctx === 'window') ? 200 : 100
    )
    
    const nrows = Math.min(
        Math.ceil(info.rows / ncols),
        page_size / ncols
    )
    
    const [page_index, set_page_index] = useState(0)
    
    const render = useState({ })[1]
    
    useEffect(() => {
        set_page_index(0)
    }, [obj, objref])
    
    useEffect(() => {
        (async () => {
            if (
                obj ||
                info.form === DdbForm.set && objref.obj
            )
                return
            
            const { node, name, rows, form } = objref
            
            const offset = page_size * page_index
            
            if (offset >= rows)
                return
            
            const script = form === DdbForm.set ?
                    name
                :
                    `${name}[${offset}:${Math.min(offset + page_size, rows)}]`
            
            console.log(`${DdbForm[form]}.fetch:`, script)
            
            objref.obj = ddb ?
                await ddb.eval(script)
            :
                DdbObj.parse(... await remote.call<[Uint8Array, boolean]>('eval', [node, script])) as DdbObj<DdbObj[]>
            
            render({ })
        })()
    }, [obj, objref, page_index, page_size])
    
    
    if (!info.rows)
        return <>{ (obj || objref.obj).toString(options) }</>
    
    let rows = new Array<number>(nrows)
    for (let i = 0;  i < nrows;  i++)
        rows[i] = i
    
    let cols = new Array<VectorColumn>(ncols)
    for (let i = 0;  i < ncols;  i++)
        cols[i] = new VectorColumn({
            obj,
            objref,
            index: i,
            form: info.form as (DdbForm.set | DdbForm.vector),
            ncols,
            page_index,
            page_size,
            options,
        })
    
    return <div className='vector'>
        <AntTable
            dataSource={rows as any[]}
            rowKey={x => x}
            bordered
            pagination={false}
            columns={[
                {
                    title: '',
                    key: 'index',
                    className: 'row-head',
                    fixed: 'left',
                    render (value, row, index) {
                        return page_size * page_index + index * ncols
                    }
                },
                ... cols
            ]}
        />
        
        <div className='bottom-bar'>
            <div className='info'>
                <span className='desc'>{info.rows} {t('个元素')}{ objref ? ` (${Number(objref.bytes).to_fsize_str()}) ` : '' }</span>
                <span className='type'>{ info.form === DdbForm.set ? t('的集合') : t('的向量') }</span>
                { info.name && <span className='name'>{info.name}</span> }
            </div>
            
            <Pagination
                className='pagination'
                total={info.rows}
                current={page_index + 1}
                pageSize={page_size}
                pageSizeOptions={page_sizes}
                size='small'
                showSizeChanger
                showQuickJumper
                hideOnSinglePage={page_size <= 200}
                selectComponentClass={UpSelect}
                
                onChange={(page_index, page_size) => {
                    set_page_size(page_size)
                    set_page_index(page_index - 1)
                }}
            />
            
            <div className='actions'>
                {(ctx === 'page' || ctx === 'embed') && <Icon
                    className='icon-link'
                    title={t('在新窗口中打开')}
                    component={SvgLink}
                    onClick={async () => {
                        await open_obj({ obj, objref, remote, ddb, options })
                    }}
                />}
            </div>
        </div>
    </div>
}

class VectorColumn implements TableColumnType <number> {
    index: number
    
    form: DdbForm.vector | DdbForm.set
    
    obj?: DdbVectorObj
    objref?: DdbObjRef<DdbVectorValue>
    
    ncols: number
    
    page_index: number
    page_size: number
    
    title: string
    key: number
    
    options?: InspectOptions
    
    constructor (data: Partial<VectorColumn>) {
        Object.assign(this, data)
        this.title = String(this.index)
        this.key = this.index
    }
    
    render = (value: any, row: number, index: number) => {
        const obj = this.obj || this.objref.obj
        
        if (!obj)
            return null
        
        // 在 obj 中的 index
        const index_ = 
            (this.obj || this.form === DdbForm.set ? this.page_size * this.page_index : 0) + // 之前页的 items 数量
            this.ncols * index + // 之前行的 items 数量
            this.index
        
        return index_ < obj.rows ?
            formati(obj, index_, this.options)
        :
            null
    }
}


function StreamingCell ({
    window: {
        segments,
        rows,
        offset,
    },
    
    icol,
    irow,
    options
}: {
    window: StreamingData['window']
    
    /** 在表格实际数据中位于第几列 */
    icol: number
    
    /** antd table 从上往下第几行 */
    irow: number
    
    options?: InspectOptions
}) {
    // 在 segments 中从后往前查找 index 所属的 segment, 这样能更快找到（最新的记录都在最后面）
    // 最坏复杂度 O(page.size)，整个表格的渲染复杂度 page.size^2 * ncols
    
    let _rows = 0
    for (let i = segments.length - 1;  i >= 0;  i--) {
        const segment = segments[i]
        
        const { rows } = segment.value[0]  // 当前 segment 所包含的 rows
        
        if (irow < _rows + rows) {  // irow 位于这个 segment 中
            const col = segment.value[icol]
            
            return <>{formati(col, col.rows - 1 - (irow - _rows), options)}</>
        }
        
        _rows += rows
    }
    
    return null
}


function Table ({
    obj,
    objref,
    ctx,
    remote,
    ddb,
    options,
}: {
    obj?: DdbTableObj
    objref?: DdbObjRef<DdbObj<DdbVectorValue>[]>
    ctx: Context
    remote?: Remote
    ddb?: DDB
    options?: InspectOptions
}) {
    const info = obj || objref
    
    const ncols = info.cols
    
    const [page_size, set_page_size] = useState(
        (ctx === 'page' || ctx === 'window') ? 20 : 10
    )
    
    const nrows = Math.min(page_size, info.rows)
    
    const [page_index, set_page_index] = useState(0)
    
    const render = useState({ })[1]
    
    useEffect(() => {
        set_page_index(0)
    }, [obj, objref])
    
    useEffect(() => {
        (async () => {
            if (obj)
                return
            
            const { node, name, rows } = objref
            
            const offset = page_size * page_index
            
            if (offset >= rows)
                return
            
            const script = `${name}[${offset}:${Math.min(offset + page_size, rows)}]`
            
            console.log('table.fetch:', script)
            
            if (ddb)
                objref.obj = await ddb.eval(script)
            else
                objref.obj = DdbObj.parse(... await remote.call<[Uint8Array, boolean]>('eval', [node, script])) as DdbTableObj
            
            render({ })
        })()
    }, [obj, objref, page_index, page_size])
    
    
    let rows = new Array<number>(nrows)
    for (let i = 0;  i < nrows;  i++)
        rows[i] = i
    
    let cols = new Array<TableColumn>(ncols)
    for (let i = 0;  i < ncols;  i++)
        cols[i] = new TableColumn({
            obj,
            objref,
            index: i,
            page_index,
            page_size,
            options,
        })
        
    
    return <div className='table'>
        <AntTable
            dataSource={rows as any[]}
            rowKey={x => x}
            bordered
            pagination={false}
            columns={[
                {
                    title: '',
                    key: 'index',
                    className: 'row-head',
                    fixed: 'left',
                    render: irow =>
                        page_size * page_index + irow
                },
                ... cols
            ]}
        />
        
        <div className='bottom-bar'>
            <div className='info'>
                <span className='desc'>{ info.rows ? `${info.rows} ${t('行')} ` : ' ' }{info.cols} {t('列')}{ objref ? ` (${Number(objref.bytes).to_fsize_str()}) ` : '' }</span>
                <span className='type'>{t('的表格')}</span>
                { info.name && <span className='name'>{info.name}</span> }
            </div>
            
            <Pagination
                className='pagination'
                total={info.rows}
                current={page_index + 1}
                pageSize={page_size}
                pageSizeOptions={page_sizes}
                size='small'
                showSizeChanger
                showQuickJumper
                hideOnSinglePage={page_size <= 50}
                selectComponentClass={UpSelect}
                
                onChange={(page_index, page_size) => {
                    set_page_size(page_size)
                    set_page_index(page_index - 1)
                }}
            />
            
            <div className='actions'>
                {(ctx === 'page' || ctx === 'embed') && <Icon
                    className='icon-link'
                    title={t('在新窗口中打开')}
                    component={SvgLink}
                    onClick={async () => {
                        await open_obj({ obj, objref, remote, ddb, options })
                    }}
                />}
            </div>
        </div>
    </div>
}


export function StreamingTable ({
    table,
    username,
    password,
    ctx,
    options,
}: {
    table: string
    username?: string
    password?: string
    ctx: Context
    options?: InspectOptions
}) {
    let rddb = useRef<DDB>()
    
    let rddbapi = useRef<DDB>()
    
    let rauto_append = useRef<boolean>(false)
    
    let rappended = useRef<number>(0)
    
    let rreceived = useRef<number>(0)
    
    const default_rate = 0 as const
    
    /** 刷新率 (ms): 0 实时更新, -1 暂停, > 0 刷新间隔 */
    let rrate = useRef<number>(default_rate)
    
    function set_rate (rate: number = default_rate) {
        rrate.current = rate
        rerender({ })
    }
    
    let rlast = useRef<number>(0)
    
    let [, rerender] = useState({ })
    
    const [page_size, set_page_size] = useState(
        (ctx === 'page' || ctx === 'window') ? 20 : 10
    )
    
    const [page_index, set_page_index] = useState(0)
    
    
    useEffect(() => {
        let ddb = rddb.current = new DDB(undefined, {
            autologin: Boolean(username),
            username,
            password,
            streaming: {
                table,
                handler (message) {
                    console.log(message)
                    
                    if (message.error) {
                        console.error(message.error)
                        return
                    }
                    
                    const time = new Date().getTime()
                    
                    rreceived.current += message.rows
                    
                    // 冻结或者未到更新时间
                    if (rrate.current === -1 || time - rlast.current < rrate.current)
                        return
                    
                    rlast.current = time
                    rerender({ })
                }
            }
        })
        
        let ddbapi = rddbapi.current = new DDB('')
        
        
        ;(async () => {
            // LOCAL: 创建流表
            await ddbapi.eval(
                'try {\n' +
                "    if (!defined('prices', SHARED)) {\n" +
                '        share(\n' +
                '            streamTable(\n' +
                '                10000:0,\n' +
                "                ['time', 'stock', 'price'],\n" +
                '                [TIMESTAMP, SYMBOL, DOUBLE]\n' +
                '            ),\n' +
                "            'prices'\n" +
                '        )\n' +
                "        print('prices 流表创建成功')\n" +
                '    } else\n' +
                "        print('prices 流表已存在')\n" +
                '} catch (error) {\n' +
                "    print('prices 流表创建失败')\n" +
                '    print(error)\n' +
                '}\n'
            )
            
            // 开始订阅
            await ddb.connect()
            
            rerender({ })
        })()
        
        return () => { ddb?.disconnect() }
    }, [ ])
    
    
    useEffect(() => {
        rerender({ })
    }, [page_size, page_index])
    
    useEffect(() => {
        if (!rauto_append.current)
            return
        
        ;(async () => {
            for (;  rauto_append.current;) {
                await append_data()
                await delay(1000)
            }
            
            console.log('自动更新已停止')
        })()
    }, [rauto_append.current])
    
    
    if (!rddb.current?.streaming.data || !rddbapi.current)
        return null
    
    const {
        current: {
            streaming: {
                data,
                window: {
                    rows: winrows,
                    offset,
                    segments
                }
            },
            streaming,
        }
    } = rddb
    
    
    let rows = new Array<number>(page_size)
    for (let i = 0;  i < page_size;  i++)
        rows[i] = i;
    
    let cols = new Array<StreamingTableColumn>(data.rows)
    for (let i = 0;  i < data.rows;  i++)
        cols[i] = new StreamingTableColumn({
            streaming,
            index: i,
            page_size,
            page_index,
            options,
        })
    
    
    async function append_data (n = 3) {
        rappended.current += n
        
        await rddbapi.current.eval(
            n === 3 ?
                'append!(\n' +
                '    prices,\n' +
                '    table([\n' +
                '        [now(), timestamp(now() + 10), timestamp(now() + 20)] as time,\n' +
                "        ['MSFT', 'FUTU', 'MSFT'] as stock,\n" +
                '        [1.0, 2.0, 3.0] as price\n' +
                '    ])\n' +
                ')\n'
            :
                'append!(\n' +
                '    prices,\n' +
                '    table([\n' +
                '        [now()] as time,\n' +
                "        ['MSFT'] as stock,\n" +
                '        [1.0] as price\n' +
                '    ])\n' +
                ')\n'
        )
    }
    
    
    return <div>
        <div><Button onClick={async () => {
            rlast.current = 0
            await append_data()
        }}>向流表中添加三条数据</Button></div>
        
        <div><Button onClick={async () => {
            rlast.current = 0
            await append_data(1)
        }}>向流表中添加一条数据</Button></div>
        
        <div><Button onClick={async () => {
            rlast.current = 0
            rappended.current += 2000 * 5
            
            await rddbapi.current.eval(
                'n = 2000\n' +
                '\n' +
                'for (i in 0..4)\n' +
                '    append!(\n' +
                '        prices,\n' +
                '        table([\n' +
                '            (now() + 0..(n-1)) as time,\n' +
                "            take(['MSFT', 'FUTU'], n) as stock,\n" +
                '            (0..(n-1) \\ 10) as price\n' +
                '        ])\n' +
                '    )\n'
            )
        }}>测试插入 2000 条数据 5 次</Button></div>
        
        <div><Button onClick={async () => {
            rlast.current = 0
            rappended.current += 1_0000 * 10
            
            await rddbapi.current.eval(
                'n = 10000\n' +
                '\n' +
                'for (i in 0..9)\n' +
                '    append!(\n' +
                '        prices,\n' +
                '        table([\n' +
                '            (now() + 0..(n-1)) as time,\n' +
                "            take(['MSFT', 'FUTU'], n) as stock,\n" +
                '            (0..(n-1) \\ 10) as price\n' +
                '        ])\n' +
                '    )\n'
            )
        }}>测试插入 1_0000 条数据 10 次</Button></div>
        
        <div><Button onClick={async () => {
            rlast.current = 0
            rappended.current += 10_0000 * 10
            
            await rddbapi.current.eval(
                'n = 100000\n' +
                '\n' +
                'for (i in 0..9)\n' +
                '    append!(\n' +
                '        prices,\n' +
                '        table([\n' +
                '            (now() + 0..(n-1)) as time,\n' +
                "            take(['MSFT', 'FUTU'], n) as stock,\n" +
                '            (0..(n-1) \\ 10) as price\n' +
                '        ])\n' +
                '    )\n'
            )
        }}>测试插入 10_0000 条数据 10 次</Button></div>
        
        <div><Button onClick={async () => {
            rlast.current = 0
            rappended.current += 2000
            await rddbapi.current.eval(
                'n = 2000\n' +
                'for (i in 0..(n-1))\n' +
                "    insert into prices values (now(), 'MSFT', rand(100, 1)[0])\n"
            )
        }}>测试添加一条数据 2000 次</Button></div>
        
        <div>应添加行数: {rappended.current}</div>
        <div>实际的行数: {rreceived.current}</div>
        <div>上面两个应该相等</div>
        
        <div style={{ margin: '10px 0px' }}>
            自动添加数据: <Switch onChange={(checked) => {
                rauto_append.current = checked
                rerender({ })
            }}/>
        </div>
        
        
        <div className='table'>
            <AntTable
                dataSource={rows as any[]}
                rowKey={x => x}
                bordered
                pagination={false}
                columns={[
                    {
                        title: '',
                        key: 'index',
                        className: 'row-head',
                        fixed: 'left',
                        render: irow =>
                            page_size * page_index + irow
                    },
                    
                    ... cols
                ]}
            />
        </div>
        
        <div className='bottom-bar'>
            <div className='info'>
                <span className='desc'>{t('窗口')}: {winsize} {t('行')} {data.rows} {t('列')}, {t('偏移量')}: {offset}</span> 
                <span className='type'>{t('的流表')}</span>
                <span className='name'>{table}</span>
            </div>
            
            <Pagination
                className='pagination'
                total={winsize}
                current={page_index + 1}
                pageSize={page_size}
                pageSizeOptions={page_sizes}
                size='small'
                showSizeChanger
                showQuickJumper
                hideOnSinglePage={page_size <= 50}
                selectComponentClass={UpSelect}
                
                onChange={(page_index, page_size) => {
                    set_page_size(page_size)
                    set_page_index(page_index - 1)
                }}
            />
            
            <div className='actions'>
                {(ctx === 'page' || ctx === 'embed') && <Icon
                    className='icon-link'
                    title={t('在新窗口中打开')}
                    component={SvgLink}
                    onClick={async () => {
                        throw new Error('未实现')
                        
                        // await open_obj({ obj, objref, remote, ddb })
                    }}
                />}
                
                <div className='pause-play'>
                    { rrate.current === -1 ? 
                        <CaretRightOutlined
                            title={t('继续显示流表更新')}
                            onClick={() => { set_rate() }} />
                    :
                        <PauseOutlined
                            title={t('暂停显示流表更新')}
                            onClick={() => { set_rate(-1) }} /> }
                </div>
                
                <Select
                    defaultValue={default_rate}
                    onSelect={(value: number) => {
                        set_rate(value)
                    }}
                >
                    <Select.Option value={0}>{t('实时')}</Select.Option>
                    <Select.Option value={1000}>1 s</Select.Option>
                    <Select.Option value={2000}>2 s</Select.Option>
                    <Select.Option value={3000}>3 s</Select.Option>
                    <Select.Option value={5000}>5 s</Select.Option>
                    <Select.Option value={10 * 1000}>10 s</Select.Option>
                    <Select.Option value={30 * 1000}>30 s</Select.Option>
                    <Select.Option value={60 * 1000}>60 s</Select.Option>
                </Select>
            </div>
        </div>
    </div>
}


class StreamingTableColumn implements TableColumnType <number> {
    /** 表格数据的第 index 列 */
    index: number
    
    key: number
    
    streaming: StreamingData
    
    col: DdbVectorObj
    
    page_index: number
    page_size: number
    
    title: React.ReactNode
    
    align: 'left' | 'center' | 'right'
    
    options?: InspectOptions
    
    constructor (data: Partial<StreamingTableColumn>) {
        Object.assign(this, data)
        
        this.key = this.index
        
        this.col = this.streaming.data.value[this.index]
        assert(this.col.form === DdbForm.vector, t('this.streaming.data 中的元素应该是 vector'))
        
        this.title = <Tooltip
                title={DdbType[this.col.type === DdbType.symbol_extended ? DdbType.symbol : this.col.type]}
            >{this.streaming.colnames[this.index]}</Tooltip>
        
        this.align = TableColumn.left_align_types.has(this.col.type) ? 'left' : 'right'
    }
    
    
    render = (irow: number) => 
        <StreamingCell
            window={this.streaming.window}
            irow={this.page_size * this.page_index + irow}
            icol={this.index}
            options={this.options}
        />
}


class TableColumn implements TableColumnType <number> {
    static left_align_types = new Set([
        DdbType.symbol,
        DdbType.symbol_extended,
        DdbType.string,
        DdbType.functiondef,
        DdbType.handle,
        DdbType.code,
        DdbType.datasource,
        DdbType.resource,
    ])
    
    /** 表格数据的第 index 列 */
    index: number
    
    obj?: DdbObj<DdbObj<DdbVectorValue>[]>
    objref?: DdbObjRef<DdbObj<DdbVectorValue>[]>
    
    col?: DdbObj<DdbVectorValue>
    
    page_index: number
    page_size: number
    
    title: React.ReactNode
    key: number
    
    align: 'left' | 'center' | 'right'
    
    options?: InspectOptions
    
    constructor (data: Partial<TableColumn>) {
        Object.assign(this, data)
        this.key = this.index
        let obj = this.obj || this.objref.obj
        if (!obj)
            return
        
        this.col = obj.value[this.index]
        
        this.title = <Tooltip
            title={
                DdbType[
                    this.col.type === DdbType.symbol_extended ? DdbType.symbol : this.col.type
                ]}
        >{
            this.col.name
        }</Tooltip>
        
        this.align = TableColumn.left_align_types.has(this.col.type) ? 'left' : 'right'
    }
    
    render = (irow: number) => {
        const obj = this.col
        
        if (!obj)
            return null
        
        const index = 
            (this.obj ? this.page_size * this.page_index : 0) + // 之前页的 items 数量
            irow
        
        return index < obj.rows ?
            formati(obj, index, this.options)
        :
            null
    }
}


function Matrix ({
    obj,
    objref,
    ctx,
    remote,
    ddb,
    options,
}: {
    obj?: DdbMatrixObj
    objref?: DdbObjRef<DdbMatrixValue>
    ctx?: Context
    remote?: Remote
    ddb?: DDB
    options?: InspectOptions
}) {
    const info = obj || objref
    
    const ncols = info.cols
    
    const [page_size, set_page_size] = useState(
        (ctx === 'page' || ctx === 'window') ? 20 : 10
    )
    
    const nrows = Math.min(page_size, info.rows)
    
    const [page_index, set_page_index] = useState(0)
    
    const render = useState({ })[1]
    
    useEffect(() => {
        set_page_index(0)
    }, [obj, objref])
    
    useEffect(() => {
        (async () => {
            if (obj)
                return
            
            const { node, name, rows } = objref
            
            const offset = page_size * page_index
            
            if (offset >= rows)
                return
            
            const script = `${name}[${offset}:${Math.min(offset + page_size, rows)},]`
            
            console.log('matrix.fetch:', script)
            
            if (ddb)
                objref.obj = await ddb.eval(script)
            else
                objref.obj = DdbObj.parse(... await remote.call<[Uint8Array, boolean]>('eval', [node, script])) as DdbMatrixObj
            
            render({ })
        })()
    }, [obj, objref, page_index, page_size])
    
    
    let rows = new Array<number>(nrows)
    for (let i = 0;  i < nrows;  i++)
        rows[i] = i
    
    let cols = new Array<MatrixColumn>(ncols)
    for (let i = 0;  i < ncols;  i++)
        cols[i] = new MatrixColumn({
            obj,
            objref,
            index: i,
            page_index,
            page_size,
            options,
        })
    
    return <div className='matrix'>
        <AntTable
            dataSource={rows as any[]}
            rowKey={x => x}
            bordered
            pagination={false}
            columns={[
                {
                    title: '',
                    key: 'index',
                    className: 'row-head',
                    fixed: 'left',
                    render (irow: number) {
                        const i = obj ? 
                                page_size * page_index + irow
                            :
                                irow
                        
                        const rows = (obj || objref.obj)?.value.rows
                        
                        return rows ?
                                i < rows.rows ?
                                    formati(rows, i, options)
                                :
                                    ''
                            :
                                i
                    }
                },
                ... cols
            ]}
        />
        
        <div className='bottom-bar'>
            <div className='info'>
                <span className='desc'>{info.rows} {t('行')} {info.cols} {t('列')}{ objref ? ` (${Number(objref.bytes).to_fsize_str()}) ` : '' }</span>
                <span className='type'>{t('的矩阵')}</span>
                { info.name && <span className='name'>{info.name}</span> }
            </div>
            
            <Pagination
                className='pagination'
                total={info.rows}
                current={page_index + 1}
                pageSize={page_size}
                pageSizeOptions={page_sizes}
                size='small'
                showSizeChanger
                showQuickJumper
                hideOnSinglePage={page_size <= 50}
                selectComponentClass={UpSelect}
                
                onChange={(page_index, page_size) => {
                    set_page_size(page_size)
                    set_page_index(page_index - 1)
                }}
            />
            
            <div className='actions'>
                {(ctx === 'page' || ctx === 'embed') && <Icon
                    className='icon-link'
                    title={t('在新窗口中打开')}
                    component={SvgLink}
                    onClick={async () => {
                        await open_obj({ obj, objref, remote, ddb, options })
                    }}
                />}
            </div>
            
        </div>
    </div>
}

class MatrixColumn implements TableColumnType <number> {
    index: number
    
    obj?: DdbMatrixObj
    objref?: DdbObjRef<DdbMatrixValue>
    
    page_index: number
    page_size: number
    
    title: string
    key: number
    
    options?: InspectOptions
    
    constructor (data: Partial<MatrixColumn>) {
        Object.assign(this, data)
        
        this.title = String(this.index)
        this.key = this.index
        
        let obj = this.obj || this.objref.obj
        if (!obj)
            return
        
        const cols = obj?.value.cols
        if (cols)
            this.title = formati(cols, this.index, this.options)
    }
    
    render = (irow: number) => {
        const obj = this.obj || this.objref.obj
        
        if (!obj)
            return null
        
        const irow_ = this.obj ? 
                this.page_size * this.page_index + irow
            :
                irow
        
        if (irow_ >= obj.rows)
            return null
        
        const nitems = obj.cols * obj.rows
        
        // this.index 列之前所有列的元素 + this.index 列之前分页中的列内的元素 + 当前元素下标
        const index = this.obj ?
            obj.rows * this.index + this.page_size * this.page_index + irow
        :
            obj.rows * this.index + irow
        
        assert(index < nitems, 'index < obj.cols * obj.rows')
        
        return formati(
            new DdbObj({
                form: DdbForm.vector,
                type: obj.type,
                rows: nitems,
                value: obj.value.data
            }),
            index,
            this.options
        )
    }
}

function to_chart_data (data: DdbValue, datatype: DdbType) {
    switch (datatype) {
        case DdbType.int:
            return data === nulls.int32 ? null : Number(data)
            
        case DdbType.short:
            return data === nulls.int16 ? null : Number(data)
            
        case DdbType.float:
            return data === nulls.float32 ? null : Number(data)
            
        case DdbType.double:
            return data === nulls.double ? null : Number(data)
            
        case DdbType.long:
            return data === nulls.int64 ? null : Number(data)
            
        default:
            return Number(data)
    }
}

function Chart ({
    obj,
    objref,
    ctx,
    remote,
    ddb,
    options,
}: {
    obj?: DdbChartObj
    objref?: DdbObjRef<DdbChartValue>
    ctx?: Context
    remote?: Remote
    ddb?: DDB
    options?: InspectOptions
}) {
    const [
        {
            inited,
            charttype,
            data,
            titles,
            stacking,
            multi_y_axes,
            col_labels,
            bin_count,
        },
        set_config
    ] = useState({
        inited: false,
        charttype: DdbChartType.line,
        data: [ ],
        titles: { } as DdbChartValue['titles'],
        stacking: false,
        multi_y_axes: false,
        col_labels: [ ],
        bin_count: null as DdbChartValue['bin_count'],
        bin_start: null as DdbChartValue['bin_start'],
        bin_end: null as DdbChartValue['bin_end'],
    })
    
    useEffect(() => {
        (async () => {
            const {
                value: {
                    bin_count,
                    bin_start,
                    bin_end,
                    titles,
                    type: charttype,
                    stacking,
                    extras,
                    data: {
                        rows,
                        cols,
                        type: datatype,
                        value: {
                            rows: rows_,
                            cols: cols_,
                            data
                        }
                    }
                }
            } = obj ||
                (ddb ? 
                    await ddb.eval(objref.name)
                :
                    DdbObj.parse(... await remote.call<[Uint8Array, boolean]>('eval', [objref.node, objref.name])) as DdbChartObj
                )
            
            const { multi_y_axes = false } = extras || { }
            
            let col_labels = (cols_?.value || [ ]) as any[]
            let col_lables_ = new Array(col_labels.length)
            
            const row_labels = (() => {
                // 没有设置 label 的话直接以序号赋值并返回
                if (!rows_) {
                    let arr = new Array(rows)
                    for (let i = 0;  i < rows;  i++)
                        arr[i] = i
                    return arr
                } else if (charttype === DdbChartType.kline || charttype === DdbChartType.scatter)
                    return rows_.value
                else {
                    // format 为 string
                    const arr = new Array(rows)
                    for (let i = 0; i < rows; i++)
                        arr[i] = formati(rows_, i, options)
                    return arr
                }
            })()
            
            const n = charttype === DdbChartType.line && multi_y_axes || charttype === DdbChartType.kline ? rows : rows * cols
            let data_ = new Array(n)
            
            switch (charttype) {
                case DdbChartType.line:
                    if (multi_y_axes)
                        for (let j = 0; j < rows; j++) {
                            let dataobj: any = { }
                            dataobj.row = row_labels[j]
                            for (let i = 0; i < cols; i++) {
                                const col = col_labels[i]?.value?.name || col_labels[i]
                                col_lables_[i] = col
                                
                                let idata = i * rows + j
                                dataobj[col] = to_chart_data(data[idata], datatype)
                            }
                            data_[j] = dataobj
                        }
                     else
                        for (let i = 0; i < cols; i++) {
                            const col = col_labels[i]?.value?.name || col_labels[i]
                            col_lables_[i] = col
                            
                            for (let j = 0; j < rows; j++) {
                                const idata = i * rows + j
                                data_[idata] = {
                                    row: row_labels[j],
                                    col,
                                    value: to_chart_data(data[idata], datatype)
                                }
                            }
                        }
                    break
                    
                case DdbChartType.kline:
                    for (let j = 0; j < rows; j++) {
                        let dataobj: any = { }
                        
                        dataobj.row = row_labels[j]
                        dataobj.row_ = formati(rows_, j, options)

                        dataobj.open = to_chart_data(data[j], datatype)
                        dataobj.high = to_chart_data(data[rows + j], datatype)
                        dataobj.low = to_chart_data(data[rows * 2 + j], datatype)
                        dataobj.close = to_chart_data(data[rows * 3 + j], datatype)
                        
                        if (cols === 5)
                            dataobj.vol = to_chart_data(data[rows * 4 + j], datatype)
                            
                        data_[j] = dataobj
                        
                    }
                    break
                    
                default:
                    for (let i = 0; i < cols; i++) {
                        const col = col_labels[i]?.value?.name || col_labels[i]
                        col_lables_[i] = col
                        
                        for (let j = 0; j < rows; j++) {
                            const idata = i * rows + j
                            data_[idata] = {
                                row: row_labels[j],
                                col,
                                value: to_chart_data(data[idata], datatype)
                            }
                        }
                    }
                    
                    if (charttype === DdbChartType.histogram && bin_start && bin_end)
                        data_ = data_.filter(data => 
                            data.value >= Number(bin_start.value) && data.value <= Number(bin_end.value))
                    
                    break
            }
            
            console.log('data:', data_)
            
            set_config({
                inited: true,
                charttype,
                data: data_,
                titles,
                stacking,
                multi_y_axes,
                col_labels: col_lables_,
                bin_count,
                bin_start,
                bin_end,
            })
        })()
    }, [obj, objref])
    
    if (!inited)
        return null
    
    return <div className='chart'>
        <div className='chart-title'>{titles.chart}</div>
        
        {(() => {
            switch (charttype) {
                case DdbChartType.line:
                    if (!multi_y_axes)
                        return <Line
                            className='chart-body'
                            data={data}
                            xField='row'
                            yField='value'
                            seriesField='col'
                            xAxis={{
                                title: {
                                    text: titles.x_axis
                                }
                            }}
                            yAxis={{
                                title: {
                                    text: titles.y_axis
                                }
                            }}
                            isStack={stacking}
                            padding='auto'
                        />
                    else
                        return <DualAxes
                            className='chart-body'
                            data={[data, data]}
                            xField='row'
                            yField={col_labels}
                            xAxis={{
                                title: {
                                    text: titles.x_axis
                                }
                            }}
                            yAxis={{
                                [col_labels[0]]: {
                                    title: {
                                        text: titles.y_axis
                                    }
                                }
                            }}
                            padding='auto'
                        />

                case DdbChartType.column:
                    return <Column
                        className='chart-body'
                        data={data}
                        xField='row'
                        yField='value'
                        seriesField='col'
                        xAxis={{
                            title: {
                                text: titles.x_axis
                            }
                        }}
                        yAxis={{
                            title: {
                                text: titles.y_axis
                            }
                        }}
                        isGroup={true}
                        label={{
                            position: 'middle',
                            layout: [
                                {
                                    type: 'interval-adjust-position',
                                },
                                {
                                    type: 'interval-hide-overlap',
                                },
                                {
                                    type: 'adjust-color',
                                },
                            ],
                        }}
                        padding='auto'
                    />
                
                case DdbChartType.bar:
                    return <Bar
                        className='chart-body'
                        data={data}
                        xField='value'
                        yField='row'
                        seriesField='col'
                        xAxis={{
                            title: {
                                text: titles.y_axis
                            }
                        }}
                        yAxis={{
                            title: {
                                text: titles.x_axis
                            }
                        }}
                        isStack={stacking}
                        isGroup={!stacking}
                        label={{
                            position: 'middle',
                            layout: [
                                {
                                    type: 'interval-adjust-position',
                                },
                                {
                                    type: 'interval-hide-overlap',
                                },
                                {
                                    type: 'adjust-color',
                                },
                            ],
                        }}
                        padding='auto'
                    />
                
                case DdbChartType.pie:
                    return <Pie
                        className='chart-body'
                        data={data}
                        angleField='value'
                        colorField='row'
                        radius={0.9}
                        label={{
                            type: 'spider',
                            content: `{name}: {percentage}`,
                        }}
                        padding='auto'
                    />
                
                case DdbChartType.area:
                    return <Area
                        className='chart-body'
                        data={data}
                        xField='row'
                        yField='value'
                        seriesField='col'
                        xAxis={{
                            title: {
                                text: titles.x_axis
                            }
                        }}
                        yAxis={{
                            title: {
                                text: titles.y_axis
                            }
                        }}
                        isStack={stacking}
                        padding='auto'
                    />
                
                case DdbChartType.scatter:
                    return <Scatter
                        className='chart-body'
                        data={data}
                        xField='row'
                        yField='value'
                        colorField='col'
                        xAxis={{
                            title: {
                                text: titles.x_axis
                            }
                        }}
                        yAxis={{
                            title: {
                                text: titles.y_axis
                            }
                        }}
                        shape='circle'
                        padding='auto'
                    />
                
                case DdbChartType.histogram:
                    return <Histogram 
                        className='chart-body'
                        data={data}
                        binField='value'
                        stackField= 'col'
                        { ... bin_count ? { binNumber: Number(bin_count.value) } : { } }
                        xAxis={{
                            title: {
                                text: titles.x_axis
                            }
                        }}
                        yAxis={{
                            title: {
                                text: titles.y_axis
                            }
                        }}
                        padding='auto'
                    />
                
                case DdbChartType.kline:
                    return <Stock
                        data={data}
                        xField='row'
                        yField={['open', 'close', 'high', 'low']}
                        xAxis={{
                            title: {
                                text: titles.x_axis
                            }
                        }}
                        yAxis={{
                            title: {
                                text: titles.y_axis
                            }
                        }}
                        meta={{
                            row: {
                                formatter: (value, index) => format(obj.value.data.value.rows.type, value, obj.le)
                            },
                            vol: {
                                alias: t('成交量'),
                            },
                            open: {
                                alias: t('开盘价'),
                            },
                            close: {
                                alias: t('收盘价'),
                            },
                            high: {
                                alias: t('最高价'),
                            },
                            low: {
                                alias: t('最低价'),
                            },
                        }}
                        padding='auto'
                        tooltip={{
                            // @ts-ignore
                            crosshairs: {
                                // 自定义 crosshairs line 样式
                                line: {
                                    style: {
                                        lineWidth: 0.5,
                                        stroke: 'rgba(0,0,0,0.25)'
                                    }
                                },
                                text: (type, defaultContent, items) => {
                                    let textContent
                                    
                                    if (type === 'x') {
                                        const item = items[0]
                                        textContent = item ? item.data.row_ : defaultContent
                                    } else
                                        textContent = defaultContent.toFixed(2)
                                    
                                    return {
                                        position: type === 'y' ? 'start' : 'end',
                                        content: textContent,
                                        // 自定义 crosshairs text 样式
                                        style: {
                                            fill: '#dfdfdf'
                                        }
                                    }
                                },
                            },
                            
                            fields: ['open', 'close', 'high', 'low', 'vol'],
                            
                            title: 'row_',
                        }}
                    />
                
                default:
                    return <Line
                        className='chart-body'
                        data={data}
                        xField='row'
                        yField='value'
                        seriesField='col'
                        xAxis={{
                            title: {
                                text: titles.x_axis
                            }
                        }}
                        yAxis={{
                            title: {
                                text: titles.y_axis
                            }
                        }}
                        isStack={stacking}
                        padding='auto'
                    />
            }
        })()}
        
        <div className='bottom-bar'>
            <div className='actions'>
                {(ctx === 'page' || ctx === 'embed') && <Icon
                    className='icon-link'
                    title={t('在新窗口中打开')}
                    component={SvgLink}
                    onClick={async () => {
                        await open_obj({ obj, objref, remote, ddb })
                    }}
                />}
            </div>
        </div>
    </div>
}

import './obj.sass'

import { default as React, useEffect, useState } from 'react'
import {
    Pagination,
    Table as AntTable,
    Tooltip,
    type TableColumnType,
} from 'antd'
import {
    default as Icon,
} from '@ant-design/icons'
import { Line, Pie, Bar, Column, Scatter, Area, DualAxes, Histogram, Stock } from '@ant-design/plots'


import {
    DdbObj,
    DdbForm,
    DdbType,
    DdbChartType,
    nulls,
    format,
    datetime2ms,
    month2ms,
    minute2ms,
    date2ms,
    datehour2ms,
    second2ms,
    time2ms,
    timestamp2ms,
    nanotime2ns,
    nanotimestamp2ns,
    type DdbValue,
    type DdbVectorValue,
    type DdbMatrixValue,
    type DdbSymbolExtendedValue,
    type DdbArrayVectorBlock,
    type DdbChartValue,
} from 'dolphindb/browser'
import type { Message } from 'xshell/net.browser'

import SvgLink from './link.icon.svg'
import { type WindowModel } from './window.js'


const views = {
    [DdbForm.vector]: Vector,
    [DdbForm.set]: Vector,
    [DdbForm.table]: Table,
    [DdbForm.matrix]: Matrix,
    [DdbForm.chart]: Chart,
}

export type Context = 'page' | 'webview' | 'window' | 'embed'

export interface Remote {
    call <T extends any[] = any[]> (
        message: Message,
        handler?: (message: Message<T>) => any
    ): Promise<T>
}


export function Obj ({
    obj,
    objref,
    ctx = 'webview',
    remote,
}: {
    obj?: DdbObj
    objref?: DdbObjRef
    ctx?: Context
    remote: Remote
}) {
    const info = obj || objref
    
    const View = views[info.form] || Default
    
    return <View obj={obj} objref={objref} ctx={ctx} remote={remote} />
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
    remote
}: {
    obj: DdbObj
    objref: DdbObjRef
    remote: Remote
}) {
    let win = window.open('./window', new Date().toString(), 'left=100,top=100,width=1000,height=640,popup')
    
    await new Promise<void>(resolve => {
        (win as any).resolve = resolve
    })
    
    ;(win.model as WindowModel).set({
        obj,
        objref,
        remote,
    })
}


function Default ({ obj }: { obj: DdbObj }) {
    return <div>{obj.toString()}</div>
}


function Vector ({
    obj,
    objref,
    ctx,
    remote,
}: {
    obj: DdbObj<DdbVectorValue>
    objref: DdbObjRef<DdbVectorValue>
    ctx: Context
    remote: Remote
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
            if (obj)
                return
            
            const { node, name, rows } = objref
            
            const offset = page_size * page_index
            
            if (offset >= rows)
                return
            
            const script = `${name}[${offset}:${Math.min(offset + page_size, rows)}]`
            
            console.log('vector.fetch:', script)
            
            objref.obj = DdbObj.parse(
                ... await remote.call<[Uint8Array, boolean]>({
                    func: 'eval',
                    args: [node, script]
                })
                
            ) as DdbObj<DdbObj[]>
            
            render({ })
        })()
    }, [obj, objref, page_index, page_size])
    
    
    if (!info.rows)
        return <>{ (obj || objref.obj).toString() }</>
    
    let rows = new Array(nrows)
    for (let i = 0;  i < nrows;  i++)
        rows[i] = i
    
    let cols = new Array(ncols)
    for (let i = 0;  i < ncols;  i++)
        cols[i] = new VectorColumn({
            obj,
            objref,
            index: i,
            ncols,
            page_index,
            page_size,
        })
    
    return <div className='vector'>
        <AntTable
            dataSource={rows}
            rowKey={x => x}
            bordered
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
            pagination={false}
        />
        
        <div className='bottom-bar'>
            <div className='actions'>
                {(ctx === 'page' || ctx === 'embed') && <Icon
                    className='icon-link'
                    component={SvgLink}
                    onClick={async () => {
                        await open_obj({ obj, objref, remote })
                    }}
                />}
            </div>
            
            <Pagination
                className='pagination'
                total={info.rows}
                current={page_index + 1}
                pageSize={page_size}
                pageSizeOptions={
                    ctx === 'window' ?
                        [10, 50, 100, 200, 500, 1000, 10000, 100000]
                    :
                        [20, 100, 200, 400, 1000, 10000, 100000]
                }
                
                size='small'
                showSizeChanger
                showQuickJumper
                hideOnSinglePage={page_size <= 200}
                
                onChange={(page_index, page_size) => {
                    set_page_size(page_size)
                    set_page_index(page_index - 1)
                }}
            />
        </div>
    </div>
}

class VectorColumn implements TableColumnType <number> {
    index: number
    
    obj?: DdbObj<DdbVectorValue>
    objref?: DdbObjRef<DdbVectorValue>
    
    ncols: number
    
    page_index: number
    page_size: number
    
    title: number
    key: number
    
    constructor (data: Partial<VectorColumn>) {
        Object.assign(this, data)
        this.title = this.index
        this.key = this.index
    }
    
    render = (value: any, row: number, index: number) => 
        <Cell
            obj={this.obj || this.objref.obj}
            index={
                (this.obj ? 
                    this.page_size * this.page_index
                :
                    0
                ) + this.ncols * index + this.index
            }
        />
}


let decoder = new TextDecoder()

function Cell ({
    obj,
    index
}: {
    obj: DdbObj<DdbVectorValue>
    index: number
}) {
    if (!obj || index >= obj.rows)
        return null
    
    const str = (() => {
        // 逻辑类似 ddb.browser.ts 中的 DdbObj.toString(), 但是只返回一项
        // case DdbForm.vector:
        // case DdbForm.pair:
        // case DdbForm.set:
        
        if (64 <= obj.type && obj.type < 128) {  // array vector
            // 因为 array vector 目前只支持：Logical, Integral（不包括 INT128, COMPRESS 类型）, Floating, Temporal
            // 都对应 TypedArray 中的一格，所以 lengths.length 等于 block 中的 row 的个数
            // av = array(INT[], 0, 5)
            // append!(av, [1..1])
            // append!(av, [1..70000])
            // append!(av, [1..1])
            // append!(av, [1..500])
            // ...
            // av
            
            const _type = obj.type - 64
            
            let offset = 0
            
            for (const { lengths, data, rows } of obj.value as DdbArrayVectorBlock[]) {
                let acc_len = 0
                
                if (offset + rows <= index) {
                    offset += rows
                    continue  // 跳过这个 block
                }
                
                for (const length of lengths) {
                    if (offset < index) {
                        offset++
                        acc_len += length
                        continue
                    }
                    
                    const limit = 10
                    
                    let items = new Array(
                        Math.min(limit, length)
                    )
                    
                    for (let i = 0;  i < items.length;  i++)
                        items[i] = format(_type, data[acc_len + i], obj.le)
                    
                    return (
                        items.join(', ') + (length > limit ? ', ...' : '')
                    ).bracket('square')
                }
            }
        }
        
        switch (obj.type) {
            case DdbType.string:
            case DdbType.symbol:
                return obj.value[index]
            
            case DdbType.symbol_extended: {
                const { base, data } = obj.value as DdbSymbolExtendedValue
                return base[data[index]]
            }
            
            case DdbType.uuid:
            case DdbType.int128: 
            case DdbType.ipaddr:
                return format(
                    obj.type,
                    (obj.value as Uint8Array).subarray(16 * index, 16 * (index + 1)),
                    obj.le
                )
            
            case DdbType.blob: {
                const value = obj.value[index] as Uint8Array
                return value.length > 100 ?
                        decoder.decode(
                            value.subarray(0, 98)
                        ) + '…'
                    :
                        decoder.decode(value)
            }
            
            case DdbType.complex:
            case DdbType.point:
                return format(
                    obj.type,
                    (obj.value as Float64Array).subarray(2 * index, 2 * (index + 1)),
                    obj.le
                )
            
            
            default:
                return format(obj.type, obj.value[index], obj.le)
        }
    })()
    
    return str === 'null' ? null : <>{str}</>
}


function Table ({
    obj,
    objref,
    ctx,
    remote,
}: {
    obj?: DdbObj<DdbObj<DdbVectorValue>[]>
    objref?: DdbObjRef<DdbObj<DdbVectorValue>[]>
    ctx: Context
    remote: Remote
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
            
            console.log(`table.fetch:`, script)
            
            objref.obj = DdbObj.parse(
                ... await remote.call<[Uint8Array, boolean]>({
                    func: 'eval',
                    args: [node, script]
                })
            ) as DdbObj<DdbObj<DdbVectorValue>[]>
            
            render({ })
        })()
    }, [obj, objref, page_index, page_size])
    
    
    let rows = new Array(nrows)
    for (let i = 0;  i < nrows;  i++)
        rows[i] = i
    
    let cols = new Array(ncols)
    for (let i = 0;  i < ncols;  i++)
        cols[i] = new TableColumn({
            obj,
            objref,
            index: i,
            page_index,
            page_size,
        })
        
    
    return <div className='table'>
        { ctx !== 'webview' && <div className='info'>
            <span className='name'>{info.name || 'table'}</span>
            <span className='desc'>{info.rows} × {info.cols}  { objref ? `(${Number(objref.bytes).to_fsize_str()})` : '' }</span>
        </div> }
        
        <AntTable
            dataSource={rows}
            rowKey={x => x}
            bordered
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
            pagination={false}
        />
        
        <div className='bottom-bar'>
            <div className='actions'>
                {(ctx === 'page' || ctx === 'embed') && <Icon
                    className='icon-link'
                    component={SvgLink}
                    onClick={async () => {
                        await open_obj({ obj, objref, remote })
                    }}
                />}
            </div>
            
            <Pagination
                className='pagination'
                total={info.rows}
                current={page_index + 1}
                pageSize={page_size}
                pageSizeOptions={[5, 10, 20, 50, 100, 200, 500, 1000, 10000, 100000]}
                size='small'
                showSizeChanger
                showQuickJumper
                hideOnSinglePage={page_size <= 50}
                
                onChange={(page_index, page_size) => {
                    set_page_size(page_size)
                    set_page_index(page_index - 1)
                }}
            />
        </div>
    </div>
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
    
    index: number
    
    obj?: DdbObj<DdbObj<DdbVectorValue>[]>
    objref?: DdbObjRef<DdbObj<DdbVectorValue>[]>
    
    col?: DdbObj<DdbVectorValue>
    
    page_index: number
    page_size: number
    
    title: React.ReactNode
    key: number
    
    align: 'left' | 'center' | 'right'
    
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
    
    render = (irow: number) => 
        <Cell
            obj={this.col}
            index={
                (this.obj ?
                    this.page_size * this.page_index
                :
                    0
                ) + irow
            }
        />
}


function Matrix ({
    obj,
    objref,
    ctx,
    remote,
}: {
    obj?: DdbObj<DdbMatrixValue>
    objref?: DdbObjRef<DdbMatrixValue>
    ctx?: Context
    remote: Remote
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
            
            console.log('matrix.fetch', script)
            
            objref.obj = DdbObj.parse(
                ... await remote.call<[Uint8Array, boolean]>({
                    func: 'eval',
                    args: [node, script]
                })
            ) as DdbObj<DdbMatrixValue>
            
            render({ })
        })()
    }, [obj, objref, page_index, page_size])
    
    
    let rows = new Array(nrows)
    for (let i = 0;  i < nrows;  i++)
        rows[i] = i
    
    let cols = new Array(ncols)
    for (let i = 0;  i < ncols;  i++)
        cols[i] = new MatrixColumn({
            obj,
            objref,
            index: i,
            page_index,
            page_size,
        })
    
    return <div className='matrix'>
        <AntTable
            dataSource={rows}
            rowKey={x => x}
            bordered
            columns={[
                {
                    title: '',
                    key: 'index',
                    className: 'row-head',
                    fixed: 'left',
                    render (irow) {
                        const i = obj ? 
                                page_size * page_index + irow
                            :
                                irow
                        
                        return (obj || objref.obj)?.value.rows?.value[i] || i
                    }
                },
                ... cols
            ]}
            pagination={false}
        />
        
        <div className='bottom-bar'>
            <div className='actions'>
                {(ctx === 'page' || ctx === 'embed') && <Icon
                    className='icon-link'
                    component={SvgLink}
                    onClick={async () => {
                        await open_obj({ obj, objref, remote })
                    }}
                />}
            </div>
            
            <Pagination
                className='pagination'
                total={info.rows}
                current={page_index + 1}
                pageSize={page_size}
                pageSizeOptions={[5, 10, 20, 50, 100, 200, 500, 1000, 10000, 100000]}
                size='small'
                showSizeChanger
                showQuickJumper
                hideOnSinglePage={page_size <= 50}
                
                onChange={(page_index, page_size) => {
                    set_page_size(page_size)
                    set_page_index(page_index - 1)
                }}
            />
        </div>
    </div>
}

class MatrixColumn implements TableColumnType <number> {
    index: number
    
    obj?: DdbObj<DdbMatrixValue>
    objref?: DdbObjRef<DdbMatrixValue>
    
    page_index: number
    page_size: number
    
    title: number
    key: number
    
    constructor (data: Partial<MatrixColumn>) {
        Object.assign(this, data)
        this.title = this.index
        this.key = this.index
        let obj = this.obj || this.objref.obj
        if (!obj)
            return
        this.title = obj.value.cols?.value[this.index] || this.index
    }
    
    render = (irow: number) => {
        const obj = this.obj || this.objref.obj
        
        if (!obj)
            return null
        
        return <Cell
            obj={
                new DdbObj({
                    form: obj.form,
                    type: obj.type,
                    rows: obj.cols * obj.rows,
                    value: obj.value.data
                })
            }
            index={
                this.obj ?
                    obj.rows * this.index + this.page_size * this.page_index + irow
                :
                    obj.rows * this.index + irow
            }
        />
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
}: {
    obj?: DdbObj<DdbChartValue>
    objref?: DdbObjRef<DdbChartValue>
    ctx?: Context
    remote: Remote
}) {
    const [
        {
            inited,
            charttype,
            data,
            titles,
            stacking,
            multi_y_axes,
            col_labels
        },
        set_config
    ] = useState({
        inited: false,
        charttype: DdbChartType.line,
        data: [ ],
        titles: { } as DdbChartValue['titles'],
        stacking: false,
        multi_y_axes: false,
        col_labels: [ ]
    })
    
    useEffect(() => {
        (async () => {
            const {
                value: {
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
            } = obj || DdbObj.parse(
                ... await remote.call<[Uint8Array, boolean]>({
                    func: 'eval',
                    args: [objref.node, objref.name]
                })
            ) as DdbObj<DdbChartValue>
            
            const { multi_y_axes = false } = extras || { }
            
            let col_labels = (cols_?.value || [ ]) as any[]
            let col_lables_ = new Array(col_labels.length)
            
            // 没有设置 label 的情况
            let row_labels_ = new Array(rows)
            
            for (let i = 0; i < rows; i++) 
                row_labels_[i] = i
            
            let row_labels = (rows_?.value || row_labels_) as any[]
                       
            const n = charttype === DdbChartType.line && multi_y_axes || charttype === DdbChartType.kline ? rows : rows * cols
            let data_ = new Array(n)
            
            switch (charttype) {
                case DdbChartType.line:
                    if (multi_y_axes === true) 
                        for (let j = 0; j < rows; j++) {
                            let dataobj: any = { }
                            dataobj.row = String(row_labels[j])
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
                                    row: String(row_labels[j]),
                                    col,
                                    value: to_chart_data(data[idata], datatype)
                                }
                            }
                        }
                    break
                    
                case DdbChartType.kline:
                    for (let j = 0; j < rows; j++) {
                        let dataobj: any = { }
                        dataobj.row = (() => {
                            switch (rows_.type) {
                                case DdbType.date:
                                    return date2ms(row_labels[j])
                                
                                case DdbType.month:
                                    return month2ms(row_labels[j])
                                
                                case DdbType.time:
                                    return time2ms(row_labels[j])
                                
                                case DdbType.minute:
                                    return minute2ms(row_labels[j])
                                
                                case DdbType.second:
                                    return second2ms(row_labels[j])
                                
                                case DdbType.datetime:
                                    return datetime2ms(row_labels[j])
                                
                                case DdbType.timestamp:
                                    return timestamp2ms(row_labels[j])
                                
                                case DdbType.nanotime:
                                    return Number(nanotime2ns(row_labels[j])) / 1000000
                                
                                case DdbType.nanotimestamp:
                                    return Number(nanotimestamp2ns(row_labels[j])) / 1000000
                                
                                case DdbType.datehour:
                                    return datehour2ms(row_labels[j])
                            }
                        })()

                        dataobj.open = to_chart_data(data[j], datatype)
                        dataobj.high = to_chart_data(data[rows + j], datatype)
                        dataobj.low = to_chart_data(data[rows * 2 + j], datatype)
                        dataobj.close = to_chart_data(data[rows * 3 + j], datatype)
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
                                row: charttype === DdbChartType.scatter ? row_labels[j] : String(row_labels[j]),
                                col,
                                value: to_chart_data(data[idata], datatype)
                            }
                        }
                    }
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
                        binNumber={50}
                        // binWidth={0.1}
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
                        padding='auto'
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
                    component={SvgLink}
                    onClick={async () => {
                        await open_obj({ obj, objref, remote })
                    }}
                />}
            </div>
        </div>
    </div>
}

import {
    window,
    
    commands,
    
    ThemeIcon,
    
    EventEmitter, type Event,
    
    type TreeView, TreeItem, TreeItemCollapsibleState, type TreeDataProvider
} from 'vscode'

import { inspect, defer, strcmp } from 'xshell'

import {
    DdbForm,
    DdbObj,
    DdbType,
    DdbFunctionType,
    format, formati,
    type DdbFunctionDefValue,
    type DdbVectorValue,
    type InspectOptions,
    type DdbDictObj,
    type DdbVectorStringObj,
} from 'dolphindb'

import { t } from '../i18n/index.js'

import { formatter } from './formatter.js'
import { server, start_server } from './server.js'
import { dataview } from './dataview/dataview.js'

import { type DdbConnection, connector } from './connector.js'

import { fpd_ext } from './index.js'



export class DdbVars implements TreeDataProvider<TreeItem> {
    view: TreeView<TreeItem>
    
    refresher: EventEmitter<TreeItem | undefined | void> = new EventEmitter<TreeItem | undefined | void>()
    
    onDidChangeTreeData: Event<void | TreeItem> = this.refresher.event
    
    
    getTreeItem (node: TreeItem): TreeItem | Thenable<TreeItem> {
        return node
    }
    
    
    getChildren (node?: TreeItem) {
        switch (true) {
            case !node: {
                const { local, shared } = connector.connection
                return [local, shared].filter(node => node.vars.length)
            }
            
            case node instanceof DdbVarLocation: {
                const { scalar, object, pair, vector, set, dict, matrix, table, chart, chunk, tensor } = node as DdbVarLocation
                return [scalar, object, pair, vector, set, dict, matrix, table, chart, chunk, tensor].filter(node => node.vars.length)
            }
            
            case node instanceof DdbVarForm:
                return (node as DdbVarForm).vars
        }
    }
}


export class DdbVarLocation extends TreeItem { 
    shared: boolean
    
    vars: DdbVar[] = [ ]
    
    // ---
    scalar: DdbVarForm
    
    vector: DdbVarForm
    
    pair: DdbVarForm
    
    matrix: DdbVarForm
    
    set: DdbVarForm
    
    dict: DdbVarForm
    
    table: DdbVarForm
    
    chart: DdbVarForm
    
    chunk: DdbVarForm
    
    object: DdbVarForm
    
    tensor: DdbVarForm
    
    
    constructor (shared: boolean) {
        super(shared ? t('共享变量') : t('本地变量'), TreeItemCollapsibleState.Expanded)
        this.shared = shared
        
        this.scalar = new DdbVarForm(this.shared, DdbForm.scalar)
        this.vector = new DdbVarForm(this.shared, DdbForm.vector)
        this.pair   = new DdbVarForm(this.shared, DdbForm.pair)
        this.matrix = new DdbVarForm(this.shared, DdbForm.matrix)
        this.set    = new DdbVarForm(this.shared, DdbForm.set)
        this.dict   = new DdbVarForm(this.shared, DdbForm.dict)
        this.table  = new DdbVarForm(this.shared, DdbForm.table)
        this.chart  = new DdbVarForm(this.shared, DdbForm.chart)
        this.chunk  = new DdbVarForm(this.shared, DdbForm.chunk)
        this.object = new DdbVarForm(this.shared, DdbForm.object)
        this.tensor = new DdbVarForm(this.shared, DdbForm.tensor)
    }
    
    
    update (vars: DdbVar[]) {
        this.vars = vars
        
        if (!vars.length)
            return
        
        let scalars: DdbVar[] = [ ]
        let vectors: DdbVar[] = [ ]
        let pairs:   DdbVar[] = [ ]
        let matrixs: DdbVar[] = [ ]
        let sets:    DdbVar[] = [ ]
        let dicts:   DdbVar[] = [ ]
        let tables:  DdbVar[] = [ ]
        let charts:  DdbVar[] = [ ]
        let chunks:  DdbVar[] = [ ]
        let objects:  DdbVar[] = [ ]
        let tensors: DdbVar[] = [ ]
        
        for (const v of this.vars)
            switch (v.form) {
                case DdbForm.scalar:
                    scalars.push(v)
                    break
                    
                case DdbForm.vector:
                    vectors.push(v)
                    break
                    
                case DdbForm.pair:
                    pairs.push(v)
                    break
                    
                case DdbForm.matrix:
                    matrixs.push(v)
                    break
                    
                case DdbForm.set:
                    sets.push(v)
                    break
                    
                case DdbForm.dict:
                    dicts.push(v)
                    break
                    
                case DdbForm.table:
                    tables.push(v)
                    break
                    
                case DdbForm.chart:
                    charts.push(v)
                    break
                    
                case DdbForm.chunk:
                    chunks.push(v)
                    break
                    
                case DdbForm.object:
                    objects.push(v)
                    break
                    
                case DdbForm.tensor:
                    tensors.push(v)
                    break
            }
        
        this.scalar.update(scalars)
        this.vector.update(vectors)
        this.pair.update(pairs)
        this.matrix.update(matrixs)
        this.set.update(sets)
        this.dict.update(dicts)
        this.table.update(tables.sort((a, b) => strcmp(a.name, b.name)))
        this.chart.update(charts)
        this.chunk.update(chunks)
        this.object.update(objects)
        this.tensor.update(tensors)
    }
}


export class DdbVarForm extends TreeItem {
    static form_names = {
        [DdbForm.scalar]: t('标量'),
        [DdbForm.vector]: t('向量'),
        [DdbForm.pair]: t('数对'),
        [DdbForm.matrix]: t('矩阵'),
        [DdbForm.set]: t('集合'),
        [DdbForm.dict]: t('词典'),
        [DdbForm.table]: t('表格'),
        [DdbForm.chart]: t('绘图'),
        [DdbForm.object]: t('对象'),
        [DdbForm.tensor]: t('张量'),
    } as const
    
    shared: boolean
    
    form: DdbForm
    
    vars: DdbVar[]
    
    
    constructor (shared: boolean, form: DdbForm) {
        super(DdbVarForm.form_names[form] || DdbForm[form], TreeItemCollapsibleState.Expanded)
        this.shared = shared
        this.form = form
        this.iconPath = `${fpd_ext}icons/${DdbForm[form]}.svg`
    }
    
    
    update (vars: DdbVar[]) {
        this.vars = vars
    }
}


export class DdbVar <TObj extends DdbObj = DdbObj> extends TreeItem {
    static size_limit = 10240n as const
    
    static icon = new ThemeIcon('symbol-variable')
    
    static contexts = {
        [DdbForm.scalar]: 'scalar',
        [DdbForm.pair]: 'pair',
        [DdbForm.object]: 'object',
        [DdbForm.table]: 'table',
    } as const
    
    node: string
    
    connection: DdbConnection
    
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
    obj: TObj
    
    /** 存放 table 类型数据 schema */
    schema: DdbDictObj<DdbVectorStringObj>
    
    
    constructor (data: Partial<DdbVar>) {
        super(data.name, TreeItemCollapsibleState.None)
        
        Object.assign(this, data)
        
        this.label = (() => {
            const tname = DdbType[this.type]
            
            const type = (() => {
                switch (this.form) {
                    case DdbForm.scalar:
                        if (this.type === DdbType.functiondef)
                            return `<functiondef<${DdbFunctionType[(this.obj.value as DdbFunctionDefValue).type]}>>`
                        
                        return `<${tname}>`
                    
                    case DdbForm.pair:
                        return `<${tname}>`
                    
                    case DdbForm.vector:
                        return `<${ 64 <= this.type && this.type < 128 ? `${DdbType[this.type - 64]}[]` : tname }> ${this.rows} ${t('个元素')}`
                    
                    case DdbForm.set:
                        return `<${tname}> ${this.rows} ${t('个元素')}`
                    
                    case DdbForm.table:
                        return ` ${this.rows} ${t('行')} ${this.cols} ${t('列')}`
                    
                    case DdbForm.dict:
                        return ` ${this.rows} ${t('个键')}`
                    
                    case DdbForm.matrix:
                        return `<${tname}> ${this.rows} ${t('行')} ${this.cols} ${t('列')}`
                    
                    case DdbForm.object:
                        return ''
                        
                    case DdbForm.tensor:
                        return ` tensor<${DdbType[this.type]}>`
                    
                    default:
                        return ` ${DdbForm[this.form]} ${tname}`
                }
            })()
            
            const value = (() => {
                switch (this.form) {
                    case DdbForm.scalar:
                        return ' = ' + format(this.type, this.obj.value, this.obj.le, { colors: false, decimals: formatter.decimals })
                    
                    case DdbForm.pair:
                        return ' = [' +
                            formati(this.obj as DdbObj<DdbVectorValue>, 0, { colors: false, decimals: formatter.decimals }) +
                            ', ' +
                            formati(this.obj as DdbObj<DdbVectorValue>, 1, { colors: false, decimals: formatter.decimals }) +
                        ']'
                    
                    case DdbForm.object:
                        return ''
                    
                    default:
                        return ` (${Number(this.bytes).to_fsize_str()})`
                }
            })()
            
            return this.name + type + value
        })()
        
        // scalar, pair 不显示 inspect actions, 作特殊区分
        this.contextValue = DdbVar.contexts[this.form] || 'var'
        
        this.iconPath = DdbVar.icon
        
        this.command = {
            title: 'dolphindb.inspect_variable',
            command: 'dolphindb.inspect_variable',
            arguments: [this],
        }
    }
    
    
    /** 类似 DDB.[inspect.custom], 对于 bytes 大的对象不获取值 */
    get_value_type () {
        const tname = DdbType[this.type]
        
        switch (this.form) {
            case DdbForm.scalar:
                return tname
            
            case DdbForm.vector:
                if (64 <= this.type && this.type < 128)
                    return `${DdbType[this.type - 64]}[][${this.rows}]`
                return `${tname}[${this.rows}]`
            
            case DdbForm.pair:
                return `pair<${tname}>`
            
            case DdbForm.set:
                return `set<${tname}>[${this.rows}]`
            
            case DdbForm.table:
                return `table[${this.rows}r][${this.cols}c]`
            
            case DdbForm.dict:
                return `dict[${this.rows}]`
            
            case DdbForm.matrix:
                return `matrix[${this.rows}r][${this.cols}c]`
            
            case DdbForm.object:
                return 'object'
            
            default:
                return `${DdbForm[this.form]} ${tname}`
        }
    }
    
    
    async get_schema () {
        if (this.schema)
            return this.schema
        else {
            await connector.connection.define_load_table_variable_schema()
            return this.schema = await this.connection.ddb.call('load_table_variable_schema', [this.name])
        }
    }
    
    
    /**  - open?: 是否在新窗口中打开 
         - schema?: 是否是查看表结构 */
    async inspect (open = false) {
        if (open) {
            if (!server)
                await start_server()
            
            if (!server.subscribers_inspection.length) {
                dataview.ppage = defer<void>()
                
                await commands.executeCommand('vscode.open', server.web_url)
                
                await dataview.ppage
            }
        } else {
            // 遇到 dataview 还未加载时，先等待其加载，再 inspect 变量
            if (!dataview.view)
                await commands.executeCommand('workbench.view.extension.ddbpanel')
            
            await dataview.pwebview
            
            dataview.view.show(true)
        }
        
        let obj = this.obj
        
        const args = [
            {
                node: this.node,
                name: this.name,
                form: this.form,
                type: this.type,
                rows: this.rows,
                cols: this.cols,
                bytes: this.bytes,
                shared: this.shared,
                extra: this.extra,
            },
            open,
            { decimals: formatter.decimals },
            ... (obj ? [obj.pack(), obj.le] : [null, DdbObj.le_client]) as [Uint8Array, boolean],
        ] as const
        
        
        for (const subscriber of dataview.subscribers_inspection)
            subscriber(...args)
        
        if (server)
            for (const subscriber of server.subscribers_inspection)
                subscriber(...args)
    }
    
    
    async resolve_tooltip () {
        if (!this.obj && this.bytes <= DdbVar.size_limit)
            this.obj = await this.connection.ddb.eval(this.name)
        
        this.tooltip = this.obj ?
                this.form === DdbForm.object ?
                    (this.obj.value as string)
                :
                    inspect(this.obj, { colors: false, decimals: formatter.decimals } as InspectOptions)
            :
                `${this.get_value_type()}(${Number(this.bytes).to_fsize_str()})`
    }
}


export let variables: DdbVars


export function register_variables () {
    variables = new DdbVars()
    variables.view = window.createTreeView('dolphindb.variables', { treeDataProvider: variables })
}

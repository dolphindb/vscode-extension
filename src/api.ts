import axios from 'axios'
import { getBorderCharacters, table, TableUserConfig } from 'table'

const tableConfig: TableUserConfig = {
    border: getBorderCharacters('norc'),
}

export interface IDolphindbResponse {
    msg: string,
    object: IDolphindbObject[],
    resultCode: string,
    sessionID: string,
    userId: string,
}

export interface IDolphindbRequest {
    sessionID: string,
    functionName: string,
    params: IDolphindbObject[]
}

export interface IDolphindbObject {
    name: string,
    form: string,
    value: Scalar | IDolphindbAttr[] | Scalar[],
    size?: string,
    type?: string,
}

export interface IDolphindbAttr {
    name: string,
    form: string,
    type: string,
    size: string,
    value: number | string | (number | string)[]
}

type Scalar = number | string

function JsonUrl(host: string, port: number): string {
    return `http://${host}:${port}`
}

export function executeCode(host: string, port: number, code: string, sessionID: string = '0'): Thenable<any> {
    const data: IDolphindbRequest = {
        sessionID,
        functionName: 'executeCode',
        params: [{
            name: 'script',
            form: 'scalar',
            type: 'string',
            value: code
        }]
    }

    return axios({
        method: 'post',
        url: JsonUrl(host, port),
        data,
    })
}

// todo
export function testCode(host: string, port: number, code: string, sessionID: string = '0'): Thenable<any> {
    const data: IDolphindbRequest = {
        sessionID,
        functionName: 'executeCode',
        params: [{
            name: 'script',
            form: 'scalar',
            type: 'string',
            value: code
        }]
    }

    return axios({
        method: 'post',
        url: JsonUrl(host, port),
        data,
    })
}

export function fetchEnv(host: string, port: number, sessionID: string = '0'): Thenable<any> {
    const data: IDolphindbRequest = {
        sessionID,
        functionName: 'executeCode',
        params: [{
            name: 'script',
            form: 'scalar',
            type: 'string',
            value: 'objs(true)',
        }]
    }

    return axios({
        method: 'post',
        url: JsonUrl(host, port),
        data,
    })
}


export class DolphindbJson {
    constructor(private readonly _json: IDolphindbResponse) { }

    toJsString(): string {
        if (this._json_is_illegal()) {
            return this.errorMessage()
        }
        switch (this.dataForm()) {
            case 'scalar':
                switch (this.dataType()) {
                    case 'void':
                        return 'null'
                    default:
                        return this.toScalarStyle()
                }
            case 'vector':
                return this.toVectorStyle()

            case 'pair':
                return this.toPairStyle()

            case 'matrix':
                // todo
                return this.toMatrixStyle()

            case 'set':
                return this.toSetStyle()

            case 'dictionary':
                return this.toDictStyle()

            case 'table':
                return this.toTableStyle()

            default:
                throw TypeError('illegal json type')
        }
    }

    errorMessage(): string {
        return this._json.msg === '' ? '' : 'Execution was completed with exception\n' + this._json.msg
    }

    dataForm(): string {
        return this._json.object[0].form
    }

    dataType(): string {
        return this._json.object[0].type ? this._json.object[0].type : ''
    }

    userId(): string {
        return this._json.userId
    }

    sessionID(): string {
        return this._json.sessionID
    }

    _json_is_illegal(): boolean {
        if (typeof this._json !== 'object' || this._json.resultCode !== '0' || this._json.object.length <= 0) {
            return true
        }
        return false

    }

    getDataSize(): number {
        return +this._json.object[0].size
    }

    toScalar(): Scalar {
        return this._json.object[0].value as (Scalar)
    }

    static scalarFormat(dataType: string, scalar: Scalar): Scalar {
        switch (dataType) {
            case 'string':
                return '"' + scalar + '"'
            case 'char':
                return '\'' + scalar + '\''
            default:
                return scalar
        }
    }

    toScalarStyle(): string {
        let json = this.toScalar()
        return DolphindbJson.scalarFormat(this.dataType(), json).toString()
    }

    toPair(): [string, string] {
        let pair = this._json.object[0].value
        return [
            DolphindbJson.scalarFormat(this.dataType(), pair[0]).toString(),
            DolphindbJson.scalarFormat(this.dataType(), pair[1]).toString(),
        ]
    }

    toPairStyle(): string {
        return `pair(${this.toPair().join(', ')})`
    }

    toVector(): Scalar[] {
        return this._json.object[0].value as Scalar[]
    }

    toVectorStyle(): string {
        let vec = this.toVector()
        let res = vec.map((elem) => DolphindbJson.scalarFormat(this.dataType(), elem))
        return '[' + res.join(', ') + ']'
    }

    toVectorTableStyle(): string {
        let vec = this.toVector()
        let res = vec.map((elem) => DolphindbJson.scalarFormat(this.dataType(), elem))
        return table([res], tableConfig)
    }

    toDict(): Map<string, string> {
        let dict = this._json.object[0].value
        let map = new Map()
        let size = this.getDataSize()
        for (let i = 0; i < size; i++) {
            let key = DolphindbJson.scalarFormat(dict[0].type, dict[0].value[i])
            let val = DolphindbJson.scalarFormat(dict[1].type, dict[1].value[i])
            map.set(key, val)
        }
        return map
    }

    toDictStyle(): string {
        let map = this.toDict()
        if (map.size === 0) {
            return 'dict()'
        }
        let res = 'dict(\n'
        for (let [key, val] of map) {
            res += '  ' + key + '->' + val + ',\n'
        }
        res += ')\n'
        return res
    }

    toDictTableStyle(): string {
        let tbl = [['#key'], ['#value']]

        let map = this.toDict()
        for (let [k, v] of map) {
            tbl[0].push(k)
            tbl[1].push(v)
        }
        return table(tbl, tableConfig)
    }

    toSet(): Set<any> {
        let set = new Set()
        let val = this._json.object[0].value as []
        val.forEach((elem) => {
            set.add(DolphindbJson.scalarFormat(this.dataType(), elem))
        })
        return set
    }

    toSetStyle(): string {
        let set = this.toSet()
        let res = 'set('
        for (let val of set) {
            res += val + ','
        }
        res = res.slice(0, res.length - 1) + ')'
        return res
    }

    toSetTableStyle(): string {
        let set = this.toSet()
        let tbl = ['#value']
        tbl.push(...set)
        return table([tbl], tableConfig)
    }

    toTable(): { colName: string[], table: any[][] } {
        let val = this._json.object[0].value as IDolphindbAttr[]
        const table = []
        const colName = []
        let rowNum = this.getDataSize()
        let _colNum = +val[0].size

        for (let i = 0; i < val.length; i++) {
            table.push(val[i].value)
            colName.push(val[i].name)
        }

        return {
            table: transpose(table, rowNum),
            colName,
        }
    }

    toTableStyle(): string {
        let {
            colName,
            table: tbl
        } = this.toTable()
        return table([colName, ...tbl], tableConfig)
    }

    toMatrix(): { colNum: number, matrix: any[][] } {
        let val = this._json.object[0].value
        const matrix: any[][] = []
        const rowNum = +val[1].value
        const colNum = +val[2].value

        for (let i = 0; i < colNum; i++) {
            matrix.push([])
            for (let j = 0; j < rowNum; j++) {
                matrix[i][j] = val[0].value[i * colNum + j]
            }
        }

        return {
            colNum,
            matrix: transpose(matrix, rowNum),
        }
    }

    toMatrixStyle(): string {
        let {
            colNum,
            matrix
        } = this.toMatrix()
        let colName = []
        for (let i = 0; i < colNum; i++) {
            colName.push('#' + i)
        }
        return table([colName, ...matrix], tableConfig)
    }
}


function transpose<T>(table: T[][], rowNum: number) {
    const tableT: T[][] = []
    for (let i = 0; i < rowNum; i++) {
        tableT[i] = []
    }

    for (let i = 0; i < table.length; i++) {
        for (let j = 0; j < table[i].length; j++) {
            tableT[j][i] = table[i][j]
        }
    }
    return tableT
}

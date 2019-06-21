import * as vscode from 'vscode'
import * as api from './api'
import * as serverOps from './serverOps'
import { IDolphindbObject, IDolphindbAttr } from './api';
import { DolphindbContext } from './context';

const DATA_FORM = [
    'scalar',
    'pair',
    'vector',
    'set',
    'dictionary',
    'matrix',
    'table',
]


export class DolphindbEnvProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem>()
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem> = this._onDidChangeTreeData.event
    // first layer info
    private variableTypes: VariableType[] = DATA_FORM.map(ty => new VariableType(ty, vscode.TreeItemCollapsibleState.Expanded))

    constructor(private context: DolphindbContext) {
        const env = new Map()
        for(let i = 0; i < DATA_FORM.length; i++) {
            env.set(DATA_FORM[i], [])
        }
        context.ENV = env
    }

    refresh(): void {
        this._onDidChangeTreeData.fire()
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element
    }

    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
        if (element && element.contextValue === 'variableInfo') {
        } else if (element && element.contextValue === 'variableType') {
            return this.getVariableInfo(element)
        } else {
            return this.variableTypes
        }
    }

    private getVariableInfo(parent: vscode.TreeItem): VariableInfo[] {
        console.log(...this.context.ENV.get('table'))

        return this.context.ENV.get(parent.label)
    }
}


/**
 * VariableItem represent a variable type
 */
export class VariableType extends vscode.TreeItem {
    contextValue = 'variableType'

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
    ) {
        super(label, collapsibleState)
    }

    get tooltip(): string {
        return this.description
    }

    get description(): string {
        return `${this.label}`
    }
}

/**
 * VariableValue represent a variable's inner data
 */
export class VariableInfo extends vscode.TreeItem {
    contextValue = 'variableInfo'

    constructor(
        public readonly label: string,
        public readonly dataType: string,
        public readonly dataForm: string,
        public readonly row: number,
        public readonly col: number,
        public readonly byteSize: number,
        public readonly isShared: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
    ) {
        super(label, collapsibleState)
    }

    get tooltip(): string {
        return `row:${this.row} col:${this.col}`
    }

    get description(): string {
        return `${this.shared} <${this.dataType}> row: ${this.row} col: ${this.col} [${this.byteSize}B]`
    }

    get shared() {
        return this.isShared === true ? 'shared:' : ''
    }

    public static extractEnv(obj: IDolphindbObject): Map<string, VariableInfo[]> {
        const varNames = (obj.value as IDolphindbAttr[])[0].value as string[]
        const varTypes = (obj.value as IDolphindbAttr[])[1].value as string[]
        const varForms = (obj.value as IDolphindbAttr[])[2].value as string[]
        const varRows = (obj.value as IDolphindbAttr[])[3].value as number[]
        const varCols = (obj.value as IDolphindbAttr[])[4].value as number[]
        const varByteSizes = (obj.value as IDolphindbAttr[])[5].value as number[]
        const varIsShared = (obj.value as IDolphindbAttr[])[6].value as number[]

        const env = new Map<string, VariableInfo[]>()
        DATA_FORM.forEach(elem => {
            env.set(elem, [])
        })

        for (let i = 0; i < varNames.length; i++) {
            let temp = env.get(varForms[i].toLowerCase())
            if (temp === undefined) {
                vscode.window.showErrorMessage('var form not exists:' + varForms[i])
                return env
            }
            temp.push(
                new VariableInfo(
                    varNames[i], 
                    varTypes[i], 
                    varForms[i].toLowerCase(), 
                    varRows[i], 
                    varCols[i], 
                    varByteSizes[i],
                    varIsShared[i] !== 0,
                    vscode.TreeItemCollapsibleState.Expanded,
                    )
                )
        }
        return env
    }

}
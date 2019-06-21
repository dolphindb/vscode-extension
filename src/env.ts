import * as vscode from 'vscode'
import * as api from './api'
import * as serverOps from './serverOps'
import { IDolphindbObject, IDolphindbAttr } from './api';


export class DolphindbEnvProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem>;
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem>();
    // first layer info
    private variableTypes: VariableType[] = [
        'Scalar',
        'Pair',
        'Vector',
        'Set',
        'Dictionary',
        'Matrix',
        'Table',
        'Shared Table',
    ].map(ty => new VariableType(ty, vscode.TreeItemCollapsibleState.Collapsed))

    constructor(private context: serverOps.DolphindbContext) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element
    }

    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
        // when meet root
        if (!element) {
            return this.variableTypes
        } else {
            return this.createVariableValue(element)
        }
        throw new Error("Method not implemented.");
    }

    private getVariable(): vscode.TreeItem {
        throw new Error("Method not implemented.");
    }

    private createVariableValue(parent: vscode.TreeItem): VariableInfo[] {
        console.log(parent)
        throw new Error("Method not implemented.");
    }
}


/**
 * VariableItem represent a variable type
 */
export class VariableType extends vscode.TreeItem {
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

    contextValue = 'variableType'
}

/**
 * VariableValue represent a variable's inner data
 */
export class VariableInfo extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly dataType: string,
        public readonly dataForm: string,
        public readonly row: number,
        public readonly col: number,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
    ) {
        super(label, collapsibleState)
    }

    get tooltip(): string {
        return this.description
    }

    get description(): string {
        return `${this.label}-${this.dataForm}-${this.dataType}`
    }

    contextValue = 'variableItem'

    public static extractEnv(obj: IDolphindbObject): VariableInfo[] {
        const varNames = (obj.value as IDolphindbAttr[])[0].value as string[]
        const varTypes = (obj.value as IDolphindbAttr[])[1].value as string[]
        const varForms = (obj.value as IDolphindbAttr[])[2].value as string[]
        const varRows = (obj.value as IDolphindbAttr[])[3].value as number[]
        const varCols = (obj.value as IDolphindbAttr[])[4].value as number[]

        const varInfos: VariableInfo[] = []
        for (let i = 0; i < varNames.length; i++) {
            varInfos.push(
                new VariableInfo(
                    varNames[i], 
                    varTypes[i], 
                    varForms[i], 
                    varRows[i], 
                    varCols[i], 
                    vscode.TreeItemCollapsibleState.Expanded,
                    )
                )
        }
        return varInfos
    }

}
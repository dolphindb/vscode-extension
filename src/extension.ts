// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'
import * as api from './code'
import * as _ from 'lodash/fp'


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    const executeCode = vscode.commands.registerCommand('dolphindb.executeCode', dolphindbExecuteCode)
    const addServer = vscode.commands.registerCommand('dolphindb.addServer', dolphindbAddServer)
    const chooseServer = vscode.commands.registerCommand('dolphindb.chooseServer', dolphindbChooseServer)
    const removeServer = vscode.commands.registerCommand('dolphindb.removeServer', dolphindbRemoveServer)
    // vscode.window.registerTreeDataProvider('dolphindb-explorer')

    context.subscriptions.push(executeCode)
    context.subscriptions.push(addServer)
    context.subscriptions.push(chooseServer)
    context.subscriptions.push(removeServer)
}

// this method is called when your extension is deactivated
export function deactivate() { }


// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

const dolphindbOutput = vscode.window.createOutputChannel('dolphindbOutput')

export interface IConfig {
    name: string,
    ip: string,
    port: number
}


const defaultCfg: IConfig = {
    name: 'default',
    ip: '127.0.0.1',
    port: 8848,
}

let currentCfg = _.cloneDeep(defaultCfg)

const context = {
    sessionID: '0',
}

async function dolphindbExecuteCode() {
    let selected = (vscode.window.activeTextEditor as vscode.TextEditor).selection.with()
    let code = (vscode.window.activeTextEditor as vscode.TextEditor).document.getText(selected)

    let {
        data
    } = await api.executeCode(currentCfg.ip, currentCfg.port, code, context.sessionID)
    let {
        data: env
    } = await api.fetchEnv(currentCfg.ip, currentCfg.port, context.sessionID)
    let json = new api.DolphindbJson(data)
    // keep the sessionID
    context.sessionID = json.sessionID()
    let res = json.toJsString()
    let text = new Date() + ': executing code...\n' +
        (res ? res : '') + '\n' +
        new Date() + ': execution was completed\n'

    dolphindbOutput.appendLine(text)
    dolphindbOutput.show()
}

async function dolphindbChooseServer() {
    let address = vscode.workspace.getConfiguration('dolphindb.server').get('address') as IConfig[]

    let descs = address.map(({
        name,
        ip,
        port
    }) => `${name}: ${ip}:${port}`)

    vscode.window.showQuickPick(descs)
        .then((desc) => {
            currentCfg = address[_.findIndex((desc_) => desc == desc_, descs)]
        })
}

async function dolphindbRemoveServer() {
    let address = vscode.workspace.getConfiguration('dolphindb.server').get('address') as IConfig[]
    let descs = address.map(({
        name,
        ip,
        port
    }) => `${name}: ${ip}:${port}`)

    vscode.window.showQuickPick(descs)
        .then((desc) => {
            address[_.findIndex((desc_) => desc == desc_, descs)] = null

            address = _.filter(elem => elem != null, address)
            vscode.workspace.getConfiguration('dolphindb.server').update('address', address)
        })
}

async function dolphindbAddServer() {
    let name = await vscode.window.showInputBox({
        placeHolder: defaultCfg.name,
        prompt: 'Please input the host name'
    })

    let ip = await vscode.window.showInputBox({
        placeHolder: defaultCfg.ip,
        prompt: 'Please input the host ip'
    })

    let port = await vscode.window.showInputBox({
        placeHolder: defaultCfg.port.toString(),
        prompt: 'Please input the host port'
    })

    if (port != undefined && isNaN(Number.parseInt(port))) {
        throw TypeError('port must be number')
    }

    let port2 = Number.parseInt(port as string)
    let address = vscode.workspace.getConfiguration('dolphindb.server').get('address') as IConfig[]

    const cfg: IConfig = {
        name: name ? name : defaultCfg.name,
        ip: ip ? ip : defaultCfg.ip,
        port: port2 ? port2 : defaultCfg.port,
    }

    address.push(cfg)
    address = _.uniqWith(_.isEqual, address)
    address = _.filter(
        elem => (elem != null &&
            typeof elem.name === 'string' &&
            typeof elem.ip === 'string' &&
            !isNaN(elem.port)),
        address)

    vscode.workspace.getConfiguration('dolphindb.server').update('address', address, false)
}

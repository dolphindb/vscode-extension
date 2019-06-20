import * as vscode from 'vscode'
import * as _ from 'lodash/fp'
import * as api from './api'

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

const dolphindbOutput = vscode.window.createOutputChannel('dolphindbOutput')


export async function dolphindbExecuteCode() {
    let selected = (vscode.window.activeTextEditor as vscode.TextEditor).selection.with()
    let code = (vscode.window.activeTextEditor as vscode.TextEditor).document.getText(selected)

    let { data } = await api.executeCode(currentCfg.ip, currentCfg.port, code, context.sessionID)
    let { data: env } = await api.fetchEnv(currentCfg.ip, currentCfg.port, context.sessionID)
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

export async function dolphindbChooseServer() {
    let address = vscode.workspace.getConfiguration('dolphindb.server').get('address') as IConfig[]

    let descs = address.map(({
        name,
        ip,
        port
    }) => `${name}: ${ip}:${port}`)

    vscode.window.showQuickPick(descs)
        .then((desc) => {
            currentCfg = address[_.findIndex((desc_) => desc === desc_, descs)]
        })
}

export async function dolphindbRemoveServer() {
    let address = vscode.workspace.getConfiguration('dolphindb.server').get('address') as IConfig[]
    let descs = address.map(({
        name,
        ip,
        port
    }) => `${name}: ${ip}:${port}`)

    vscode.window.showQuickPick(descs)
        .then((desc) => {
            address[_.findIndex((desc_) => desc === desc_, descs)] = null

            address = _.filter(elem => elem !== null, address)
            vscode.workspace.getConfiguration('dolphindb.server').update('address', address)
        })
}

export async function dolphindbAddServer() {
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

    let portNum = Number.parseInt(port)
    if (port !== undefined || isNaN(portNum)) {
        throw TypeError('port must be a number')
    }

    let address = vscode.workspace.getConfiguration('dolphindb.server').get('address') as IConfig[]

    const cfg: IConfig = {
        name: name ? name : defaultCfg.name,
        ip: ip ? ip : defaultCfg.ip,
        port: portNum ? portNum : defaultCfg.port,
    }

    address.push(cfg)
    address = _.uniqWith(_.isEqual, address)
    address = _.filter(
        elem => (elem !== null &&
            typeof elem.name === 'string' &&
            typeof elem.ip === 'string' &&
            !isNaN(elem.port)),
        address)

    vscode.workspace.getConfiguration('dolphindb.server').update('address', address, false)
}
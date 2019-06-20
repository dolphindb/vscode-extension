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

function getConfigDesc({name, ip, port}: IConfig) {
    return `${name}: ${ip}:${port}`
}

function resultFormat(res: string): string {
    return new Date() + ': executing code...\n' +
        (res ? res : '') + '\n' +
        new Date() + ': execution was completed\n'
}

export async function dolphindbExecuteCode() {
    let selected = (vscode.window.activeTextEditor as vscode.TextEditor).selection.with()
    let code = (vscode.window.activeTextEditor as vscode.TextEditor).document.getText(selected)

    let { data } = await api.executeCode(currentCfg.ip, currentCfg.port, code, context.sessionID)
    let { data: env } = await api.fetchEnv(currentCfg.ip, currentCfg.port, context.sessionID)
    let json = new api.DolphindbJson(data)
    // todo: keep the sessionID
    context.sessionID = json.sessionID()
    let text = resultFormat(json.toJsString())
    dolphindbOutput.appendLine(text)
    dolphindbOutput.show()
}

export async function dolphindbChooseServer() {
    let address = vscode.workspace.getConfiguration('dolphindb.server').get('address') as IConfig[]

    let descs = address.map(getConfigDesc)

    vscode.window.showQuickPick(descs)
        .then((desc) => {
            if(desc === undefined) {
                return
            }
            currentCfg = address[_.findIndex((desc_) => desc === desc_, descs)]
            vscode.window.showInformationMessage('Choose the ' + desc)
        })
}

export async function dolphindbRemoveServer() {
    let address = vscode.workspace.getConfiguration('dolphindb.server').get('address') as IConfig[]
    let descs = address.map(getConfigDesc)

    vscode.window.showQuickPick(descs)
        .then((desc) => {
            if(desc === undefined) {
                return
            }

            address[_.findIndex((desc_) => desc === desc_, descs)] = null
            address = _.filter(elem => elem !== null, address)
            vscode.workspace.getConfiguration('dolphindb.server').update('address', address)
            vscode.window.showInformationMessage('Remove the ' + desc)
        })
}

export async function dolphindbAddServer() {
    let name = await vscode.window.showInputBox({
        placeHolder: defaultCfg.name,
        prompt: 'Please input the host name'
    })

    if (name === undefined) {
        return
    }

    let ip = await vscode.window.showInputBox({
        placeHolder: defaultCfg.ip,
        prompt: 'Please input the host ip'
    })

    if (ip === undefined) {
        return
    }

    let port = await vscode.window.showInputBox({
        placeHolder: defaultCfg.port.toString(),
        prompt: 'Please input the host port'
    })

    if (port === undefined) {
        return
    }

    let portNum = Number.parseInt(port)
    if (port !== '' && isNaN(portNum)) {
        vscode.window.showErrorMessage('port must be a number')
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
    vscode.window.showInformationMessage('Add the ' + getConfigDesc(cfg))
}
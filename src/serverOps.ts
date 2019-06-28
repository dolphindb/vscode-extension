// Copyright 2019 yjhmelody
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
//     http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as vscode from 'vscode'
import * as _ from 'lodash/fp'
import * as api from './api'
import { IConfig, context } from './context'
import { VariableInfo } from './env'
import * as path from 'path'


let currentCfg = context.currentCfg

const dolphindbOutput = vscode.window.createOutputChannel('dolphindbOutput')

function getConfigDesc({ name, ip, port }: IConfig) {
    return `${name}: ${ip}:${port}`
}

function resultFormat(res: string, start: Date, end: Date): string {
    return new Date() + ': executing code...\n' +
        (res ? res : '') + '\n' +
        new Date() + ': execution was completed [' + (end.valueOf() - start.valueOf()).toString() + 'ms]\n'
}

export async function dolphindbExecuteCode() {
    let textEditor = vscode.window.activeTextEditor as vscode.TextEditor
    let selected = textEditor.selection.with()
    let currentLine = textEditor.selection.start.line
    let code = textEditor.document.getText(selected)
    if (code.length === 0) {
        code = textEditor.document.getText(
            new vscode.Range(
                new vscode.Position(currentLine, 0),
                new vscode.Position(currentLine+1, 0),
            )
        )
    }
    let start = new Date()
    let { data: data } = await api.executeCode(currentCfg.ip, currentCfg.port, code, context.sessionID)
    let end = new Date()
    let { data: env } = await api.fetchEnv(currentCfg.ip, currentCfg.port, context.sessionID)
    // every time after runing code, update ENV for variable explorer
    context.ENV = VariableInfo.extractEnv(env.object[0])
    let json = new api.DolphindbJson(data)
    context.sessionID = json.sessionID()

    let text = resultFormat(json.toJsString(), start, end)
    dolphindbOutput.appendLine(text)
    dolphindbOutput.show()
}


export async function dolphindbShowInfo(node: vscode.TreeItem) {
    let code = node.label 
    let start = new Date()
    let { data: data } = await api.executeCode(currentCfg.ip, currentCfg.port, code, context.sessionID)
    let end = new Date()
    let { data: env } = await api.fetchEnv(currentCfg.ip, currentCfg.port, context.sessionID)
    // every time after runing code, update ENV for variable explorer
    context.ENV = VariableInfo.extractEnv(env.object[0])
    let json = new api.DolphindbJson(data)
    context.sessionID = json.sessionID()

    let text = resultFormat(json.toJsString(), start, end)
    dolphindbOutput.appendLine(text)
    dolphindbOutput.show()
}

export async function dolphindbTestCurrentFile() {
    let textEditor = vscode.window.activeTextEditor as vscode.TextEditor
    let uri = textEditor.document.uri
    let code = `test("${uri.fsPath}")`
    let start = new Date()
    console.log('code ', code)
    let { data: data } = await api.executeCode(currentCfg.ip, currentCfg.port, code, '0')
    let end = new Date()
    let json = new api.DolphindbJson(data)
    let text = resultFormat(json.toScalar().toString(), start, end)
    console.log('res ', text)
    dolphindbOutput.appendLine(text)
    dolphindbOutput.show()
}

export async function dolphindbTestCurrentDir() {
    let textEditor = vscode.window.activeTextEditor as vscode.TextEditor
    let uri = textEditor.document.uri
    let code = `test("${path.dirname(uri.fsPath)}")`
    console.log('code ', code)
    let start = new Date()
    let { data: data } = await api.executeCode(currentCfg.ip, currentCfg.port, code, '0')
    let end = new Date()
    let json = new api.DolphindbJson(data)
    let text = resultFormat(json.toScalar().toString(), start, end)
    console.log('res ', text)
    dolphindbOutput.appendLine(text)
    dolphindbOutput.show()
}


export async function dolphindbChooseServer() {
    let address = vscode.workspace.getConfiguration('dolphindb.server').get('address') as IConfig[]
    let descs = address.map(getConfigDesc)
    vscode.window.showQuickPick(descs)
        .then((desc) => {
            if (desc === undefined) {
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
            if (desc === undefined) {
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
        placeHolder: context.defaultCfg.name,
        prompt: 'Please input the host name'
    })

    if (name === undefined) {
        return
    }

    let ip = await vscode.window.showInputBox({
        placeHolder: context.defaultCfg.ip,
        prompt: 'Please input the host ip'
    })

    if (ip === undefined) {
        return
    }

    let port = await vscode.window.showInputBox({
        placeHolder: context.defaultCfg.port.toString(),
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
        name: name ? name : context.defaultCfg.name,
        ip: ip ? ip : context.defaultCfg.ip,
        port: portNum ? portNum : context.defaultCfg.port,
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
// Copyright 2019 dolphindb
// author: yjhmelody
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

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'
import * as serverOps from './serverOps'
import * as env from './env'
import {dolphindbHelper} from './helper'
import {context as dolphindbContext, DolphindbContext} from './context'
import { login } from './api';


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    console.log('dolphindb-vscode extension is now active!');
    const dolphindbEnvProvider = new env.DolphindbEnvProvider(dolphindbContext)
    // onView:dolphindb.env
    vscode.window.registerTreeDataProvider('dolphindb.env', dolphindbEnvProvider)
    vscode.commands.registerCommand('dolphindb.env.refresh', () => dolphindbEnvProvider.refresh())
    vscode.commands.registerCommand('dolphindb.env.showInfo', serverOps.dolphindbShowInfo)

    const executeCode = vscode.commands.registerCommand('dolphindb.executeCode', async () => {
        await serverOps.dolphindbExecuteCode()
        await dolphindbEnvProvider.refresh()
    })

    // const testCurrentDir = vscode.commands.registerCommand('dolphindb.testCurrentDir',  serverOps.dolphindbTestCurrentDir)
    // const testCurrentFile = vscode.commands.registerCommand('dolphindb.testCurrentFile',  serverOps.dolphindbTestCurrentFile)
    const addServer = vscode.commands.registerCommand('dolphindb.addServer', serverOps.dolphindbAddServer)
    const chooseServer = vscode.commands.registerCommand('dolphindb.chooseServer', serverOps.dolphindbChooseServer)
    const removeServer = vscode.commands.registerCommand('dolphindb.removeServer', serverOps.dolphindbRemoveServer)
    const helper = vscode.commands.registerCommand('dolphindb.helper', dolphindbHelper)
    const login = vscode.commands.registerCommand('dolphindb.login', serverOps.dolphindbLogin)
    const ssl = vscode.commands.registerCommand('dolphindb.ssl', serverOps.dolphindbSSL)

    context.subscriptions.push(executeCode)
    context.subscriptions.push(addServer)
    context.subscriptions.push(chooseServer)
    context.subscriptions.push(removeServer)
    context.subscriptions.push(helper)
    context.subscriptions.push(login)
    context.subscriptions.push(ssl)
    // context.subscriptions.push(testCurrentDir)
    // context.subscriptions.push(testCurrentFile)
}

// this method is called when your extension is deactivated
export function deactivate() { }

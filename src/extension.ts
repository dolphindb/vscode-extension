import * as vscode from 'vscode'
import * as serverOps from './serverOps'
import * as env from './env'
import { dolphindbHelper } from './helper'
import { context as dolphindbContext } from './context'

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate (context: vscode.ExtensionContext) {
    console.log('dolphindb-vscode extension is now active!')
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
export function deactivate () { }

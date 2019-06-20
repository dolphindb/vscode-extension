// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'
import * as serverOps from './serverOps'


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    const executeCode = vscode.commands.registerCommand('dolphindb.executeCode', serverOps.dolphindbExecuteCode)
    const addServer = vscode.commands.registerCommand('dolphindb.addServer', serverOps.dolphindbAddServer)
    const chooseServer = vscode.commands.registerCommand('dolphindb.chooseServer', serverOps.dolphindbChooseServer)
    const removeServer = vscode.commands.registerCommand('dolphindb.removeServer', serverOps.dolphindbRemoveServer)
    // vscode.window.registerTreeDataProvider('dolphindb-explorer')

    context.subscriptions.push(executeCode)
    context.subscriptions.push(addServer)
    context.subscriptions.push(chooseServer)
    context.subscriptions.push(removeServer)
}

// this method is called when your extension is deactivated
export function deactivate() { }

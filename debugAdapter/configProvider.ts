import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import type { DdbExplorer } from '../index.js';

class DdbDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  private _explorer: DdbExplorer;
  
  constructor(explorer: DdbExplorer) {
    this._explorer = explorer;
  }
  /**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'dolphindb') {
				config.type = 'dolphindb';
				config.name = 'Debug for current file';
				config.program = '${file}';
			}
		}
    
    config.url ??= this._explorer.connection.url;
    config.username ??= this._explorer.connection.username;
    config.password ??= this._explorer.connection.password;

    // TODO: 限制非dos文件被选中作为debugee
		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		return config;
	}
}

export function activateDebug(ctx: vscode.ExtensionContext, explorer: DdbExplorer) {
  ctx.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('dolphindb', new DdbDebugConfigurationProvider(explorer)));
}
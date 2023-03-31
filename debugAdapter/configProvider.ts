import * as vscode from 'vscode';
import {
  WorkspaceFolder,
  DebugConfiguration,
  ProviderResult,
  CancellationToken,
} from 'vscode';
import type { DdbExplorer } from '../index.js';

class DdbDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(
    private _explorer: DdbExplorer
  ) {}
  /**
   * 在debug会话开始前提供一些预配置，主要填充用户缺失信息
   */
  resolveDebugConfiguration(
    folder: WorkspaceFolder | undefined,
    config: DebugConfiguration,
    token?: CancellationToken
  ): ProviderResult<DebugConfiguration> {
    // if launch.json is missing or empty
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'dolphindb') {
        config.type = 'dolphindb';
        config.name = 'Debug for current file';
        config.program = '${file}';
      }
    }

    // 默认使用当前插件连接的server作为debugger
    config.url ??= this._explorer.connection.url;
    config.username ??= this._explorer.connection.username;
    config.password ??= this._explorer.connection.password;
    config.autologin = this._explorer.connection.autologin;

    // 并不能在这里限制非.dos文件被选中作为debugee，此时${file}还未被解析成绝对路径
    if (!config.program) {
      return vscode.window
        .showInformationMessage('Cannot find a program to debug')
        .then((_) => {
          return undefined; // abort launch
        });
    }

    return config;
  }
}

export function activateDebug(
  ctx: vscode.ExtensionContext,
  explorer: DdbExplorer
) {
  ctx.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      'dolphindb',
      new DdbDebugConfigurationProvider(explorer)
    )
  );
}

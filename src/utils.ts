import { DDB, DdbObj, type DdbStringObj } from 'dolphindb'
import {
    window,
    Position,
    Range,
    ConfigurationTarget,
    commands,
    Uri,
    workspace,
    FileType
} from 'vscode'

import { path } from 'xshell'


/** 获取选择区域的文本，若选择为空，则根据 selector 确定 (当前 | 全部文本 | 空) */
export function get_text (selector: 
    'all' | 
    'line' | 
    'word' |
    'selection' | 
    'selection or line' |
    'selection or all'  |
    'selection before' | 
    'selection to text start' | 
    'selection after'
) {
    const editor    = window.activeTextEditor
    const document  = editor.document
    const selection = editor.selection
    
    const text_selection = document.getText(selection)
    
    if (selector === 'selection')
        return text_selection
        
    const text_all = document.getText()
    
    if (selector === 'all')
        return text_all
        
    const text_line = document.lineAt(selection.active.line).text
        
    if (selector === 'line')
        return text_line
    
    if (selector === 'word')
        return document.getText(
            document.getWordRangeAtPosition(selection.active)
        )
    
    if (selector === 'selection or all')
        return text_selection || text_all
    
    if (selector === 'selection or line')
        return text_selection || text_line
        
    
    
    const start = selection.start
    const end   = selection.end
    
    const line = document.lineAt(start.line)
    
    const line_start = new Position(start.line, 0)
    
    if (selector === 'selection before')
        return document.getText(
            new Range(line_start, start)
        )
    
    
    const line_end   = new Position(start.line, line.text.length)
    
    if (selector === 'selection after')
        return document.getText(
            new Range(end, line_end)
        )
    
    
    const line_text_start = new Position(start.line, line.firstNonWhitespaceCharacterIndex)
    if (selector === 'selection to text start')
        return document.getText(
            new Range(line_text_start, start)
        )
}


export function open_workbench_settings_ui (target: ConfigurationTarget, options?: { query?: string }) {
    if (target === ConfigurationTarget.Global) 
        return commands.executeCommand('workbench.action.openSettings', options)
    
    if (target === ConfigurationTarget.Workspace) 
        return commands.executeCommand('workbench.action.openWorkspaceSettings', options)
    
    if (target === ConfigurationTarget.WorkspaceFolder) 
        return commands.executeCommand('workbench.action.openFolderSettings', options)
}


export async function fupload (file_uri: Uri, path: string, ddb: DDB, check_existence = true) { 
    if (check_existence && !(await ddb.call<DdbObj<boolean>>('exists', [path.fdir])).value)
        await ddb.call('mkdir', [path.fdir])
    
    let text: string
    if (file_uri.scheme === 'untitled')
        text = get_text('all')
    else {
        await workspace.textDocuments.find(doc => doc.fileName === file_uri.fsPath)?.save()
        text = new TextDecoder('utf-8').decode(
            await workspace.fs.readFile(file_uri)
        )
    }
    
    // Usage: saveTextFile(content, filename,[append=false],[lastModified]). 
    // content must be a string or string vector which stores the text to save.
    await ddb.call('saveTextFile', [text, path])
}


export async function fdupload (uri: Uri, fpd_remote: string, ddb: DDB, check_existence = true) { 
    if (check_existence && !(await ddb.call<DdbObj<boolean>>('exists', [fpd_remote])).value)
        await ddb.call('mkdir', [fpd_remote])
    
    for (const [name, file_type] of await workspace.fs.readDirectory(uri)) { 
        const upload_path = path.join(fpd_remote, name)
        const file_uri = Uri.file(uri.fsPath.fp + '/' + name)
        
        if (file_type === FileType.File)
            await fupload(file_uri, upload_path, ddb, false)
        else  
            await fdupload(file_uri, upload_path + '/', ddb)
    }
}


/** 模块文件上传 */
export async function fmupload (uri: Uri, encrypt: boolean, ddb: DDB, fps: string[]) {
    await workspace.textDocuments.find(doc => doc.fileName === uri.fsPath)?.save()
    const text = new TextDecoder('utf-8').decode(
        await workspace.fs.readFile(Uri.file(uri.fsPath))
    )
    
    // 第二个参数表示如果已存在对应文件，是否要覆盖。如果是 false 且目录下已存在对应文件，会报错，true 直接覆盖旧的文件
    // 第三个参数表示是否加密。false 不加密，生成 dos 文件；true 加密，生成 dom 文件
    // 返回值为上传结果对象
    const { value } = await ddb.call<DdbStringObj>('uploadModule', [text, true, encrypt])
    
    fps.push(path.normalize(value.fp))
}


/** 模块文件夹上传 */
export async function fdmupload (uri: Uri, encrypt: boolean, ddb: DDB, fps: string[]) {
    for (const [name, file_type] of await workspace.fs.readDirectory(uri)) { 
        const file_uri = Uri.file(uri.fsPath.fp + '/' + name)
        
        if (file_type === FileType.File)
            await fmupload(file_uri, encrypt, ddb, fps)
        else  
            await fdmupload(file_uri, encrypt, ddb, fps)
    }
}

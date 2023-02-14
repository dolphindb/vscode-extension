import {
    window,
    Position,
    Range,
    ConfigurationTarget,
    commands
} from 'vscode'

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
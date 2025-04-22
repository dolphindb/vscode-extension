import { workspace, ConfigurationTarget } from 'vscode'


export async function register_settings () {
    // --- 自动添加 decorator textmate rules 以支持 @jit @state 等高亮
    const config = workspace.getConfiguration('editor')
    
    // 获取当前的 tokenColorCustomizations
    let token_color_customizations = config.get<TokenColorCustomizations>('tokenColorCustomizations') || { }
    let textmate_rules = token_color_customizations.textMateRules || [ ]
    
    // 不存在该规则则自动添加
    if (!textmate_rules.some(rule => rule.scope === 'meta.decorator.dolphindb')) {
        textmate_rules.push(
            {
                scope: 'meta.decorator.dolphindb',
                settings: { foreground: '#aa6f00' }
            },
            {
                scope: 'entity.name.function.dolphindb',
                settings: { fontStyle: 'bold' },
            },
            {
                scope: 'support.function.dolphindb',
                settings: { fontStyle: 'bold' },
            },
        )
        
        token_color_customizations.textMateRules = textmate_rules
        
        try {
            await config.update('tokenColorCustomizations', token_color_customizations, ConfigurationTarget.Global)
        } catch (error) {
            console.log('textmate rules 更新失败', error)
        }
    }
}


type TokenColorCustomizations = {
    textMateRules?: TextMateRule[]
}


type TextMateRule = {
    scope: string | string[]
    settings: {
        foreground?: string
        background?: string
        fontStyle?: string
    }
}


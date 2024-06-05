import {
    type ExtensionContext,
    languages,
    CompletionItemKind,
    type CompletionItem,
    MarkdownString,
    Range,
} from 'vscode'

import { DocsAnalyser, parse_signature_help_from_text } from 'dolphindb/docs.js'

import { fread_json } from 'xshell'

import { language, t } from '../i18n/index.js'

import { fpd_ext } from './index.js'


const MAX_MATCH_LINES = 30

let docs_analyser: DocsAnalyser


export async function load_docs () {
    const fname = `docs.${ language === 'zh' ? 'zh' : 'en' }.json`
    docs_analyser = new DocsAnalyser(await fread_json(`${fpd_ext}${fname}`))
    console.log(t('函数文档 {{fname}} 已加载', { fname }))
}


export function register_docs (ctx: ExtensionContext) {
    function wrap_markdown_string (md: string) {
        return new MarkdownString(md)
    }
    
    const ddb_languages = ['dolphindb', 'dolphindb-python']
    
    ctx.subscriptions.push(
        // 函数补全
        languages.registerCompletionItemProvider(ddb_languages, {
            provideCompletionItems (doc, pos) {
                const keyword = doc.getText(doc.getWordRangeAtPosition(pos))
                
                const { functions, constants, keywords } = docs_analyser.search_completion_items(keyword)
                
                return [
                    ...keywords.map(kw => ({
                        label: kw,
                        insertText: kw,
                        kind: CompletionItemKind.Keyword,
                    })),
                    ...constants.map(constant => ({
                        label: constant,
                        insertText: constant,
                        kind: CompletionItemKind.Constant,
                    })),
                    ...functions.map(fn => ({
                        label: fn,
                        insertText: fn,
                        kind: CompletionItemKind.Function,
                    })),
                ] satisfies CompletionItem[]
            },
            resolveCompletionItem (item, _canceller) {
                const md = docs_analyser.get_function_markdown(item.label as string)
            
                if (md)
                    item.documentation = wrap_markdown_string(md)
                
                return item
            },
        }),
        // 悬浮提示
        languages.registerHoverProvider(ddb_languages, {
            provideHover (doc, pos, _canceller) {
                const word = doc.getText(doc.getWordRangeAtPosition(pos))
                
                if (!word)
                    return
                
                const md = docs_analyser.get_function_markdown(word)
                
                if (!md)
                    return
                return {
                    contents: [wrap_markdown_string(md)],
                }
            },
        }),
        // 函数签名
        languages.registerSignatureHelpProvider(
            ddb_languages,
            {
                provideSignatureHelp (doc, position, _canceller) {
                    const text = doc.getText(
                        new Range(Math.max(position.line - MAX_MATCH_LINES, 0), 0, position.line, position.character)
                    )
                    
                    const result = parse_signature_help_from_text(text, docs_analyser)
                    
                    if (!result)
                        return
                    
                    const { active_parameter, documentation_md, signature } = result
                    
                    return {
                        activeSignature: 0,
                        activeParameter: -1,
                        signatures: [
                            {
                                label: signature.full,
                                activeParameter: active_parameter,
                                documentation: documentation_md ? wrap_markdown_string(documentation_md) : undefined,
                                parameters: signature.parameters.map(param => ({
                                    label: param.full,
                                })),
                            },
                        ],
                    }
                },
            },
            {
                triggerCharacters: ['(', ','],
                retriggerCharacters: [','],
            }
        )
    )
}


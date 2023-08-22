// ------------ 函数补全、文档
// 参考: ddb/web/console/shell/Editor/docs.ts

import {
    languages,
    
    MarkdownString,
    
    type TextDocument,
    Range,
    type Position,
    
    type ExtensionContext,
    
    Hover,
    
    SignatureInformation, SignatureHelp, ParameterInformation,
    
    CompletionItem, CompletionItemKind,
} from 'vscode'

import { fread_json } from 'xshell'

import { constants, keywords } from 'dolphindb/language.js'

import { language, t } from './i18n/index.js'
import { dev, fpd_node_modules, fpd_ext } from './index.js'


const constants_lower = constants.map(constant => constant.toLowerCase())

let docs = { }

let funcs: string[] = [ ]
let funcs_lower: string[] = [ ]


/** 最大搜索行数 */
const max_lines_to_match = 30 as const

// 栈 token 匹配表
const token_map = {
    ')': '(',
    '}': '{',
    ']': '['
} as const

const token_ends = new Set(
    Object.values(token_map)
)


interface RstDocument {
    title: string
    type: DocumentType
    children: Paragraph[]
}

interface Paragraph {
    type: ParagraphType
    title: string
    children: ContextBlock[]
}

interface ContextBlock {
    type: 'text' | 'code'
    language?: string
    value: string[]
}

type DocumentType = 'command' | 'function' | 'template'

type ParagraphType = 'grammer' | 'parameters' | 'detail' | 'example'


const func_fps = {
    command: 'FunctionsandCommands/CommandsReferences/',
    function: 'FunctionsandCommands/FunctionReferences/',
    template: 'Functionalprogramming/TemplateFunctions/'
} as const


function get_func_md (keyword: string) {
    const func_doc: RstDocument = docs[keyword] || docs[keyword + '!']
    
    if (!func_doc)
        return
    
    const { title, type } = func_doc
    
    let md = new MarkdownString(
        // 标题
        `#### ${title}\n` +
        
        // 链接
        'https://' + 
        (language === 'zh' ? 'docs.dolphindb.cn/zh/' : 'dolphindb.com/') +
        'help/' +
        func_fps[type] +
        (type !== 'template' ? `${title[0]}/` : '') +
        title + '.html\n'
    )
    
    md.isTrusted = true
    
    for (const para of func_doc.children) {
        // 加入段
        md.appendMarkdown(`#### ${para.title}\n`)
        
        for (const x of para.children)
            if (x.type === 'text' && para.type !== 'example') 
                // 对于参数段落，以 markdown 插入
                md.appendMarkdown(
                    x.value.join_lines()
                )
            else
                // x.type === 'code' || para.type === 'example'
                md.appendCodeblock(
                    x.value.join_lines(),
                    (x.language === 'console' ? 'dolphindb' : x.language)
                )
        
        md.appendMarkdown('\n')
    }
    
    return md
}


/** 利用当前光标找出函数参数开始位置及函数名, 若找不到返回 -1 */
function find_func_start (
    document: TextDocument,
    position: Position
): {
    func_name: string
    param_search_pos: number
} {
    const func_name_regex = /[a-z|A-Z|0-9|\!|_]/
    
    const text = document.getText(
        new Range(
            Math.max(position.line - max_lines_to_match, 0), 0,
            position.line, position.character
        )
    )
    
    let stack_depth = 0
    let param_search_pos = -1
    for (let i = text.length;  i >= 0;  i--) {
        let char = text[i]
        // 遇到右括号，入栈，增加一层括号语境深度
        if (char === ')') {
            stack_depth++
            continue
        }
        // 遇到左括号，出栈，退出一层括号语境深度
        else if (char === '(') {
            stack_depth--
            continue
        }
        
        // 栈深度小于0，且遇到合法函数名字符，跳出括号语境，搜索结束：参数搜索开始位置
        if (func_name_regex.test(char) && stack_depth < 0) {
            param_search_pos = i
            break
        }
    }
    
    // 找不到参数搜索开始位置，返回null
    if (param_search_pos === -1) 
        return { param_search_pos: -1, func_name: '' }
    
    
    // 往前找函数名
    let func_name_end = -1
    let func_name_start = 0
    for (let i = param_search_pos;  i >= 0;  i--) {
        let char = text[i]
        
        // 空字符跳过
        if (func_name_end === -1 && char === ' ') 
            continue
        
        // 合法函数名字字符，继续往前找
        if (func_name_regex.test(char)) {
            // 标记函数名字末尾位置
            if (func_name_end === -1) 
                func_name_end = i
            
            continue
        }
        
        // 不合法函数名字符，标记函数名字开头位置
        func_name_start = i + 1
        break
    }
    
    // 找不到函数名
    if (func_name_end === -1) 
        return { param_search_pos: -1, func_name: '' }
    
    return {
        param_search_pos: param_search_pos + 1,
        func_name: text.slice(func_name_start, func_name_end + 1)
    }
}


/** 根据函数参数开始位置分析参数语义，提取出当前参数索引 */
function find_active_param_index (
    document: TextDocument,
    position: Position,
    start: number
) {
    const text = document.getText(
        new Range(
            Math.max(position.line - max_lines_to_match, 0), 0, 
            position.line, position.character
        )
    )
    
    let index = 0
    let stack = [ ]
    
    // 分隔符，此处为逗号
    const seperator = ','
    
    let ncommas = 0
    
    // 搜索
    for (let i = start;  i < text.length;  i++) {
        const char = text[i]
        
        // 空字符跳过
        if (/\s/.test(char)) 
            continue
        
        // 字符串内除引号全部忽略
        if (stack[stack.length - 1] === '"' || stack[stack.length - 1] === "'") {
            // 遇到相同引号，出栈
            if ((stack[stack.length - 1] === '"' && char === '"') || (stack[stack.length - 1] === "'" && char === "'")) 
                stack.pop()
            continue
        }
        
        // 开括号入栈
        if (token_ends.has(char as any) || char === '"' || char === "'") {
            stack.push(char)
            continue
        } else if (char in token_map)  // 括号匹配，出栈，括号不匹配，返回null
            if (stack[stack.length - 1] === token_map[char]) {
                stack.pop()
                continue
            } else // 括号不匹配，返回-1
                return -1
        
        // 栈深度为1 且为左小括号：当前语境
        if (stack.length === 1 && stack[0] === '(') 
            // 遇到逗号，若之前有合法参数，计入逗号
            if (char === seperator)
                ncommas++
        
        // 根据逗号数量判断高亮参数索引值
        index = ncommas
    }
    
    const expr = /^[a-zA-Z0-9_]$/
    // 判断当前函数前面的一个字符是否为 . ，如果是，则索引加一
    for (let j = start - 1;  text[j] !== '\n' && j > 0;  j--) 
        if (!expr.test(text[j])) {
            if (text[j] === '.' && expr.test(text[j - 1]))
                index++
            break
        }
        
    return index
}


/** 根据函数名提取出相应的文件对象，提取出函数 signature 和参数 */
function get_signature_and_params (func_name: string): {
    signature: string
    params: string[]
} | null {
    const para = docs[func_name]?.children.filter(para => para.type === 'grammer')[0]
    if (!para) 
        return null
    
    // 找出语法内容块的第一个非空行
    const funcLine = para.children[0].value.filter(line => line.trim() !== '')[0].trim()
    const matched = funcLine.match(/[a-zA-z0-9\!]+\((.*)\)/)
    if (!matched) 
        return null
    
    const signature = matched[0]
    const params = matched[1].split(',').map(s => s.trim())
    return { signature, params }
}


export async function load_docs () {
    const fname = `docs.${ language === 'zh' ? 'zh' : 'en' }.json`
    
    docs = await fread_json(dev ? `${fpd_node_modules}dolphindb/${fname}` : `${fpd_ext}${fname}`)
    
    funcs = Object.keys(docs)
    funcs_lower = funcs.map(func => 
        func.toLowerCase())
    
    console.log(t('函数文档 {{fname}} 已加载', { fname }))
}


export function register_docs (ctx: ExtensionContext) {
    // 函数补全
    ctx.subscriptions.push(
        languages.registerCompletionItemProvider(['dolphindb', 'dolphindb-python'], {
            provideCompletionItems (doc, pos, canceller, ctx) {
                const keyword = doc.getText(doc.getWordRangeAtPosition(pos))
                
                let fns: string[]
                let _constants: string[]
                
                if (keyword.length === 1) {
                    const c = keyword[0].toLowerCase()
                    fns = funcs.filter((func, i) =>
                        funcs_lower[i].startsWith(c)
                    )
                    _constants = constants.filter((constant, i) =>
                        constants_lower[i].startsWith(c)
                    )
                } else {
                    const keyword_lower = keyword.toLowerCase()
                    
                    fns = funcs.filter((func, i) => {
                        const func_lower = funcs_lower[i]
                        let j = 0
                        for (const c of keyword_lower) {
                            j = func_lower.indexOf(c, j) + 1
                            if (!j)  // 找不到则 j === 0
                                return false
                        }
                        
                        return true
                    })
                    
                    _constants = constants.filter((constant, i) => {
                        const constant_lower = constants_lower[i]
                        let j = 0
                        for (const c of keyword_lower) {
                            j = constant_lower.indexOf(c, j) + 1
                            if (!j)  // 找不到则 j === 0
                                return false
                        }
                        
                        return true
                    })
                }
                
                const completions = [
                    ...keywords.filter(kw => kw.startsWith(keyword))
                        .map(kw => ({ label: kw, kind: CompletionItemKind.Keyword })),
                    
                    ... _constants.map(constant => ({ label: constant, kind: CompletionItemKind.Constant })),
                    
                    ...fns.map(fn => ({ label: fn, kind: CompletionItemKind.Function }) as CompletionItem),
                ]
                
                return completions.length ? completions : null
            },
            
            resolveCompletionItem (item, canceller) {
                item.documentation = get_func_md(item.label as string)
                return item
            }
        })
    )
    
    
    // 悬浮提示
    ctx.subscriptions.push(
        languages.registerHoverProvider(['dolphindb', 'dolphindb-python'], {
            provideHover (doc, pos, canceller) {
                const md = get_func_md(doc.getText(doc.getWordRangeAtPosition(pos)))
                if (!md)
                    return
                return new Hover(md)
            }
        })
    )
    
    
    // 函数签名
    ctx.subscriptions.push(
        languages.registerSignatureHelpProvider(['dolphindb', 'dolphindb-python'], {
            provideSignatureHelp (doc, pos, canceller, ctx) {
                const { func_name, param_search_pos } = find_func_start(doc, pos)
                if (param_search_pos === -1) 
                    return
                
                const index = find_active_param_index(doc, pos, param_search_pos)
                if (index === -1) 
                    return
                
                const signature_and_params = get_signature_and_params(func_name)
                if (!signature_and_params)
                    return
                
                const { signature, params } = signature_and_params
                let sig = new SignatureInformation(signature, get_func_md(func_name))
                
                for (let param of params)
                    sig.parameters.push(new ParameterInformation(param))
                
                let help = new SignatureHelp()
                help.signatures.push(sig)
                help.activeParameter = index > params.length - 1 ? params.length - 1 : index
                
                return help
            }
        }, '(', ',')
    )
}

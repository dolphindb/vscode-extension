import { deepEqual, deepStrictEqual } from 'node:assert/strict'

import { commands, window } from 'vscode'

import { check, delay, request } from 'xshell'

import { dev, fpd_ext } from '@/index.ts'
import { connector } from '@/connector.ts'
import { execute_with_progress } from '@/commands.ts'


export async function test () {
    console.log('--- 测试开始 ---'.green)
    
    for (const t of
        repl ? 
            [test_repl]
        : [
            test_execute
        ]
    )
        await t()
    
    console.log('--- 测试通过 ---'.green)
    
    window.showInformationMessage('测试通过', { modal: true })
    
    try {
        await request('http://localhost/api/test-dolphindb-extension')
    } catch { }
    
    // 看一眼测试结果
    await delay(3000)
    
    await commands.executeCommand('workbench.action.closeWindow')
}


// --- 用于临时调试验证
const repl = false
async function test_repl () {
    
}


async function test_execute () {
    await execute_with_progress('defs()', 0)
}

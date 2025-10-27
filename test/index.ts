import { deepEqual, deepStrictEqual } from 'node:assert/strict'
import os from 'node:os'

import { commands, Uri, window } from 'vscode'

import { check, delay, fdclear, fread_lines, noprint, ramdisk, request } from 'xshell'

import { dev, fpd_ext } from '@/index.ts'
import { execute_with_progress, export_table } from '@/commands.ts'


let fpd_temp: string


export async function test () {
    console.log('--- 测试开始 ---'.green)
    
    await fdclear(
        fpd_temp = ramdisk ? 'T:/2/ddb/ext/temp/' : `${os.tmpdir().fpd}test-dolphindb-extension/`)
    
    for (const t of
        repl ? 
            [test_repl]
        : [
            test_execute,
            test_export_csv
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


async function test_export_csv () {
    const fp = `${fpd_temp}export.csv`
    
    await export_table(Uri.file(fp))
    
    const lines = await fread_lines(fp, noprint)
    
    check(lines[0] === 'name,isCommand,userDefined,minParamCount,maxParamCount,syntax')
    check(lines.includes('getClusterPerf,0,0,0,1,([includeMaster=false])'))
}

import os from 'os'

import { call, fexists, get_command, noprint, ramdisk, Remote } from 'xshell'
import { setup_vscode_settings, process_stdin } from 'xshell/development.js'

import { builder, fpd_out, fpd_root } from './builder.ts'


await setup_vscode_settings(fpd_root)

await builder.build(false)


async function stop () {
    await builder.close()
    remote?.disconnect()
}


async function recompile () {
    await builder.run()
    console.log('vscode 需要手动重新加载窗口，ctrl + shift + p 选 reload window')
}


process_stdin(
    async (key) => {
        switch (key) {
            case 'r':
                try {
                    await recompile()
                } catch (error) {
                    console.log('重新编译失败，请尝试按 x 退出后再启动:')
                    console.log(error)
                }
                
                break
                
            case 'x':
                await stop()
                process.exit()
                
            case 'i':
                console.log(info)
                break
        }
    },
    stop
)


let remote: Remote

if (ramdisk) {
    remote = new Remote({
        url: 'ws://localhost',
        
        keeper: {
            func: 'register',
            args: ['ddb.ext'],
        },
        
        funcs: {
            async recompile () {
                await recompile()
                return [ ]
            },
            
            async exit () {
                await stop()
                process.exit()
            }
        }
    })
    
    await remote.connect()
}


const args = [
    '--extensionDevelopmentPath', fpd_out,
    `${fpd_root}workspace/`
]


const info = 
    '可以使用下面的命令手动启动调试\n' +
    get_command('code.exe', args).blue + '\n'


console.log(
    '\n' +
    'extension 开发服务器启动成功\n'.green +
    '尝试自动启动 vscode 调试插件，也' + info +
    '终端快捷键:\n' +
    'r: 重新编译，编译之后 vscode 需要手动重新加载窗口，ctrl + shift + p 选 reload window\n' +
    'i: 打印调试命令\n' +
    'x: 退出开发服务器\n'
)


// --- 尝试启动 vscode / cursor
for (const fp of [
    `C:/Users/${os.userInfo().username}/AppData/Local/Programs/cursor/Cursor.exe`,
    'C:/Program Files/Microsoft VS Code/Code.exe' as const,
    `C:/Users/${os.userInfo().username}/AppData/Local/Programs/Microsoft VS Code/Code.exe`,
]) {
    if (fexists(fp, noprint)) {
        try {
            // 使用 launch 也无法控制 vscode 的子进程，算了
            await call(fp, args, {
                cwd: fpd_root,
                stdio: 'ignore',
                print: {
                    command: true,
                    stdout: false,
                    stderr: false,
                    code: false
                }
            })
            console.log('启动 vscode 成功'.green)
        } catch (error) {
            console.log('启动 vscode 失败，请手动启动:', error)
        }
        
        break
    }
}

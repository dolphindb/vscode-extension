import os from 'os'

import { fexists, noprint, ramdisk, Remote, start } from 'xshell'
import { process_stdin } from 'xshell/stdin.js'

import { builder, fpd_out, fpd_root } from './builder.ts'

await builder.build(false)


async function stop () {
    await builder.close()
    remote?.disconnect()
}


process_stdin(
    async (key) => {
        switch (key) {
            case 'r':
                builder.run()
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
                await builder.run()
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
    '可以使用下面的命令调试:\n' +
    `code.exe ${args.map(arg => arg.quote_if_space()).join(' ')}\n`.blue


console.log(
    '\n' +
    'extension 开发服务器启动成功\n'.green +
    info +
    '终端快捷键:\n' +
    'r: 重新编译\n' +
    'i: 打印调试命令\n' +
    'x: 退出开发服务器\n'
)


if (!ramdisk) {
    const fp_machine = 'C:/Program Files/Microsoft VS Code/Code.exe' as const
    const fp_user = `C:/Users/${os.userInfo().username}/AppData/Local/Programs/Microsoft VS Code/Code.exe`
    
    const fp_vscode = fexists(fp_user, noprint)
        ? fp_user
        : fexists(fp_machine, noprint)
            ? fp_machine
            : ''
    
    if (fp_vscode)
        // todo: 后面改成 launch
        start(fp_vscode, args, { cwd: fpd_root })
}


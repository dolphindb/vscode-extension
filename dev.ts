import { ramdisk, Remote } from 'xshell'
import { builder, fpd_root } from './builder.ts'

await builder.build(false)


let remote: Remote


// 监听终端快捷键
// https://stackoverflow.com/a/12506613/7609214

let { stdin } = process

stdin.setRawMode(true)

stdin.resume()

stdin.setEncoding('utf-8')

// on any data into stdin
stdin.on('data', function (key: any) {
    // ctrl-c ( end of text )
    if (key === '\u0003')
        process.exit()
    
    // write the key to stdout all normal like
    console.log(key)
    
    switch (key) {
        case 'r':
            builder.run()
            break
            
        case 'x':
            remote?.disconnect()
            process.exit()
            
        case 'i':
            console.log(info)
            break
    }
})


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
                await builder.close()
                remote.disconnect()
                process.exit()
            }
        }
    })
    
    await remote.connect()
}


const info = 
    '可以使用下面的命令调试:\n' +
    `code.exe --extensionDevelopmentPath=${fpd_root}out/ ${fpd_root}workspace/\n`


console.log(
    '\n' +
    'extension 开发服务器启动成功\n'.green +
    info +
    '终端快捷键:\n' +
    'r: 重新编译\n' +
    'i: 打印调试命令\n' +
    'x: 退出开发服务器\n'
)


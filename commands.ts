// 用法: node.exe commands.ts dev 或 build 或 test

import os from 'os'

import {
    call, fexists, get_command, noprint, Remote, fdelete, fmkdir, fwrite, 
    ramdisk, set_inspect_options, platform
} from 'xshell'
import { Git } from 'xshell/git.js'
import { Bundler, type BundlerOptions } from 'xshell/builder.js'
import type { Item } from 'xshell/i18n/index.js'
import { setup_vscode_settings, process_stdin } from 'xshell/development.js'

import { tm_language, tm_language_python } from 'dolphindb/language.js'

import package_json from './package.json' with { type: 'json' }


set_inspect_options()

const fpd_root = import.meta.dirname.fpd

const fpd_out = `${fpd_root}out/`

const fpd_out_dataview = `${fpd_out}dataview/`

const vscode_args = [
    '--extensionDevelopmentPath', fpd_out,
    `${fpd_root}workspace/`
]


async function main () {
    switch (process.argv[2]) {
        case 'build':
            await builder.build_and_close(true)
            
            break
        
        case 'dev':
            await dev()
            
            break
        
        case 'test':
            if (process.argv[3] === 'build')
                await builder.build_and_close(false)
            
            console.log(
                '开始测试插件:\n' +
                get_command('code.exe', vscode_args).blue + '\n')
            
            await start_or_reload_vscode(true)
            
            break
    }
}


async function dev () {
    await setup_vscode_settings(fpd_root)
    
    await builder.build(false)
    
    
    async function stop () {
        await builder.close()
        remote?.disconnect()
    }
    
    
    async function recompile () {
        await builder.run()
        await start_or_reload_vscode(false)
    }
    
    
    process_stdin(
        async key => {
            switch (key) {
                case 'r':
                    try {
                        await recompile()
                    } catch (error) {
                        console.log(error)
                        console.log('重新编译失败，请尝试按 x 退出后再启动')
                    }
                    
                    break
                    
                case 'x':
                    await stop()
                    process.exit()
            }
        },
        stop
    )
    
    
    let remote: Remote
    
    if (ramdisk) {
        remote = new Remote({
            url: 'ws://localhost',
            
            args: ['ddb.ext'],
            
            funcs: {
                async recompile () {
                    await recompile()
                },
                
                async exit () {
                    await stop()
                    process.exit()
                }
            }
        })
        
        await remote.connect()
    }
    
    
    console.log(
        '\n' +
        'extension 开发服务器启动成功\n'.green +
        get_command('code.exe', vscode_args).blue + '\n' +
        '终端快捷键:\n' +
        'r: 重新编译，编译后会自动重新加载窗口，手动重新加载可用 ctrl + shift + p 选 reload window\n' +
        'x: 退出开发服务器\n'
    )
    
    await start_or_reload_vscode(false)
}


let fp_vscode: string

async function start_or_reload_vscode (test: boolean) {
    if (platform !== 'win32') {
        console.log('非 windows 系统请根据上面的命令手动打开 vscode')
        return
    }
    
    fp_vscode ??=
        [
            'C:/Program Files/Microsoft VS Code/Code.exe' as const,
            `C:/Users/${os.userInfo().username}/AppData/Local/Programs/Microsoft VS Code/Code.exe`,
        ].find(fp => fexists(fp, noprint)) || 
        (
            (await call('where', ['code.cmd']))
                .stdout.trim().fdir.fdir + 'Code.exe'
        )
    
    if (test)
        await fwrite(`${fpd_out}test-dolphindb-extension`, '', noprint)
    
    // 使用 launch 也无法控制 vscode 的子进程，算了
    // 如果已有启动的进程，会自动 reload
    await call(fp_vscode, vscode_args, {
        cwd: fpd_root,
        stdout: false,
        window: true,
        print: {
            command: true,
            code: false
        }
    })
}


let builder = {
    dataview: null as Bundler,
    
    cjs: null as Bundler,
    
    
    async build (production: boolean) {
        console.log('项目根目录:', fpd_root)
        
        console.log(`开始构建${production ? '生产' : '开发'}模式的插件`)
        
        await fdelete(fpd_out)
        
        await fmkdir(fpd_out_dataview)
        
        let git = new Git(fpd_root)
        
        let info = await git.get_version_info()
        
        const resolve_alias: BundlerOptions['resolve_alias'] = {
            '@i18n': `${fpd_root}i18n/index.ts`,
            '@test': `${fpd_root}test`,
            '@': `${fpd_root}src`
        }
        
        await Promise.all([
            this.build_package_json(),
            
            // build tm language
            fwrite(`${fpd_out}dolphindb.tmLanguage.json`, tm_language),
            fwrite(`${fpd_out}dolphindb-python.tmLanguage.json`, tm_language_python),
            
            (this.dataview = new Bundler(
                'dataview',
                'web',
                fpd_root,
                fpd_out_dataview,
                undefined,
                {
                    'index.js': './src/dataview/index.tsx',
                    'window.js': './src/dataview/window.tsx',
                    'webview.js': './src/dataview/webview.tsx',
                },
                {
                    resolve_alias,
                    external_dayjs: true,
                    production,
                    license: production,
                    dependencies,
                    htmls: {
                        'index.html': {
                            title: 'DolphinDB',
                            icon: {
                                src: 'src/dataview/logo.png',
                                out: 'logo.png'
                            },
                            dependencies
                        },
                        
                        'window.html': {
                            title: 'DdbObj',
                            icon: {
                                src: 'src/dataview/logo.png',
                                out: 'logo.png'
                            },
                            entry: 'window.js',
                            dependencies
                        }
                    },
                    
                    resolve_fallback: {
                        process: false
                    }
                }
            )).build_all(),
            
            
            (this.cjs = new Bundler(
                'extension',
                'nodejs',
                fpd_root,
                fpd_out,
                undefined,
                {
                    'index.cjs': './src/index.ts',
                    'debugger.cjs': './src/debugger/index.ts',
                    'languageserver.cjs': './src/languageserver/index.ts',
                },
                {
                    production,
                    license: production,
                    commonjs2: true,
                    single_chunk: false,
                    globals: {
                        FPD_ROOT: fpd_root.quote(),
                        EXTENSION_VERSION: `${info.version} (${info.time} ${info.hash})`.quote(),
                    },
                    resolve_alias,
                    assets: {
                        productions: [
                            'README.md', 'README.zh.md', 'icons/', 'LICENSE.txt',
                            
                            ... ['zh', 'en'].map(language => 
                                ({ src: `node_modules/dolphindb/docs.${language}.json`, out: `docs.${language}.json` })),
                                
                            'dolphindb.language-configuration.json',
                            'dolphindb-python.language-configuration.json'
                        ],
                    },
                    externals: {
                        vscode: 'commonjs2 vscode'
                    },
                    polyfill_node_sea: true
                }
            )).build_all()
        ])
    },
    
    
    async run () {
        await Promise.all([
            this.dataview.build(),
            this.cjs.build()
        ])
    },
    
    
    async close () {
        await Promise.all([
            this.dataview.close(),
            this.cjs.close()
        ])
    },
    
    
    async build_package_json () {
        const { name, type, version, engines, scripts, dependencies, devDependencies } = package_json
        
        let dict: {
            zh: Record<string, string>
            en: Record<string, string>
        } = {
            zh: { },
            en: { }
        }
        
        
        function make (id: string, zh: string, en: string) {
            let { zh: _zh, en: _en } = dict
            _zh[id] = zh
            _en[id] = en
            return id.surround('%')
        }
        
        
        const ext_commands = [
            {
                command: 'execute',
                key: 'ctrl+e',
                when: "editorTextFocus && editorLangId == 'dolphindb' || editorTextFocus && editorLangId == 'dolphindb-python'",
                title: {
                    zh: 'DolphinDB: 执行代码',
                    en: 'DolphinDB: Execute Code'
                },
            },
            {
                command: 'execute_selection_or_line',
                when: "editorTextFocus && editorLangId == 'dolphindb' || editorTextFocus && editorLangId == 'dolphindb-python'",
                title: {
                    zh: '执行选中或当前行',
                    en: 'Execute Selection or Line'
                },
                icon: '$(play)'
            },
            {
                command: 'execute_file',
                when: "editorLangId == 'dolphindb' || editorLangId == 'dolphindb-python'",
                title: {
                    zh: '执行整个文件',
                    en: 'Execute File'
                },
                icon: '$(play)'
            },
            {
                command: 'cancel',
                title: {
                    zh: 'DolphinDB: 取消作业',
                    en: 'DolphinDB: Cancel Job'
                },
            },
            {
                command: 'connect',
                title: {
                    zh: '连接',
                    en: 'Connect'
                }
            },
            {
                command: 'disconnect',
                title: {
                    zh: '断开连接',
                    en: 'Disconnect'
                },
                icon: './icons/disconnect.svg',
            },
            {
                command: 'reconnect',
                title: {
                    zh: '重新连接',
                    en: 'Reconnect'
                },
            },
            {
                command: 'open_settings',
                title: {
                    zh: 'DolphinDB: 打开设置',
                    en: 'DolphinDB: Open Settings'
                },
                icon: '$(gear)'
            },
            {
                command: 'open_connection_settings',
                title: {
                    zh: 'DolphinDB: 打开连接设置',
                    en: 'DolphinDB: Open Connection Settings'
                },
                icon: '$(gear)'
            },
            {
                command: 'inspect_variable',
                title: {
                    zh: 'DolphinDB: 查看变量',
                    en: 'DolphinDB: Inspect Variable'
                },
                icon: '$(browser)',
            },
            {
                command: 'inspect_table',
                title: {
                    zh: 'DolphinDB: 查看表格',
                    en: 'DolphinDB: Inspect Table'
                },
                icon: '$(browser)',
            },
            {
                command: 'inspect_table_schema',
                title: {
                    zh: 'DolphinDB: 查看表结构',
                    en: 'DolphinDB: Inspect Table Schema'
                },
                icon: '$(outline-view-icon)',
            },
            {
                command: 'inspect_database_schema',
                title: {
                    zh: 'DolphinDB: 查看数据库结构',
                    en: 'DolphinDB: Inspect Database Schema'
                },
                icon: '$(outline-view-icon)',
            },
            {
                command: 'open_variable',
                title: {
                    zh: 'DolphinDB: 在新窗口中查看变量',
                    en: 'DolphinDB: Inspect Variable in New Window'
                },
                icon: '$(multiple-windows)',
            },
            {
                command: 'reload_databases',
                title: {
                    zh: 'DolphinDB: 重新加载数据库',
                    en: 'DolphinDB: Reload Database'
                },
                icon: '$(refresh)',
            },
            {
                command: 'reload_variables',
                title: {
                    zh: 'DolphinDB: 重新加载变量',
                    en: 'DolphinDB: Reload Variables'
                },
                icon: '$(refresh)',
            },
            {
                command: 'reload_dataview',
                title: {
                    zh: 'DolphinDB: 重新加载数据视图',
                    en: 'DolphinDB: Reload DataView'
                },
                icon: '$(refresh)',
            },
            {
                command: 'upload_file',
                title: {
                    zh: 'DolphinDB: 上传到服务器',
                    en: 'DolphinDB: Upload to server'
                },
                icon: '$(cloud-upload)',
            },
            {
                command: 'unit_test',
                title: {
                    zh: 'DolphinDB: 单元测试',
                    en: 'DolphinDB: Unit Test'
                }
            },
            {
                command: 'set_decimals',
                title: {
                    zh: 'DolphinDB: 设置 DolphinDB 小数显示位数',
                    en: 'DolphinDB: Set decimal places'
                },
            },
            {
                command: 'upload_module',
                title: {
                    zh: 'DolphinDB: 上传模块',
                    en: 'DolphinDB: Upload Module'
                }
            },
            {
                command: 'export_table',
                title: {
                    zh: 'DolphinDB: 导出表格',
                    en: 'DolphinDB: Export Table'
                },
                icon: '$(desktop-download)'
            },
            {
                command: 'inspect_debug_variable',
                title: {
                    zh: '查看变量',
                    en: 'View Variable'
                },
            }
        ]
        
        
        const package_json_ = {
            name,
            displayName: 'DolphinDB',
            
            type,
            
            description: 'VSCode extension for DolphinDB',
            
            version,
            
            main: './index.cjs',
            
            icon: 'icons/logo.png',
            
            engines,
            
            scripts,
            
            // 防止 vsce 检测 dependencies 对应的 node_modules 在 ./out/ 下是否安装
            devDependencies: {
                ... dependencies,
                ... devDependencies,
                
                // 在本地使用最新的 vscode api 而不修改 engines 中的硬性条件（绕过 vsce 检测）
                '@types/vscode': '^1.68.0'
            },
            
            publisher: 'dolphindb',
            
            categories: ['Programming Languages', 'Other', 'Linters'],
            keywords: ['dolphindb', 'DolphinDB', 'DataBase', 'database', 'Time Series', 'timeseries', 'Programing Language'],
            homepage: 'https://github.com/dolphindb/vscode-extension/',
            bugs: {
                url: 'https://github.com/dolphindb/vscode-extension/issues'
            },
            repository: {
                type: 'git',
                url: 'https://github.com/dolphindb/vscode-extension.git'
            },
            
            activationEvents: [
                'onStartupFinished',
                
                // 'onView:dolphindb.env',
                // 'onCommand:dolphindb.addServer',
            ],
            
            contributes: {
                languages: [
                    {
                        id: 'dolphindb',
                        extensions: ['.dos'],
                        aliases: ['DolphinDB', 'dolphindb'],
                        configuration: './dolphindb.language-configuration.json',
                        icon: {
                            dark: './icons/file.svg',
                            light: './icons/file.svg',
                        }
                    },
                    {
                        id: 'dolphindb-python',
                        extensions: ['.dos'],
                        aliases: ['DolphinDB Python', 'dolphindb-python'],
                        configuration: './dolphindb-python.language-configuration.json',
                        icon: {
                            dark: './icons/file.svg',
                            light: './icons/file.svg',
                        }
                    }
                ],
                
                grammars: [
                    {
                        language: 'dolphindb',
                        scopeName: 'source.dolphindb',
                        path: './dolphindb.tmLanguage.json',
                    },
                    {
                        language: 'dolphindb-python',
                        scopeName: 'source.dolphindb-python',
                        path: './dolphindb-python.tmLanguage.json',
                    }
                ],
                
                configuration: {
                    title: 'DolphinDB',
                    properties: {
                        'dolphindb.connections': {
                            type: 'array',
                            
                            default: [
                                {
                                    name: 'local8848',
                                    url: 'ws://127.0.0.1:8848',
                                    autologin: true,
                                    username: 'admin',
                                    password: '123456',
                                },
                                {
                                    name: 'controller1',
                                    url: 'ws://127.0.0.1:22210/',
                                    autologin: true,
                                    username: 'admin',
                                    password: '123456',
                                },
                                {
                                    name: 'datanode1',
                                    url: 'ws://127.0.0.1:22214/',
                                    autologin: true,
                                    username: 'admin',
                                    password: '123456',
                                },
                                {
                                    name: 'datanode2',
                                    url: 'ws://127.0.0.1:22215/',
                                    autologin: true,
                                    username: 'admin',
                                    password: '123456',
                                },
                            ],
                            
                            description: make(
                                'configs.connections.description',
                                '展示在左侧边栏的 DolphinDB 面板中的连接配置',
                                'Connection configuration shown in the DolphinDB panel on the left sidebar'
                            ),
                            
                            items: {
                                type: 'object',
                                required: ['url'],
                                properties: Object.fromEntries(
                                    [
                                        {
                                            name: 'name',
                                            type: 'string',
                                            default: 'local8848',
                                            description: {
                                                zh: '连接名称，如 local8848, controller, datanode0',
                                                en: 'Connection name, e.g. local8848, controller, datanode0'
                                            },
                                        },
                                        {
                                            name: 'url',
                                            type: 'string',
                                            default: 'ws://127.0.0.1:8848',
                                            markdownDescription: {
                                                zh: '数据库连接地址 (WebSocket URL), 如:  \n' +
                                                    '- `ws://127.0.0.1:8848`\n' +
                                                    '- `wss://dolphindb.com` (HTTPS 加密)\n',
                                                en: 'Database connection URL (WebSocket URL), e.g.  \n' +
                                                    '- `ws://127.0.0.1:8848`\n' +
                                                    '- `wss://dolphindb.com` (HTTPS encrypted)\n',
                                            },
                                            format: 'uri',
                                        },
                                        {
                                            name: 'autologin',
                                            type: 'boolean',
                                            default: true,
                                            description: {
                                                zh: '是否在建立连接后自动登录，默认 true',
                                                en: 'Whether to automatically log in after the connection is established, the default is true'
                                            },
                                        },
                                        {
                                            name: 'username',
                                            type: 'string',
                                            default: 'admin',
                                            description: {
                                                zh: 'DolphinDB 登录用户名',
                                                en: 'DolphinDB username'
                                            },
                                        },
                                        {
                                            name: 'password',
                                            type: 'string',
                                            default: '123456',
                                            description: {
                                                zh: 'DolphinDB 登录密码',
                                                en: 'DolphinDB password'
                                            },
                                        },
                                        {
                                            name: 'python',
                                            type: 'boolean',
                                            default: false,
                                            description: {
                                                zh: '(需要 v2.10.0 以上的 DolphinDB Server) 使用 Python Parser 来解释执行脚本, 默认 false',
                                                en: '(DolphinDB Server version must be above v2.10.0) Use Python Parser to interpret and execute scripts, the default is false'
                                            },
                                        },
                                        {
                                            name: 'kdb',
                                            type: 'boolean',
                                            default: false,
                                            description: {
                                                zh: '(需要 v3.00.4 以上的 DolphinDB Server) 使用 kdb parser 来解释执行脚本, 默认 false',
                                                en: '(DolphinDB Server version must be above v3.00.4) Use kdb parser to interpret and execute scripts, the default is false'
                                            },
                                        },
                                        {
                                            name: 'sql',
                                            enum: ['DolphinDB', 'Oracle', 'MySQL'],
                                            default: 'DolphinDB',
                                            description: {
                                                zh: '设置当前会话执行的 sql 标准, 默认 DolphinDB',
                                                en: 'Sets the SQL standard for the execution of the current session, default DolphinDB'
                                            },
                                        },
                                        {
                                            name: 'verbose',
                                            type: 'boolean',
                                            default: false,
                                            description: {
                                                zh: '是否打印每个 rpc 的信息用于调试，默认 false',
                                                en: 'Whether to print the information of each rpc for debugging, the default is false'
                                            },
                                        },
                                        {
                                            name: 'mappings',
                                            type: 'object',
                                            default: { },
                                            ...(() => {
                                                const description_zh =
                                                    '上传文件时支持配置文件和文件夹映射 (可添加 **"default"** 作为默认的上传路径，如果是文件夹映射，需要本地和服务器路径均以 **"/"** 结尾)  \n' +
                                                    '比如，用户配置 mappings 为如下内容:  \n' + 
                                                    '`{ "/path/to/local/" : "/path/at/remote/",`  \n' +
                                                    '`  "/path/to/local/dir1/file.dos": "/data/server/dir1/file.dos",`  \n' +
                                                    '`  "D:/path/to/local/": "/data/server/",`  \n' +
                                                    '`  "default" : "/data/" }`  \n' +
                                                    '如果用户本地文件路径为 `"/path/to/local/dir1/file.dos"`，则会被映射到服务器路径 `"/data/server/dir1/file.dos"`  \n' +
                                                    '如果用户本地文件路径为 `"D:/path/to/local/file.dos"`，则会被映射到服务器路径 `"/data/server/file.dos"`  \n' +
                                                    '如果用户本地文件路径为 `"/user/documents/file.dos"`，则被匹配到 **"default"** 项，即映射为服务器路径 `"/data/file.dos"`'
                                                
                                                const description_en =
                                                    'Mapping relationship between local path and server path when uploading files (**"default"** can be configured as the default upload server path,If it is a folder mapping, both local and server paths need to end with **"/"**)  \n' +
                                                    'for example,The user configures mappings as follows:  \n' +
                                                    '`{ "/path/to/local/" : "/path/at/remote/",`  \n' +
                                                    '`  "/path/to/local/dir1/file.dos": "/data/server/dir1/file.dos",`  \n' +
                                                    '`  "D:/path/to/local/": "/data/server/",`  \n' +
                                                    '`  "default" : "/data/" }`  \n' +
                                                    'If the user local file path is `"/path/to/local/dir1/file.dos"`, it will be mapped to the server path `"/data/server/dir1/file.dos"`  \n' +
                                                    'If the user local file path is `"D:/path/to/local/file.dos"`, it will be mapped to the server path `"/data/server/file.dos"`  \n' +
                                                    'If the user local file path is `"/user/documents/file.dos"`, it will be matched to the **"default"** item, which is mapped to the server path `"/data/file.dos"`'
                                                
                                                return {
                                                    markdownDescription: {
                                                        zh: description_zh,
                                                        en: description_en
                                                    },
                                                    patternProperties: {
                                                        '.*': {
                                                            type: 'string',
                                                            markdownDescription: make(
                                                                'configs.mappings.item.markdownDescription',
                                                                description_zh,
                                                                description_en
                                                            )
                                                        }
                                                    }
                                                }
                                            })()  
                                        }
                                    ].map(prop => [
                                        prop.name,
                                        {
                                            ...prop,
                                            ... prop.description ? {
                                                description: make(`configs.connections.${prop.name}.description`, prop.description.zh, prop.description.en)
                                            } : { },
                                            ... prop.markdownDescription ? {
                                                markdownDescription: make(`configs.connections.${prop.name}.markdownDescription`, prop.markdownDescription.zh, prop.markdownDescription.en)
                                            } : { },
                                        }
                                    ])
                                ),
                            }
                        },
                        
                        'dolphindb.ports': {
                            type: 'string',
                            default: '8321-8420',
                            markdownDescription: make(
                                'configs.ports.markdownDescription',
                                
                                '本插件为了在浏览器中展示表格等数据，在 VSCode 中创建的本地 HTTP 服务器的可用端口范围  \n' +
                                '取值为逗号分割的多个可用端口或端口区间 (不能含有空格)，比如：`8321,8322,8300-8310,11000-11999`  \n' +
                                '默认值为 `8321-8420` (包含左右边界)  \n' +
                                '打开 VSCode 窗口时，按从前到后的顺序查找首个可用的端口作为实际监听端口后，打开对应的浏览器页面 `http://localhost:{实际监听端口}`  \n' +
                                '每个 VSCode 窗口会使用端口范围中的一个端口创建 HTTP 服务器，请保证可用端口范围足够大  \n' +
                                '修改这个配置后建议重启 VSCode (对于已经创建的本地 HTTP 服务器不会生效)  \n',
                                
                                'The available port range of the local HTTP server created in VSCode by this plugin in order to display data such as tables in the browser  \n' +
                                'The value is multiple available ports or port ranges separated by commas (no spaces), for example: `8321,8322,8300-8310,11000-11999`  \n' +
                                'The default value is `8321-8420` (including left and right boundaries)  \n' +
                                'When opening the VSCode window, search the first available port as the actual listening port in order from front to back, and then open the corresponding browser page `http://localhost:{actual-listening-port}`  \n' +
                                'Each VSCode window will use a port in the port range to create an HTTP server, please ensure that the available port range is large enough  \n' + 
                                'It is recommended to restart VSCode after modifying this configuration (it will not take effect for the local HTTP server that has been created)  \n'
                            )
                        } satisfies Schema,
                        
                        'dolphindb.decimals': {
                            type: ['number', 'null'],
                            default: null,
                            description: make(
                                'configs.decimals.description',
                                '小数点后显示的位数 (可取 0 ~ 20)，默认为 null (实际数据的位数)',
                                'The number of digits displayed after the decimal point (can be 0 ~ 20), the default is null (the actual number of digits)'
                            )
                        } satisfies Schema,
                        
                        'dolphindb.single_connection_mode': {
                            type: 'boolean',
                            default: false,
                            description: make(
                                'configs.single_connection_mode.description',
                                '在左侧的连接面板切换到新的 DolphinDB 连接后自动断开原有连接',
                                'Automatically disconnect the original connection after switching to a new DolphinDB connection in the connection panel on the left'
                            )
                        } satisfies Schema,
                        
                        'dolphindb.show_connection_url': {
                            type: 'boolean',
                            default: true,
                            description: make(
                                'configs.show_connection_url.description',
                                '在左侧连接面板中是否显示连接的 url 地址，关闭仅显示连接名称，避免信息泄露',
                                'In the left connection panel, whether to display the connection URL address. If it is turned off, only the connection name is displayed to avoid information leakage'
                            )
                        } satisfies Schema
                    }
                },
                
                commands: ext_commands.map(({ command, icon, title }) => ({
                    command: `dolphindb.${command}`,
                    title: make(`commands.${command}`, title.zh, title.en),
                    icon
                })),
                
                keybindings: ext_commands.map( ({ command, key, when, /* args */ }) => ({
                    command: `dolphindb.${command}`,
                    ... key ?  { key }  : { },
                    ... when ?  { when }  : { },
                    // ... args  ?  { arguments: args }  :  { },
                })),
                
                
                viewsContainers: {
                    activitybar: [
                        {
                            id: 'dolphindb',
                            title: 'DolphinDB',
                            icon: './icons/databases.svg'
                        }
                    ],
                    panel: [
                        {
                            id: 'ddbpanel',
                            title: 'DolphinDB',
                            icon: './icons/object.svg',
                        }
                    ]
                },
                
                views: {
                    dolphindb: [
                        {
                            id: 'dolphindb.connector',
                            name: make('configs.dolphindb.connector.name', '连接', 'CONNECTIONS')
                        },
                        {
                            id: 'dolphindb.databases',
                            name: make('configs.dolphindb.databases.name', '数据库', 'DATABASES')
                        },
                        {
                            id: 'dolphindb.variables',
                            name: make('configs.dolphindb.variables.name', '变量', 'VARIABLES')
                        }
                    ],
                    
                    ddbpanel: [
                        {
                            type: 'webview',
                            id: 'ddbdataview',
                            name: make('configs.ddbpanel.name', '数据视图', 'DataView'),
                            contextualTitle: 'DolphinDB',
                            icon: './icons/object.svg',
                            visibility: 'visible',
                        }
                    ]
                },
                
                viewsWelcome: [
                    {
                        view: 'dolphindb',
                        contents: '增加 DolphinDB 连接配置\n[增加 ddb 连接](command:ddb.add_connection)'
                    }
                ],
                
                menus: {
                    commandPalette: [
                        {
                            command: 'dolphindb.connect',
                            when: 'false',
                        },
                        {
                            command: 'dolphindb.disconnect',
                            when: 'false',
                        },
                        {
                            command: 'dolphindb.reconnect',
                            when: 'false',
                        },
                        {
                            command: 'dolphindb.open_connection_settings',
                            when: 'false',
                        },
                        {
                            command: 'dolphindb.inspect_variable',
                            when: 'false',
                        },
                        {
                            command: 'dolphindb.inspect_table',
                            when: 'false',
                        },
                        {
                            command: 'dolphindb.inspect_table_schema',
                            when: 'false',
                        },
                        {
                            command: 'dolphindb.inspect_database_schema',
                            when: 'false',
                        },
                        {
                            command: 'dolphindb.open_variable',
                            when: 'false',
                        },
                        {
                            command: 'dolphindb.reload_databases',
                            when: 'false',
                        },
                        {
                            command: 'dolphindb.reload_dataview',
                            when: 'false',
                        },
                        {
                            command: 'dolphindb.reload_variables',
                            when: 'false',
                        },
                    ],
                    
                    'view/item/context': [
                        {
                            command: 'dolphindb.disconnect',
                            when: "view == dolphindb.connector && viewItem == 'connected'",
                            group: 'inline',
                        },
                        {
                            command: 'dolphindb.inspect_table_schema',
                            when: "view == dolphindb.variables && viewItem == 'table'",
                            group: 'inline',
                        },
                        {
                            command: 'dolphindb.inspect_table_schema',
                            when: "view == dolphindb.databases && viewItem == 'table'",
                            group: 'inline',
                        },
                        {
                            command: 'dolphindb.inspect_database_schema',
                            when: "view == dolphindb.databases && viewItem == 'database'",
                            group: 'inline',
                        },
                        {
                            command: 'dolphindb.open_variable',
                            when: "view == dolphindb.variables && viewItem == 'var' || view == dolphindb.variables && viewItem == 'table'",
                            group: 'inline',
                        }
                    ],
                    
                    // webview 上方加刷新按钮
                    // 在 vscode 源码中搜索 MenuId.ViewTitle 查看相关属性及用法
                    'view/title': [
                        {
                            command: 'dolphindb.open_connection_settings',
                            when: 'view == dolphindb.connector',
                            group: 'navigation',
                        },
                        {
                            command: 'dolphindb.reload_databases',
                            group: 'navigation',
                            when: 'view == dolphindb.databases',
                        },
                        {
                            command: 'dolphindb.reload_variables',
                            group: 'navigation',
                            when: 'view == dolphindb.variables',
                        },
                        {
                            command: 'dolphindb.reload_dataview',
                            group: 'navigation',
                            when: 'view == ddbdataview',
                        },
                        {
                            command: 'dolphindb.open_variable',
                            group: 'navigation',
                            when: 'view == ddbdataview',
                        },
                        {
                            command: 'dolphindb.export_table',
                            group: 'navigation',
                            when: 'view == ddbdataview && !inDebugMode',
                        }
                    ],
                    
                    // 执行按钮
                    'editor/title/run': [
                        {
                            when: "editorLangId == 'dolphindb' || editorLangId == 'dolphindb-python'",
                            command: 'dolphindb.execute_file',
                        },
                        {
                            when: "editorLangId == 'dolphindb' || editorLangId == 'dolphindb-python'",
                            command: 'dolphindb.execute_selection_or_line'
                        },
                    ],
                    // 对应上传的子菜单指令
                    upload: [
                        { command: 'dolphindb.upload_file', group: 'navigation' },
                        { command: 'dolphindb.upload_module', group: 'navigation' }
                    ],
                    // 上传按钮
                    'editor/title': [
                        {
                            group: 'navigation',
                            submenu: 'upload',
                        },
                    ],
                    
                    'explorer/context': [
                        {
                            command: 'dolphindb.unit_test',
                            group: '2_workspace'
                        },
                        {
                            command: 'dolphindb.upload_file',
                            group: '2_workspace'
                        },
                        {
                            command: 'dolphindb.upload_module',
                            group: '2_workspace'
                        },
                    ],
                    // 调试变量菜单
                    'debug/variables/context': [
                        {
                            command: 'dolphindb.inspect_debug_variable',
                            group: '2_workspace'
                        }
                    ]
                },
                submenus: [
                    {
                        id: 'upload',
                        icon: '$(cloud-upload)',
                        label: '上传',
                    }
                ],
                breakpoints: [{ language: 'dolphindb' }],
                
                debuggers: [
                    {
                        type: 'dolphindb',
                        label: make('debugger.label', '调试 DolphinDB 脚本文件', 'Debug DolphinDB script file'),
                        languages: ['dolphindb'],
                        program: './debugger.cjs',
                        runtime: 'node',
                        configurationAttributes: {
                            launch: {
                                required: ['program'],
                                
                                properties: Object.fromEntries(
                                    [
                                        {
                                            name: 'program',
                                            type: 'string',
                                            default: '${file}',
                                            description: {
                                                zh: '脚本完整路径',
                                                en: 'script full path'
                                            },
                                        },
                                        {
                                            name: 'url',
                                            type: 'string',
                                            markdownDescription: {
                                                zh: '数据库连接地址 (WebSocket URL), 如:  \n' +
                                                    '- `ws://127.0.0.1:8848`\n' +
                                                    '- `wss://dolphindb.com` (HTTPS 加密)\n',
                                                en: 'Database connection URL (WebSocket URL), e.g.  \n' +
                                                    '- `ws://127.0.0.1:8848`\n' +
                                                    '- `wss://dolphindb.com` (HTTPS encrypted)\n',
                                            },
                                            format: 'uri',
                                        },
                                        {
                                            name: 'username',
                                            type: 'string',
                                            description: {
                                                zh: 'DolphinDB 登录用户名',
                                                en: 'DolphinDB username'
                                            },
                                        },
                                        {
                                            name: 'password',
                                            type: 'string',
                                            description: {
                                                zh: 'DolphinDB 登录密码',
                                                en: 'DolphinDB password'
                                            },
                                        },
                                    ].map(prop => [
                                        prop.name,
                                        {
                                            ...prop,
                                            ... prop.description ? {
                                                description: make(`debugger.${prop.name}.description`, prop.description.zh, prop.description.en)
                                            } : { },
                                            ... prop.markdownDescription ? {
                                                markdownDescription: make(`debugger.${prop.name}.markdownDescription`, prop.markdownDescription.zh, prop.markdownDescription.en)
                                            } : { },
                                        }
                                    ])
                                ),
                            }
                        },
                        
                        initialConfigurations: [
                            {
                                name: make('debugger.initialConfigurations.name.file', '调试当前 DolphinDB 脚本文件', 'Debug the current DolphinDB script file'),
                                type: 'dolphindb',
                                request: 'launch',
                                program: '${file}',
                            }
                        ]
                    }
                ]
            }
        }
        
        
        await Promise.all([
            fwrite(`${fpd_out}package.json`, package_json_),
            
            // 保存 make 函数暂存到 dict 的词条到 nls 文件
            ...(['zh', 'en'] as const).map(async language => {
                await fwrite(
                    `${fpd_out}package.nls${ language === 'zh' ? '.zh' : '' }.json`,
                    dict[language]
                )
            })
        ])
    },
    
    
    async build_and_close (production: boolean) {
        await this.build(production)
        await this.close()
    },
}


const dependencies: Bundler['dependencies'] = ['antd-icons', 'echarts']


interface VSCodeConfiguration {
    title: string
    order?: number
    properties: Record<string, Schema>
}

interface Schema {
    /** 内部使用 */
    name?: string
    
    type: 'boolean' | 'number' | 'string' | 'object' | 'array' | 'null' | ('boolean' | 'number' | 'string' | 'object' | 'array' | 'null')[]
    default?: any
    
    items?: Schema
    
    properties?: Record<string, Schema>
    
    required?: string[]
    
    minimum?: number
    maximum?: number
    
    /** restricting string length */
    maxLength?: number
    minLength?: number
    
    /** regexp pattern */
    pattern?: string
    patternErrorMessage?: string
    patternProperties?: object
    
    format?: 'date' | 'time' | 'ipv4' | 'email' | 'uri'
    
    maxItems?: number
    minItems?: number
    
    description?: string | Item
    markdownDescription?: string | Item
    
    editPresentation?: 'multilineText'
    
    additionalProperties?: false | Record<string, 'boolean' | 'number' | 'string' | 'object' | 'array'>
    
    order?: number
    
    enum?: string[]
    enumDescriptions?: string[]
}


await main()

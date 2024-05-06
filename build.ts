import { fileURLToPath } from 'url'

import { default as Webpack, type Configuration, type Compiler, type Stats } from 'webpack'

import type { Options as TSLoaderOptions } from 'ts-loader'
import type { Options as SassOptions } from 'sass-loader'
import * as sass from 'sass'


import { fdelete, fmkdir, fwrite, fcopy, fexists } from 'xshell'
import type { Item } from 'xshell/i18n/index.js'


import { tm_language, tm_language_python } from 'dolphindb/language.js'


import package_json from './package.json' with { type: 'json' }

import { get_vendors } from './src/config.js'


const fpd_root = fileURLToPath(import.meta.url).fdir

const ramdisk = fexists('T:/TEMP/', { print: false })
const fpd_ramdisk_root = 'T:/2/ddb/ext/' as const

const fpd_node_modules = `${fpd_root}node_modules/`

const fpd_dataview = `${fpd_root}src/dataview/`

const fpd_out = `${ ramdisk ? fpd_ramdisk_root : fpd_root }out/`

const fpd_out_dataview = `${fpd_out}dataview/`

const production = process.argv.includes('--production')


async function build () {
    if (production)
        await fdelete(fpd_out)
    
    await fmkdir(fpd_out_dataview)
    
    await Promise.all([
        copy_files(!production),
        
        build_package_json(),
        
        build_tm_language(),
        
        dataview_webpack.build(production),
        
        ext_webpack.build(production)
    ])
}


async function copy_files (dev: boolean) {
    const fpd_vendors = `${fpd_out_dataview}vendors/`
    
    console.log('复制 vendors')
    
    return Promise.all([
        ... get_vendors(dev)
                .map(async fp => 
                    fcopy(`${fpd_node_modules}${fp}`, `${fpd_vendors}${fp}`, { print: false })),
        
        ... (['README.md', 'README.zh.md', 'icons/', 'LICENSE.txt'] as const).map(async fname =>
            fcopy(fpd_root + fname, fpd_out + fname)
        ),
        
        ... ([
            `index${ dev ? '.dev' : '' }.html`,
            'window.html',
            'webview.html',
            'logo.png'
        ] as const).map(async fname =>
            fcopy(fpd_dataview + fname, fpd_out_dataview + fname)
        ),
        
        ... (['zh', 'en'] as const).map(async language => 
            fcopy(`${fpd_node_modules}dolphindb/docs.${language}.json`, `${fpd_out}docs.${language}.json`)
        ),
    ])
}


async function build_tm_language () {
    await Promise.all([
        fwrite(`${fpd_out}dolphindb.tmLanguage.json`, tm_language),
        fwrite(`${fpd_out}dolphindb-python.tmLanguage.json`, tm_language_python),
        
        fcopy(`${fpd_root}dolphindb.language-configuration.json`, `${fpd_out}dolphindb.language-configuration.json`),
        fcopy(`${fpd_root}dolphindb-python.language-configuration.json`, `${fpd_out}dolphindb-python.language-configuration.json`)
    ])
}


async function build_package_json () {
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
            command: 'inspect_table_variable_schema',
            title: {
                zh: 'DolphinDB: 查看表结构',
                en: 'DolphinDB: Inspect Schema'
            },
            icon: '$(symbol-structure)',
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
                en: 'DolphinDB: Inspect Schema'
            },
            icon: '$(symbol-structure)',
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
            command: 'reload_database',
            title: {
                zh: 'DolphinDB: 重新加载数据库',
                en: 'DolphinDB: Reload DataBase'
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
                        id: 'dolphindb.connection',
                        name: make('configs.dolphindb.connection.name', '连接', 'CONNECTION')
                    },
                    {
                        id: 'dolphindb.database',
                        name: make('configs.dolphindb.database.name', '数据库', 'DATABASE')
                    },
                    {
                        id: 'dolphindb.var',
                        name: make('configs.dolphindb.var.name', '变量', 'VARIABLE')
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
                        command: 'dolphindb.inspect_table_variable_schema',
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
                        command: 'dolphindb.open_variable',
                        when: 'false',
                    },
                    {
                        command: 'dolphindb.reload_database',
                        when: 'false',
                    },
                    {
                        command: 'dolphindb.reload_dataview',
                        when: 'false',
                    },
                ],
                
                'view/item/context': [
                    {
                        command: 'dolphindb.disconnect',
                        when: "view == dolphindb.connection && viewItem == 'connected'",
                        group: 'inline',
                    },
                    {
                        command: 'dolphindb.inspect_table_variable_schema',
                        when: "view == dolphindb.var && viewItem == 'table'",
                        group: 'inline',
                    },
                    {
                        command: 'dolphindb.inspect_table_schema',
                        when: "view == dolphindb.database && viewItem == 'table'",
                        group: 'inline',
                    },
                    {
                        command: 'dolphindb.open_variable',
                        when: "view == dolphindb.var && viewItem == 'var' || view == dolphindb.var && viewItem == 'table'",
                        group: 'inline',
                    }
                ],
                
                // webview 上方加刷新按钮
                // 在 vscode 源码中搜索 MenuId.ViewTitle 查看相关属性及用法
                'view/title': [
                    {
                        command: 'dolphindb.open_connection_settings',
                        when: 'view == dolphindb.connection',
                        group: 'navigation',
                    },
                    {
                        command: 'dolphindb.reload_database',
                        group: 'navigation',
                        when: 'view == dolphindb.database',
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
            breakpoints: [{ language: 'dolphindb' }, { language: 'dolphindb-python' }],
            
            debuggers: [
                {
                    type: 'dolphindb',
                    label: make('debugger.label', '调试 DolphinDB 脚本文件', 'Debug DolphinDB script file'),
                    languages: ['dolphindb', 'dolphindb-python'],
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
}


let dataview_webpack = {
    config: null as Configuration,
    
    compiler: null as Compiler,
    
    
    async build (production: boolean) {
        this.compiler = Webpack(this.config = {
            name: 'dataview',
            
            mode: production ? 'production' : 'development',
            
            devtool: 'source-map',
            
            context: fpd_root,
            
            entry: {
                'index.js': './src/dataview/index.tsx',
                'window.js': './src/dataview/window.tsx',
                'webview.js': './src/dataview/webview.tsx',
            },
            
            
            experiments: {
                outputModule: true,
            },
            
            output: {
                path: fpd_out_dataview,
                filename: '[name]',
                publicPath: '/',
                pathinfo: true,
                globalObject: 'globalThis',
                module: true,
                library: {
                    type: 'module',
                }
            },
            
            target: ['web', 'es2023'],
            
            externalsType: 'global',
            
            externals: {
                react: 'React',
                
                'react-dom': 'ReactDOM',
                
                lodash: '_',
                
                antd: 'antd',
                
                dayjs: 'dayjs',
                
                '@ant-design/icons': 'icons',
                
                '@ant-design/plots': 'Plots',
            },
            
            resolve: {
                extensions: ['.js'],
                
                symlinks: true,
                
                extensionAlias: {
                    '.js': ['.js', '.ts', '.tsx']
                },
                
                fallback: {
                    process: false
                }
            },
            
            
            module: {
                rules: [
                    {
                        test: /\.js$/,
                        enforce: 'pre',
                        use: ['source-map-loader'],
                    },
                    {
                        test: /\.tsx?$/,
                        exclude: /node_modules/,
                        loader: 'ts-loader',
                        // https://github.com/TypeStrong/ts-loader
                        options: {
                            configFile: `${fpd_root}tsconfig.json`,
                            onlyCompileBundledFiles: true,
                            transpileOnly: true,
                        } as Partial<TSLoaderOptions>
                    },
                    {
                        test: /\.s[ac]ss$/,
                        use: [
                            'style-loader',
                            {
                                // https://github.com/webpack-contrib/css-loader
                                loader: 'css-loader',
                                options: {
                                    url: false,
                                }
                            },
                            {
                                // https://webpack.js.org/loaders/sass-loader
                                loader: 'sass-loader',
                                options: {
                                    implementation: sass,
                                    // 解决 url(search.png) 打包出错的问题
                                    webpackImporter: false,
                                    sassOptions: {
                                        indentWidth: 4,
                                    },
                                } as SassOptions,
                            }
                        ]
                    },
                    {
                        test: /\.css$/,
                        use: [
                            'style-loader',
                            'css-loader',
                        ]
                    },
                    {
                        oneOf: [
                            {
                                test: /\.icon\.svg$/,
                                issuer: /\.[jt]sx?$/,
                                loader: '@svgr/webpack',
                                options: {
                                    icon: true,
                                }
                            },
                            {
                                test: /\.(svg|ico|png|jpe?g|gif|woff2?|ttf|eot|otf|mp4|webm|ogg|mp3|wav|flac|aac)$/,
                                type: 'asset/inline',
                            },
                        ]
                    },
                    {
                        test: /\.txt$/,
                        type: 'asset/source',
                    }
                ],
            },
            
            plugins: [
                // 需要分析 bundle 大小时开启
                // new BundleAnalyzerPlugin({ analyzerPort: 8880, openAnalyzer: false }),
            ],
            
            
            optimization: {
                minimize: false
            },
            
            performance: {
                hints: false,
            },
            
            cache: {
                type: 'filesystem',
                
                ... ramdisk ? {
                    cacheDirectory: `${fpd_ramdisk_root}webpack/`,
                    compression: false
                } : {
                    compression: 'brotli',
                }
            },
            
            ignoreWarnings: [
                /Failed to parse source map/
            ],
            
            stats: {
                colors: true,
                
                context: fpd_root,
                
                entrypoints: false,
                
                errors: true,
                errorDetails: true,
                
                hash: false,
                
                version: false,
                
                timings: true,
                
                children: false,
                
                assets: true,
                assetsSpace: 20,
                
                modules: false,
                modulesSpace: 20,
                
                cachedAssets: false,
                cachedModules: false,
            },
        })
        
        await new Promise<Stats>((resolve, reject) => {
            this.compiler.run((error, stats) => {
                if (stats)
                    console.log(
                        stats.toString(this.config.stats)
                            .replace(/\n\s*.*dataview.* compiled .*successfully.* in (.*)/, '\nDdbDataview 编译成功，用时 $1'.green)
                    )
                
                if (error)
                    reject(error)
                else if (stats.hasErrors())
                    reject(new Error('dataview 编译失败'))
                else
                    resolve(stats)
            })
        })
        
        await new Promise<void>((resolve, reject) => {
            this.compiler.close(error => {
                if (error)
                    reject(error)
                else
                    resolve()
            })
        })
    }
}


const ext_webpack = {
    config: null as Configuration,
    
    compiler: null as Compiler,
    
    
    async build (production: boolean) {
        this.compiler = Webpack(this.config = {
            name: 'ext',
            
            mode: production ? 'production' : 'development',
            
            devtool: 'source-map',
            
            context: fpd_root,
            
            entry: {
                'index.cjs': './src/index.ts',
                'debugger.cjs': './src/debugger/index.ts',
            },
            
            output: {
                path: fpd_out,
                filename: '[name]',
                pathinfo: true,
                globalObject: 'globalThis',
                library: {
                    type: 'commonjs2',
                },
                
                // 关掉之后可以避免生成多个 chunk, 开着也挺好，按需加载
                // chunkLoading: false,
            },
            
            target: ['node20', 'es2023'],
            
            resolve: {
                extensions: ['.js'],
                
                symlinks: true,
                
                extensionAlias: {
                    '.js': ['.js', '.ts', '.tsx']
                },
            },
            
            externalsType: 'commonjs2',
            
            externals: {
                vscode: 'commonjs2 vscode'
            },
            
            module: {
                rules: [
                    {
                        test: /\.js$/,
                        enforce: 'pre',
                        use: ['source-map-loader'],
                    },
                    {
                        test: /\.ts$/,
                        exclude: /node_modules/,
                        loader: 'ts-loader',
                        // https://github.com/TypeStrong/ts-loader
                        options: {
                            configFile: `${fpd_root}tsconfig.json`,
                            onlyCompileBundledFiles: true,
                            transpileOnly: true,
                            compilerOptions: {
                                module: 'ESNext' as any,
                                moduleResolution: 'Bundler' as any,
                                esModuleInterop: true
                            }
                        } as Partial<TSLoaderOptions>
                    }
                ]
            },
            
            plugins: [
                new Webpack.DefinePlugin({
                    FPD_ROOT: fpd_root.quote()
                }),
                
                // new BundleAnalyzerPlugin({
                //     analyzerPort: 8880,
                //     openAnalyzer: false,
                // }),
            ],
            
            optimization: {
                minimize: false,
            },
            
            cache: {
                type: 'filesystem',
                
                ... ramdisk ? {
                    cacheDirectory: `${fpd_ramdisk_root}webpack/`,
                    compression: false
                } : {
                    compression: 'brotli',
                }
            },
            
            ignoreWarnings: [
                /Failed to parse source map/,
                /Can't resolve '(bufferutil|utf-8-validate)'/
            ],
            
            stats: {
                colors: true,
                
                context: fpd_root,
                
                entrypoints: false,
                
                errors: true,
                errorDetails: true,
                
                hash: false,
                
                version: false,
                
                timings: true,
                
                children: false,
                
                assets: true,
                assetsSpace: 20,
                
                modules: false,
                modulesSpace: 20,
                
                cachedAssets: false,
                cachedModules: false,
            },
        })
        
        await new Promise<Stats>((resolve, reject) => {
            this.compiler.run((error, stats) => {
                if (stats)
                    console.log(
                        stats.toString(this.config.stats)
                            .replace(/\n\s*.*ext.* compiled .*successfully.* in (.*)/, '\n扩展编译成功，用时 $1'.green)
                    )
                
                if (error)
                    reject(error)
                else if (stats.hasErrors())
                    reject(new Error('扩展编译失败'))
                else
                    resolve(stats)
            })
        })
        
        new Promise<void>((resolve, reject) => {
            this.compiler.close(error => {
                if (error)
                    reject(error)
                else
                    resolve()
            })
        })
    }
}


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


await build()

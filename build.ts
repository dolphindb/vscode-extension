import { fwrite, fcopy, fmkdir } from 'xshell'

import { fpd_ext_out, fpd_ext_root } from './config.js'
import { ddb_tm_language } from './dolphindb.language.js'
import { r } from './i18n/index.js'


;(async function build () {
    await fmkdir(fpd_ext_out)
    
    await Promise.all([
        ...['dolphindb.png', 'docs.json', '.vscodeignore'].map(fname => 
            fcopy(`${fpd_ext_root}${fname}`, `${fpd_ext_out}${fname}`)
        ),
        build_package_json(),
        build_tm_language(),
    ])
})()


async function build_tm_language () {
    await Promise.all([
        fwrite(
            `${fpd_ext_out}dolphindb.tmLanguage.json`,
            ddb_tm_language
        ),
        fcopy(
            `${fpd_ext_root}dolphindb.language-configuration.json`,
            `${fpd_ext_out}dolphindb.language-configuration.json`
        )
    ])
}


async function build_package_json () {
    const { name, version, engines, scripts, devDependencies } = await import(`${fpd_ext_root}package.json`)
    
    const ext_commands = [
        {
            command: 'execute',
            key: 'ctrl+e',
            when: "!editorReadonly && editorTextFocus && editorLangId == 'dolphindb'",
            title: {
                zh: '执行代码',
                en: 'Execute Code'
            },
        },
        {
            command: 'set_ddb_connection',
        }
    ]
    
    
    const package_json = {
        name,
        displayName: 'DolphinDB',
        description: 'VSCode extension for DolphinDB',
        
        version,
        
        main: './index.js',
        
        icon: 'dolphindb.png',
        
        engines,
        
        scripts,
        
        devDependencies,
        
        publisher: 'dolphindb',
        
        categories: ['Programming Languages', 'Other', 'Linters', 'Snippets'],
        keywords: ['DataBase', 'database', 'dolphindb', 'DolphinDB', 'Time Series', 'timeseries', 'Stream Computition', 'Programing language'],
        homepage: 'https://github.com/dolphindb/vscode-extension/',
        bugs: {
            url: 'https://github.com/dolphindb/vscode-extension/issues'
        },
        repository: {
            type: 'git',
            url: 'https://github.com/dolphindb/vscode-extension.git'
        },
        
        activationEvents: [
            "onStartupFinished",
            
            // 'onView:dolphindb.env',
            // 'onCommand:dolphindb.executeCode',
            // 'onCommand:dolphindb.addServer',
            // 'onCommand:dolphindb.chooseServer',
            // 'onCommand:dolphindb.removeServer',
            // 'onCommand:dolphindb.helper',
            // 'onCommand:dolphindb.login',
            // 'onCommand:dolphindb.ssl'
        ],
        
        contributes: {
            languages: [
                {
                    id: 'dolphindb',
                    extensions: ['.dos'],
                    aliases: [
                        'DolphinDB',
                        'dolphindb'
                    ],
                    configuration: './dolphindb.language-configuration.json'
                }
            ],
            
            grammars: [
                {
                    language: 'dolphindb',
                    scopeName: 'source.dolphindb',
                    path: './dolphindb.tmLanguage.json',
                }
            ],
            
            configuration: {
                title: 'DolphinDB',
                properties: {
                    'dolphindb.servers': {
                        type: 'array',
                        scope: 'resource',
                        default: [
                            {
                                name: 'local8848',
                                url: 'ws://127.0.0.1:8848',
                            }
                        ]
                    },
                }
            },
            
            commands: ext_commands.map(({ command }) => ({
                command: `dolphindb.${command}`,
                title: `%commands.${command}%`
            })),
            
            keybindings: ext_commands.map( ({ command, key, when, /* args */ }) => ({
                command: `dolphindb.${command}`,
                ... key ?  { key }  : { },
                ... when ?  { when }  : { },
                // ... args  ?  { arguments: args }  :  { },
            })),
            
            
            // snippets: [
            //     {
            //         language: 'dolphindb',
            //         path: './dolphindb.snippets.json'
            //     }
            // ],
            
            // viewsContainers: {
            //     activitybar: [
            //         {
            //             id: 'dolphindb-explorer',
            //             title: 'DolphinDB Explorer',
            //             icon: 'media/explorer.svg'
            //         }
            //     ]
            // },
            
            views: {
                explorer: [
                    {
                        id: 'dolphindb',
                        name: 'DolphinDB'
                    }
                ]
            },
            
            viewsWelcome: [
                {
                    view: 'dolphindb',
                    contents: '增加 DolphinDB 连接配置\n[增加 ddb 连接](command:ddb.add_connection)'
                }
            ],
            
            // commands: [
            //     {
            //         command: 'dolphindb.executeCode',
            //         title: 'DolphinDB: executeCode'
            //     },
            //     {
            //         command: 'dolphindb.addServer',
            //         title: 'DolphinDB: addServer'
            //     },
            //     {
            //         command: 'dolphindb.chooseServer',
            //         title: 'DolphinDB: chooseServer'
            //     },
            //     {
            //         command: 'dolphindb.removeServer',
            //         title: 'DolphinDB: removeServer'
            //     },
            //     {
            //         command: 'dolphindb.helper',
            //         title: 'DolphinDB: Helper'
            //     },
            //     {
            //         command: 'dolphindb.env.refresh',
            //         title: 'Refresh',
            //         icon: {
            //             light: 'resources/light/refresh.svg',
            //             dark: 'resources/dark/refresh.svg'
            //         }
            //     },
            //     {
            //         command: 'dolphindb.env.showInfo',
            //         title: 'Show'
            //     },
            //     {
            //         command: 'dolphindb.login',
            //         title: 'DolphinDB: login'
            //     },
            //     {
            //         command: 'dolphindb.ssl',
            //         title: 'DolphinDB: SSL'
            //     }
            // ],
            
            // menus: {
            //     'editor/context': [
            //         {
            //             command: 'dolphindb.executeCode',
            //             when: 'resourceLangId == dolphindb'
            //         },
            //         {
            //             command: 'dolphindb.addServer',
            //             when: 'resourceLangId == dolphindb'
            //         },
            //         {
            //             command: 'dolphindb.chooseServer',
            //             when: 'resourceLangId == dolphindb'
            //         },
            //         {
            //             command: 'dolphindb.removeServer',
            //             when: 'resourceLangId == dolphindb'
            //         },
            //         {
            //             command: 'dolphindb.login',
            //             when: 'resourceLangId == dolphindb'
            //         },
            //         {
            //             command: 'dolphindb.ssl',
            //             when: 'resourceLangId == dolphindb'
            //         }
            //     ],
                
            //     'view/title': [
            //         {
            //             command: 'dolphindb.env.refresh',
            //             when: 'view == dolphindb.env',
            //             group: 'navigation'
            //         }
            //     ],
                
            //     'view/item/context': [
            //         {
            //             command: 'dolphindb.env.showInfo',
            //             when: 'view == dolphindb.env && viewItem == variableInfo',
            //             group: 'inline'
            //         }
            //     ]
            // },
            
            // keybindings: [
            //     {
            //         command: 'dolphindb.executeCode',
            //         key: 'ctrl+e',
            //         mac: 'cmd+e'
            //     }
            // ],
            
            // breakpoints: [
            //     {
            //         language: 'dolphindb'
            //     }
            // ]
        }
    }
    
    await Promise.all([
        ...(['zh', 'en'] as const).map(async language => {
            await fwrite(
                `${fpd_ext_out}package.nls${ language === 'zh' ? '.zh' : '' }.json`,
                Object.fromEntries(
                    ext_commands.map(({ command, title }) => [
                        `commands.${command}`,
                        `DolphinDB: ${r(title, language)}`
                    ])
                )
            )
        }),
        fwrite(`${fpd_ext_out}package.json`, package_json)
    ])
}


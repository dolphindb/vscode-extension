import Webpack from 'webpack'

import type { Options as TSLoaderOptions } from 'ts-loader'
import type { Options as SassOptions } from 'sass-loader'
import sass from 'sass'

import { fwrite, fcopy, fmkdir, request } from 'xshell'
import type { Item } from 'xshell/i18n'

import { fpd_out, fpd_ext, vendors } from './config.js'
import { tm_language } from './dolphindb.language.js'
import { r } from './i18n/index.js'



;(async function build () {
    await fmkdir(fpd_out)
    
    await Promise.all([
        ...[
            'README.md',
            'README.zh.md',
            'docs.json',
            '.vscodeignore',
            'icons/',
        ].map(fname => 
            fcopy(`${fpd_ext}${fname}`, `${fpd_out}${fname}`)
        ),
        get_vendors(`${fpd_ext}out/dataview/`),
        build_package_json(),
        build_tm_language(),
        build_dataview(),
    ])
})()


async function build_tm_language () {
    await Promise.all([
        fwrite(
            `${fpd_out}dolphindb.tmLanguage.json`,
            tm_language
        ),
        fcopy(
            `${fpd_ext}dolphindb.language-configuration.json`,
            `${fpd_out}dolphindb.language-configuration.json`
        )
    ])
}


async function build_package_json () {
    const { name, version, engines, scripts, devDependencies } = await import(`${fpd_ext}package.json`)
    
    const ext_commands = [
        {
            command: 'execute',
            key: 'ctrl+e',
            when: "editorTextFocus && editorLangId == 'dolphindb'",
            title: {
                zh: 'DolphinDB: 执行代码',
                en: 'DolphinDB: Execute Code'
            },
        },
        {
            command: 'set_connection',
            title: {
                zh: '选择连接',
                en: 'Select Connection'
            }
        },
        {
            command: 'disconnect_connection',
            title: {
                zh: '断开连接',
                en: 'Disconnect'
            },
            icon: './icons/disconnect.svg'
        },
        {
            command: 'inspect_variable',
            title: {
                zh: '查看变量',
                en: 'Inspect Variable'
            },
            icon: '$(browser)',
        },
        {
            command: 'open_variable',
            title: {
                zh: '在新窗口中查看变量',
                en: 'Inspect Variable in New Window'
            },
            icon: '$(multiple-windows)',
        },
    ]
    
    const connection_properties: Schema[] = [
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
                zh: '使用 Python 语言',
                en: 'Use Python language'
            },
        },
    ]
    
    
    const package_json = {
        name,
        displayName: 'DolphinDB',
        description: 'VSCode extension for DolphinDB',
        
        version,
        
        main: './index.js',
        
        icon: 'icons/logo.png',
        
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
            'onStartupFinished',
            
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
                    'dolphindb.connections': {
                        type: 'array',
                        default: [
                            {
                                name: 'local8848',
                                url: 'ws://127.0.0.1:8848',
                                autologin: true,
                                username: 'admin',
                                password: '123456',
                                python: false,
                            }
                        ],
                        description: '%configs.connections.description%',
                        items: {
                            type: 'object',
                            required: ['url'],
                            properties: Object.fromEntries(
                                connection_properties.map(prop => [
                                    prop.name,
                                    {
                                        ...prop,
                                        ... prop.description ? {
                                            description: `%configs.connections.${prop.name}.description%`
                                        } : { },
                                        ... prop.markdownDescription ? {
                                            markdownDescription: `%configs.connections.${prop.name}.markdownDescription%`
                                        } : { },
                                    }
                                ])
                            ),
                        }
                    }
                }
            },
            
            commands: ext_commands.map(({ command, icon }) => ({
                command: `dolphindb.${command}`,
                title: `%commands.${command}%`,
                icon
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
                        id: 'dolphindb.explorer',
                        name: 'dolphindb',
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
                'view/item/context': [
                    {
                        command: 'dolphindb.disconnect_connection',
                        when: "view == dolphindb.explorer && viewItem == 'connected'",
                        group: 'inline',
                    },
                    {
                        command: 'dolphindb.inspect_variable',
                        when: "view == dolphindb.explorer && viewItem == 'var'",
                        group: 'inline',
                    },
                    {
                        command: 'dolphindb.open_variable',
                        when: "view == dolphindb.explorer && viewItem == 'var'",
                        group: 'inline',
                    },
                ]
            }
            
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
                `${fpd_out}package.nls${ language === 'zh' ? '.zh' : '' }.json`,
                {
                    'configs.connections.description': {
                        zh: '展示在左侧边栏的 DolphinDB 面板中的连接配置',
                        en: 'Connection configuration shown in the DolphinDB panel on the left sidebar',
                    }[language],
                    
                    ... Object.fromEntries(
                        connection_properties.map(({ name, description, markdownDescription }) => [
                            `configs.connections.${name}.${ markdownDescription ? 'markdownDescription' : 'description' }`,
                            r(
                                (markdownDescription ? markdownDescription : description) as Item,
                                language
                            )
                        ])
                    ),
                    
                    ... Object.fromEntries(
                        ext_commands.map(({ command, title }) => [
                            `commands.${command}`,
                            r(title, language)
                        ])
                    ),
                },
            )
        }),
        
        fwrite(`${fpd_out}package.json`, package_json)
    ])
}


async function build_dataview () {
    await Promise.all([
        (async () => {
            let compiler = Webpack(dataview_config)
            
            await new Promise<void>((resolve, reject) => {
                compiler.run((error, stats) => {
                    if (error || stats.hasErrors()) {
                        console.log(stats.toString(dataview_config.stats))
                        reject(error || stats)
                        return
                    }
                    
                    console.log(stats.toString(dataview_config.stats))
                    resolve()
                })
            })
            
            await new Promise(resolve => {
                compiler.close(resolve)
            })
        })(),
        
        fcopy(
            `${fpd_ext}dataview/index.html`,
            `${fpd_out}dataview/index.html`,
        ),
        
        fcopy(
            `${fpd_ext}dataview/window.html`,
            `${fpd_out}dataview/window.html`,
        ),
        
        fcopy(
            `${fpd_ext}dataview/logo.png`,
            `${fpd_out}dataview/logo.png`,
        ),
    ])
}

async function get_vendors (fpd: string, update = false) {
    await Promise.all(
        Object.entries(vendors)
            .map(async ([name, fp]) => {
                const fp_full = `${fpd}${name}`
                
                if (update || !fp_full.fexists)
                    await fwrite(
                        fp_full,
                        await request(`https://cdn.jsdelivr.net/npm/${fp}`, { retries: 5 })
                    )
            }
        )
    )
}


const dataview_config: Webpack.Configuration = {
    name: 'DdbDataviewWebpackCompiler',
    
    mode: 'production',
    
    devtool: 'source-map',
    
    entry: {
        'index.js': './dataview/index.tsx',
        'window.js': './dataview/window.tsx',
    },
    
    
    experiments: {
        // outputModule: true,
        topLevelAwait: true,
    },
    
    output: {
        path: `${fpd_ext}out/dataview/`,
        filename: '[name]',
        publicPath: '/',
        pathinfo: true,
        globalObject: 'globalThis',
        
        // 在 bundle 中导出 entry 文件的 export
        // library: {
        //     type: 'commonjs2',
        // }
        
        // module: true,
        
        // 解决 'ERR_OSSL_EVP_UNSUPPORTED' 错误问题 for nodejs 17
        // https://stackoverflow.com/questions/69394632/webpack-build-failing-with-err-ossl-evp-unsupported
        hashFunction: 'sha256',
    },
    
    target: ['web', 'es2020'],
    
    
    resolve: {
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
        symlinks: false,
        
        // modules: [
        //     'd:/1/i18n/node_modules/',
        // ],
        
        fallback: {
            process: false,
        }
    },
    
    
    externals: {
        react: 'React',
        'react-dom': 'ReactDOM',
        jquery: '$',
        lodash: '_',
        antd: 'antd',
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
                    configFile: `${fpd_ext}tsconfig.json`,
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
        // new Webpack.HotModuleReplacementPlugin(),
        
        // new Webpack.DefinePlugin({
        //     process: { env: { }, argv: [] }
        // })
        
        // 需要分析 bundle 大小时开启
        // new BundleAnalyzerPlugin({ analyzerPort: 8880, openAnalyzer: false }),
    ],
    
    
    optimization: {
        minimize: false,
    },
    
    performance: {
        hints: false,
    },
    
    cache: {
        type: 'filesystem',
        compression: false,
    },
    
    ignoreWarnings: [
        /Failed to parse source map/
    ],
    
    stats: {
        colors: true,
        
        context: fpd_ext,
        
        entrypoints: false,
        
        errors: true,
        errorDetails: true,
        
        hash: false,
        
        version: false,
        
        timings: true,
        
        children: true,
        
        assets: false,
        assetsSpace: 100,
        
        cachedAssets: false,
        cachedModules: false,
        
        modules: false,
        // modulesSpace: 30
    },
    
} as Webpack.Configuration



interface Configuration {
    title: string
    order?: number
    properties: Record<string, Schema>
}

interface Schema {
    /** 内部使用 */
    name?: string
    
    type: 'boolean' | 'number' | 'string' | 'object' | 'array'
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

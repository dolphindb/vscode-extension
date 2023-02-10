import { fileURLToPath } from 'url'

import path from 'upath'

import { default as Webpack, type Configuration, type Compiler, type Resolver, type Stats } from 'webpack'

import type { Options as TSLoaderOptions } from 'ts-loader'
import type { Options as SassOptions } from 'sass-loader'
import sass from 'sass'


import { fwrite, fcopy } from 'xshell'
import type { Item } from 'xshell/i18n/index.js'


import { tm_language } from 'dolphindb/language.js'


import { r } from './i18n/index.js'

import package_json from './package.json' assert { type: 'json' }


export const fpd_root = `${path.dirname(fileURLToPath(import.meta.url))}/`

export const fpd_node_modules = `${fpd_root}node_modules/`

export const fpd_dataview = `${fpd_root}dataview/`

export const fpd_out = `${fpd_root}out/` as const

export const fpd_out_dataview = `${fpd_out}dataview/`


export async function copy_files () {
    const fpd_vendors = `${fpd_out_dataview}vendors/`
    
    return Promise.all([
        ... ([
            'react/umd/react.production.min.js',
            'react-dom/umd/react-dom.production.min.js',
            'dayjs/dayjs.min.js',
            'lodash/lodash.min.js',
            'antd/dist/antd-with-locales.min.js',
            'antd/dist/antd-with-locales.min.js.map',
            '@ant-design/icons/dist/index.umd.min.js',
            '@ant-design/plots/dist/plots.min.js',
            '@ant-design/plots/dist/plots.min.js.map',
        ] as const).map(async fp => 
            fcopy(`${fpd_node_modules}${fp}`, `${fpd_vendors}${fp}`)),
        
        ... (['README.md', 'README.zh.md', 'icons/'] as const).map(async fname =>
            fcopy(fpd_root + fname, fpd_out + fname, { overwrite: true })
        ),
        
        ... ([
            'index.html',
            'window.html',
            'webview.html',
            'logo.png'
        ] as const).map(async fname =>
            fcopy(fpd_dataview + fname, fpd_out_dataview + fname, { overwrite: true })
        ),
        
        ... (['zh', 'en'] as const).map(async (language) => 
            fcopy(`${fpd_node_modules}dolphindb/docs.${language}.json`, `${fpd_out}docs.${language}.json`, { overwrite: true })
        ),
    ])
}


export async function build_tm_language () {
    await Promise.all([
        fwrite(`${fpd_out}dolphindb.tmLanguage.json`, tm_language),
        fcopy(`${fpd_root}dolphindb.language-configuration.json`, `${fpd_out}dolphindb.language-configuration.json`)
    ])
}


export async function build_package_json (production: boolean) {
    const { name, type, version, engines, scripts, dependencies, devDependencies } = package_json
    
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
            command: 'execute_selection_or_line',
            when: "editorTextFocus && editorLangId == 'dolphindb'",
            title: {
                zh: '执行选中或当前行',
                en: 'Execute Selection or Line'
            },
            icon: '$(play)'
        },
        {
            command: 'execute_file',
            when: "editorLangId == 'dolphindb'",
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
            icon: `${ production ? '.' : '..' }/icons/disconnect.svg`,
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
            command: 'open_variable',
            title: {
                zh: 'DolphinDB: 在新窗口中查看变量',
                en: 'DolphinDB: Inspect Variable in New Window'
            },
            icon: '$(multiple-windows)',
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
                zh: 'DolphinDB: 上传文件',
                en: 'DolphinDB: Upload File'
            },
            icon: '$(cloud-upload)',
        },
        {
            command: 'set_decimals',
            title: {
                zh: 'DolphinDB: 设置 DolphinDB 小数显示位数',
                en: 'DolphinDB: Set decimal places'
            },
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
                zh: '(需要 v2.10.0 以上的 DolphinDB Server) 使用 Python Parser 来解释执行脚本, 默认 false',
                en: '(DolphinDB Server version must be above v2.10.0) Use Python Parser to interpret and execute scripts, the default is false'
            },
        },
    ]
    
    const ports_property = {
        type: 'string',
        default: '8321-8420',
        markdownDescription: {
            zh: 
                '本插件为了在浏览器中展示表格等数据，在 VSCode 中创建的本地 HTTP 服务器的可用端口范围  \n' +
                '取值为逗号分割的多个可用端口或端口区间 (不能含有空格)，比如：`8321,8322,8300-8310,11000-11999`  \n' +
                '默认值为 `8321-8420` (包含左右边界)  \n' +
                '打开 VSCode 窗口时，按从前到后的顺序查找首个可用的端口作为实际监听端口后，打开对应的浏览器页面 `http://localhost:{实际监听端口}`  \n' +
                '每个 VSCode 窗口会使用端口范围中的一个端口创建 HTTP 服务器，请保证可用端口范围足够大  \n' +
                '修改这个配置后建议重启 VSCode (对于已经创建的本地 HTTP 服务器不会生效)  \n',
                
            en:
                'The available port range of the local HTTP server created in VSCode by this plugin in order to display data such as tables in the browser  \n' +
                'The value is multiple available ports or port ranges separated by commas (no spaces), for example: `8321,8322,8300-8310,11000-11999`  \n' +
                'The default value is `8321-8420` (including left and right boundaries)  \n' +
                'When opening the VSCode window, search the first available port as the actual listening port in order from front to back, and then open the corresponding browser page `http://localhost:{actual-listening-port}`  \n' +
                'Each VSCode window will use a port in the port range to create an HTTP server, please ensure that the available port range is large enough  \n' + 
                'It is recommended to restart VSCode after modifying this configuration (it will not take effect for the local HTTP server that has been created)  \n'
        }
    }
    
    const decimals_property = {
        type: ['number', 'null'],
        default: null,
        description: {
            zh: '小数点后显示的位数 (可取 0 ~ 20)，默认为 null (实际数据的位数)',
            en: 'The number of digits displayed after the decimal point (can be 0 ~ 20), the default is null (the actual number of digits)'
        }
    }
    
    const single_connection_mode = {
        type: 'boolean',
        default: false,
        description: {
            zh: '在左侧的连接面板切换到新的 DolphinDB 连接后自动断开原有连接',
            en: 'Automatically disconnect the original connection after switching to a new DolphinDB connection in the connection panel on the left'
        }
    }
    
    
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
            ... devDependencies
        },
        
        publisher: 'dolphindb',
        
        categories: ['Programming Languages', 'Other', 'Linters', 'Snippets'],
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
                        dark: `${ production ? '.' : '..' }/icons/file.svg`,
                        light: `${ production ? '.' : '..' }/icons/file.svg`,
                    }
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
                            },
                            {
                                name: 'controller1',
                                url: 'ws://127.0.0.1:22210/',
                            },
                            {
                                name: 'datanode1',
                                url: 'ws://127.0.0.1:22214/',
                            },
                            {
                                name: 'datanode2',
                                url: 'ws://127.0.0.1:22215/',
                            },
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
                    },
                    
                    'dolphindb.ports': {
                        ...ports_property,
                        markdownDescription: '%configs.ports.markdownDescription%'
                    } as Schema,
                    
                    'dolphindb.decimals': {
                        ...decimals_property,
                        description: '%configs.decimals.description%'
                    } as Schema,
                    
                    'dolphindb.single_connection_mode': {
                        ...single_connection_mode,
                        description: '%configs.single_connection_mode.description%'
                    } as Schema,
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
            
            viewsContainers: {
                panel: [
                    {
                        id: 'ddbpanel',
                        title: 'DolphinDB',
                        icon: `${ production ? '.' : '..' }/icons/object.svg`,
                    }
                ]
            },
            
            views: {
                explorer: [
                    {
                        id: 'dolphindb.explorer',
                        name: 'dolphindb',
                    }
                ],
                
                ddbpanel: [
                    {
                        type: 'webview',
                        id: 'dolphindb.dataview',
                        name: '%configs.ddbpanel.name%',
                        contextualTitle: 'DolphinDB',
                        icon: `${ production ? '.' : '..' }/icons/object.svg`,
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
                ],
                
                // webview 上方加刷新按钮
                // 在 vscode 源码中搜索 MenuId.ViewTitle 查看相关属性及用法
                'view/title': [
                    {
                        command: 'dolphindb.reload_dataview',
                        group: 'navigation',
                        when: 'view == dolphindb.dataview',
                    },
                    {
                        command: 'dolphindb.open_variable',
                        group: 'navigation',
                        when: 'view == dolphindb.dataview',
                    }
                ],
                
                // 执行按钮
                'editor/title/run': [
                    {
                        when: "editorLangId == 'dolphindb'",
                        command: 'dolphindb.execute_file',
                    },
                    {
                        when: "editorLangId == 'dolphindb'",
                        command: 'dolphindb.execute_selection_or_line'
                    },
                ],
                
                // 上传按钮
                'editor/title': [
                    {
                        when: "editorLangId == 'dolphindb'",
                        command: 'dolphindb.upload_file',
                        group: 'navigation',
                    }
                ],
            },
            
            breakpoints: [{ language: 'dolphindb' }],
            debuggers: [
                {
                    type: 'dolphindb',
                    label: 'dos debug',
                    languages: ['dolphindb'],
                    program: './debugAdapter.cjs',
                    runtime: 'node',
                    configurationAttributes: {
                        launch: {
                            required: ['program'],
                            properties: {
                                program: {
                                    type: 'string',
                                    description: 'Absolute path to a text file.',
                                    default: '${file}',
                                },
                                url: {
                                    type: 'string',
                                    description: 'url of the DolphinDB server',
                                    // default: 'localhost:8848',
                                },
                                username: {
                                    type: 'string',
                                    description: 'username to login the DolphinDB server',
                                    // default: 'admin',
                                },
                                password: {
                                    type: 'string',
                                    description: 'password to login the DolphinDB server',
                                    // default: '123456',
                                },
                                // TODO: 添加更多配置项例如stopOnEntry
                            }
                        }
                    },
                    initialConfigurations: [
                        {
                            name: 'Debug for current file',
                            type: 'dolphindb',
                            request: "launch",
                            program: '${file}',
                        },
                        {
                            name: 'Debug with Server',
                            type: 'dolphindb',
                            request: "launch",
                            program: '${file}',
                            debugServer: 4711,
                        }
                    ]
                }
            ]
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
                    
                    'configs.ports.markdownDescription': ports_property.markdownDescription[language],
                    
                    'configs.decimals.description': decimals_property.description[language],
                    
                    'configs.single_connection_mode.description': single_connection_mode.description[language],
                    
                    'configs.ddbpanel.name': {
                        zh: '数据视图',
                        en: 'DataView'
                    }[language],
                    
                    ... Object.fromEntries(
                        ext_commands.map(({ command, title }) => [`commands.${command}`, r(title, language)])
                    ),
                },
            )
        }),
        
        fwrite(`${fpd_out}package.json`, package_json_)
    ])
}


const ts_resolver = {
    apply (resolver: Resolver) {
        const target = resolver.ensureHook('file')
        
        for (const extension of ['.ts', '.tsx'] as const)
            resolver.getHook('raw-file').tapAsync('ResolveTypescriptPlugin', (request, ctx, callback) => {
                if (
                    typeof request.path !== 'string' ||
                    /(^|[\\/])node_modules($|[\\/])/.test(request.path)
                ) {
                    callback()
                    return
                }
                
                if (request.path.endsWith('.js')) {
                    const path = request.path.slice(0, -3) + extension
                    
                    resolver.doResolve(
                        target,
                        {
                            ...request,
                            path,
                            relativePath: request.relativePath?.replace(/\.js$/, extension)
                        },
                        `using path: ${path}`,
                        ctx,
                        callback
                    )
                } else
                    callback()
            })
    }
}



let dataview_config: Configuration = {
    name: 'DdbDataview',
    
    mode: 'development',
    
    devtool: 'source-map',
    
    context: fpd_root,
    
    entry: {
        'index.js': './dataview/index.tsx',
        'window.js': './dataview/window.tsx',
        'webview.js': './dataview/webview.tsx',
    },
    
    
    experiments: {
        // outputModule: true,
        topLevelAwait: true,
    },
    
    output: {
        path: fpd_out_dataview,
        filename: '[name]',
        publicPath: '/',
        pathinfo: true,
        globalObject: 'globalThis',
    },
    
    target: ['web', 'es2022'],
    
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
        
        plugins: [ts_resolver],
        
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
        // new Webpack.DefinePlugin({
        //     process: { env: { }, argv: [] }
        // })
        
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
        compression: 'brotli'
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
}


export let dataview_webpack = {
    compiler: null as Compiler,
    
    
    async build (production: boolean) {
        if (production) {
            dataview_config.mode = 'production'
            dataview_config.cache = false
        }
        
        this.compiler = Webpack(dataview_config)
        
        await new Promise<Stats>((resolve, reject) => {
            this.compiler.run((error, stats) => {
                if (stats)
                    console.log(
                        stats.toString(dataview_config.stats)
                            .replace(/\n\s*.*DdbDataview.* compiled .*successfully.* in (.*)/, '\nDdbDataview 编译成功，用时 $1'.green)
                    )
                
                if (error)
                    reject(error)
                else if (stats.hasErrors())
                    reject(new Error('dataview 构建失败'))
                else
                    resolve(stats)
            })
        })
        
        await new Promise(resolve => {
            this.compiler.close(resolve)
        })
    }
}


let ext_config: Configuration = {
    name: 'DdbExt',
    
    mode: 'development',
    
    devtool: 'source-map',
    
    context: fpd_root,
    
    entry: {
        'index.cjs': './index.ts',
        'debugAdapter.cjs': './debugAdapter/index.ts',
    },
    
    experiments: {
        topLevelAwait: true,
    },
    
    output: {
        path: `${fpd_root}out/`,
        filename: '[name]',
        pathinfo: true,
        globalObject: 'globalThis',
        library: {
            type: 'commonjs2',
        }
    },
    
    target: ['node19', 'es2022'],
    
    resolve: {
        extensions: ['.js'],
        
        plugins: [ts_resolver]
    },
    
    externals: {
        vscode: 'commonjs2 vscode'
    },
    
    module: {
        parser: {
            javascript: {
                // dynamicImportMode: 'weak',
                import: false,
            }
        },
        
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
                    }
                } as Partial<TSLoaderOptions>
            }
        ]
    },
    
    // plugins: [
    //     new BundleAnalyzerPlugin({
    //         analyzerPort: 8880,
    //         openAnalyzer: false,
    //     }),
    // ],
    
    optimization: {
        minimize: false,
    },
    
    cache: {
        type: 'filesystem',
        compression: 'brotli'
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
}


export const ext_webpack = {
    compiler: null as Compiler,
    
    
    async build (production: boolean) {
        if (production) {
            ext_config.mode = 'production'
            ext_config.cache = false
        }
        
        this.compiler = Webpack(ext_config)
        
        await new Promise<Stats>((resolve, reject) => {
            this.compiler.run((error, stats) => {
                if (stats)
                    console.log(
                        stats.toString(ext_config.stats)
                            .replace(/\n\s*.*DdbExt.* compiled .*successfully.* in (.*)/, '\nDdbExt 编译成功，用时 $1'.green)
                    )
                
                if (error)
                    reject(error)
                else if (stats.hasErrors())
                    reject(new Error('扩展构建失败'))
                else
                    resolve(stats)
            })
        })
        
        await new Promise(resolve => {
            this.compiler.close(resolve)
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
    
    type: 'boolean' | 'number' | 'string' | 'object' | 'array' | ('boolean' | 'number' | 'string' | 'object' | 'array')[]
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

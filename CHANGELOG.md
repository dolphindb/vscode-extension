# Change Log (更新日志)

## v3.0.211 - 2025.04.27
#### 新功能 / New Features
-   新增对 dolphindb.connections 配置项的重名校验，存在同名连接时将会报错。  
    Added check for duplicate connection names in the dolphindb.connections configuration. The system will thrown an exception if connections with the same name exist.  

#### 功能优化 / Enhancement
-   新增 VS Code 版本限制，插件版本：  
    3.0.210 以下​​：要求 ​​VS Code v1.68.0 及以上​；  
    3.0.210​ 及以上​：要求 ​​VS Code v1.82.0​​ 及以上。  
    
    Added version requirements for VS Code:  
    VS Code version v1.68.0 and higher for extension version ​​below 3.0.210​​;  
    ​​VS Code version v1.82.0 and higher for extension version ​​3.0.210 and higher​​​​.  
    
-   优化使用 plot 函数作图时的多 Y 轴展示。  
    Improved the display of multiple Y-axis when plotting line charts with the plot function.  
    
-   优化连接数据库失败的报错信息展示。  
    Improved the display of error messages when failing to connect to databases.  

#### 缺陷修复 / Bug Fixes
-   修复了深色主题下:  
    -  鼠标悬浮在数据预览页面字典数据上方时，字体颜色变黑的展示异常问题。  
    -  使用 plot 函数作饼图时，数值出现异常白色描边的问题。  

    Fixed the following issues in dark theme:  
    -  Text color turned black when hovering over a dictionary in the DOLPHINDB view.  
    -  Unexpected white borders of pie chart values when using the plot function.  

-   修复了键入空格时意外弹出补全提示的问题。  
    Fixed unexpected autocompletion triggered by pressing the spacebar.  

-   修复了无法使用在新窗口查看变量功能的问题。  
    Fixed an issue where the Inspect Variable in New Window feature was not available.  


## v3.0.210
#### 新功能 / New Features
-   为 DolphinDB 脚本编辑提供代码辅助功能：转到定义、自定义函数名和变量名自动补全、模块自动导入等。  
    Added code assistance for DolphinScript editing, supporting jumping to definition, autocompletion for user-defined functions and variable names, automatic module import, and more.

-   变量栏新增刷新按钮，支持刷新变量。  
    Added a refresh button to the VARIABLES view.

-   支持增强安全认证机制，并优化登录功能，以支持更安全的身份验证方式 。  
    Added support for enhanced security authentication and optimized the login feature for a more secure authentication process.

#### 功能优化 / Enhancement
-   完善部分函数的文档提示。  
    Improved documentation hints for some functions.

-   提升包含大量键值对的字典在显示时的性能。  
    Improved the performance of displaying dictionaries containing large amounts of key-value pairs.

#### 功能优化 / Enhancement
-   解决模块上传后导致的变量显示异常的问题。  
    Fixed the issue of variable display anomalies caused by module uploads.

## v3.0.200
#### 新功能 / New Features
-   支持展示分布式表的 iotany 类型的列。  
    Display of IOTANY columns in DFS tables.

-   新增 `dolphindb.show_connection_url` 配置项，支持设置是否在侧连接面板中显示连接的 url 地址。   
    Added `dolphindb.show_connection_url` configuration parameter to toggle connection URL visibility in side panel.


#### 功能优化 / Enhancement
-   更新函数提示文档及链接。  
    Updated documentation links in the function prompt.

-   报错中的行号显示为代码块内的行号。   
    Aligned error line numbers in terminal with Code Editor line numbers.

-   支持高亮 @state, @jit, @transform 等宏  
    Support highlighting of @state, @jit, @transform and other macros


## v3.0.100
#### 新功能 / New Features
-   增加心跳机制，以避免连接长时间不使用后自动断开的情况。  
    Added support for heartbeat mechanism to prevent automatic disconnection due to prolonged inactivity.

-   在调试模式下，支持右键点击变量，并在数据视图中展示变量数据。  
    In debug mode, right-click a variable and select View Variable to display it in data view.

-   支持展示 tensor 类型数据。  
    Added support for displaying tensor data.


#### 功能优化 / Enhancement
-   更新函数提示文档及链接。  
    Updated documentation links in the function prompt.

-   VS Code 插件英文界面中增加错误码编号及对应的文档链接（英文）。  
    Error messages now include error codes and links to relevant documentation.

-   变量栏中的表变量，支持根据表名排序。  
    Tables in the VARIABLES view are now sorted alphabetically by name.

-   增加提示：Python Parser 不支持调试功能（debug）。  
    Added a message indicating that Python Parser is not supported in debugging.

-   未登录状态下，会提示登陆后查看数据库。  
    Added a message reminding users to log in to access the DATABASES view.


## v2.0.1200
#### 新功能 / New Features
-   活动栏（Activity Bar）新增单独的 DolphinDB 数据库管理面板，包含连接、数据库、变量管理三个子面板。  
    Added an icon to Activity Bar,  which contains CONNECTIONS, DATABASES, and VARIABLES views in sidebar.

-   新增数据库管理面板（DATABASE），支持查看数据库及表。  
    Added DATABASE view to check databases and tables. 

-   数据视图栏新增导出表格的图标，支持从 DolphinDB 导出表格到磁盘。该功能要求 server 版本不小于 2.00.11。  
    Added an export icon for the Data Browser, enabling users to export tables to disk. It requires the server version to be 2.00.11 or higher.

#### 功能优化 / Enhancement
-   连接发生错误时，优化显示过长错误信息的内容。  
    Optimized the overly long error message displayed when a connection error occurs. 

-   改进通过 plot 绘图的结果在深色主题下的展示效果。  
    Enhanced the appearance of plots when using dark themes.

## v2.0.1115 - 2024.02.01
#### 新功能 / New Features
-   上传模块时增加两个按钮：“总是加密” 和 “总是不加密”，仅在当前会话中有效，不做持久化保存  
    Added two buttons when uploading a module to choose whether to encrypt the module: `Always` and `Never`. The setting only applies to the current session  

#### 功能优化 / Enhancement
-   调整 http server 的启动策略为仅在用户于新窗口查看变量时启动  
    HTTP server is initiated only when users view variables in a new window  
    
-   将数据视图表头固定到表格顶部，将分页提示信息固定到底部  
    Fixed the table header to the top of the DATAVIEW and the paging information to the bottom when scrolling  
    
-   通过 plot 函数绘图时关闭过渡动画  
    No transition animation when plotting with the plot function  

#### 缺陷修复 / Bug Fixes
-   修复了修改端口配置后无法在新窗口查看变量的问题   
    Fixed the issue where variables could not be viewed in a new window after modifying port configurations  


## v2.0.1110 - 2024.01.19
#### 功能优化 / Enhancement
-   支持交易所日历 duration 类型
    Support exchange calendar duration type
    
#### 缺陷修复 / Bug Fixes
-   修复创建空 list 的时候，数据面板在深色主题下看不清
    Fixed the problem that when creating an empty list, the data panel cannot be seen clearly under the dark theme.

## v2.0.1103 - 2023.12.27
#### 缺陷修复 / Bug Fixes
-   修复了由 plot 函数生成的图表中曲线显示异常的问题
    Fixed the problem of abnormal curve display in charts generated by the plot function

-   修复了在深色主题下 dolphindb 窗口中展示的标量和数对数据字体颜色对比度不足的问题
    Fixed an issue where the font color contrast of scalar and number-pair data displayed in the dolphindb window under the dark theme was insufficient.

## v2.0.1102 - 2023.12.27
#### 新功能 / New Features
-   可查看内存表的表结构  /  Support for displaying the schema of in-memory tables.

#### 功能优化 / Enhancement
-   新增配置导航按钮及文档链接便于用户对未配置 mappings 的连接补充配置。  
    Added navigation buttons and a link to configuration guide for supplementing mappings configuration of dolphindb connections.  
    
-   上传按钮支持上传模块。  
    Support for uploading modules over the Upload button.  
    
-   通过 plot 函数绘制的图表在显示时能够自动适应底部 DATAVIEW 的高度。   
    The charts plotted using the plot function can automatically adapt to the height of the DATAVIEW zone when displayed.   
    
-   支持在浏览器中使用 VS Code 插件。  
    Support using the VS Code plugin in browsers.   

#### 缺陷修复 / Bug Fixes
-   修复了上传文件较多时弹窗框体溢出 VS Code 边界的问题。   
    Fixed the issue of dialog box overflowing the VS Code boundary when uploading a large number of files.  
    
-   修复了选择不加密上传时报错的问题，例如，"uris.map is not a function"。  
    Fixed the issue of unexpected error messages that pop up when selecting non-encrypted upload, for example, "uris.map is not a function".  

-   修复了 plot 函数绘制的图标无法在新窗口打开并报错 “Cannot read properties of null (reading 'inspect')" 的问题。  
    Fixed the issue of being unable to open plot-generated charts in a new window and reporting the error message "Cannot read properties of null (reading 'inspect')".  

-   修复了变量查看界面中向量、字典、矩阵列表中第一个按钮提示文字显示为 “查看表结构" 的问题。  
    Fixed the issue of the tooltip for the first button of vectors, dictionaries, and matrix list items displaying as "View table structure" in the variable explorer.  

## v2.0.1041 - 2023.08.31
-   在 Python Parser 模式中，支持代码注释符 #  
    In Python Parser mode, the code comment character # is supported  
    
-   支持高级函数的语法自动补全，并提供文档链接  
    Supports syntax auto-completion for advanced functions and provides documentation links  
    
-   支持对中文函数名进行高亮显示  
    Supports highlighting of Chinese function names  

## v2.0.900 - 2023.02.09
-   优化连接出现报错的显示信息  
    Enhanced message for connection error. 

-   左侧面板的连接管理中，在连接后面展示成功连接的状态（已连接） 
    Added new label “Connected“ next to the name of established connections in the “DOLPHINDB“ view. 

-   优化右上角运行按钮显示内容  
    Enhanced the layout of buttons for script execution.

-   同步官网用户手册中的函数文档至最新  
    The function documentation popup is now up to date with the DolphinDB official manual online.

-   优化数据视图显示：表格底部显示表的行、列、类型信息；表内容高度溢出时，总是显示水平滚动条  
    “DATAVIEW” view enhancements: (1) column, row and data type information is displayed below each table; (2) enhanced horizontal scroll bar to display full table.

-   DolphinDB 终端被关闭后，再次执行脚本会自动打开  
    Killed DolphinDB terminal will reopen when you run a DolphinDB script again.

-   服务器连接配置为 python 连接增加提示信息  
    Added tooltip for the `python` attribute of the configuration item dolphindb.connections.

-   VSCode 设置中新增 `dolphindb.single_connection_mode` 配置项，用于设置在切换连接时，是否断开原有连接  
    New configuration item `dolphindb.single_connection_mode` for specifying whether the old connection will be closed when you switch to a new one.

-   支持显示 decimal32/64 数据及由其组成的 array vector  
    Support for displaying Decimal32/64 values and array vectors of these two data types.

-   修复终端和数据视图中时间显示不正确的问题  
    Fixed time display issue in the terminal and “DATAVIEW” view.

-   修复 python session 无法取消作业的问题  
    Fixed job cancellation issue in Python sessions.

-   关键字高亮逻辑修改，解决 set(), values() 函数被高亮的问题  
    Enhanced syntax highlighting logic; Fixed highlighting issues with set() and values().


## v2.0.802 - 2022.09.28
-   数据视图（数组、表格、图等）**支持自适应 VSCode 主题颜色**  
    Bottom data view (array, table, graph, etc.) **Supports adaptive VSCode theme colors**

-   底部状态栏新增按钮，显示代码执行状态，且支持点击取消当前执行任务  
    A code execution status bar is added at the bottom to display the execution status and support clicking to cancel the current execution task
    
-   顶部增加按钮支持选择执行选中代码、执行当前行代码或执行整个文件  
    Added buttons at the top to support executing the selected code, executing the current line of code, and executing the entire file
    
-   顶部增加按钮支持上传代码文件到服务器  
    Add a button at the top to support uploading code files to the server
    
-   数值支持千分号（,）分隔，如 `1,000,000,000`  
    Values are displayed separated by commas, such as `1,000,000,000`
    
-   底部状态栏新增小数位数配置栏（配置选项: dolphindb.decimals），支持自定义展示的小数位数，如小数固定显示两位 `1.00`  
    Added a new decimal point configuration column at the bottom (configuration option: dolphindb.decimals), supports custom decimal display digits, such as fixed display with two decimal places `1.00`
    
-   支持词典 (dict) 的可视化展示  
    Visual display of dictionaries is supported

-   关键字、函数提示、函数文档更新  
    Keywords, function hints, function documentation update
    
-   执行代码的输出间隔改为一个空行，使显示更紧凑  
    The output interval of the executed code is changed to a blank line, and the display is more compact
    
-   点击终端中的错误代码（例如 ‘RefId: S00001’） 可跳转至解释文档  
    You can now navigate to the associated documentation by clicking the error code (e.g., 'RefId: S00001').
    
-   数据视图优化了分页显示样式，修复宽度较小时分页选项显示不全的问题，并为新窗口打开等图标增加 tooltip  
    Enhanced pagination design and fixed display issues; Added tooltips (e.g., “Inspect Icons in New Window“) for icon buttons in the DATAVIEW panel.
    
-   修复了画图传入时间列未正确格式化的问题  
    Fixed an issue where the incoming time column in Paint was not formatted correctly


## v2.0.600 - 2022.06.10
-   支持通过 plot 函数绘图  
    Support for plotting through the plot function  

-   表格、向量、图在 VSCode 内可以下方的面板中展示，不依赖浏览器  
    Tables, vectors, and graphs can be displayed in the lower panel in VSCode, independent of the browser  

## v2.0.570 - 2022.04.21
-   增加 dolphindb.ports 配置  
    Add dolphindb.ports configuration

-   动态选择 listen port, 以支持多个 VSCode 窗口  
    Dynamically select listen port to support multiple VSCode windows

-   修复 remote ssh 下端口冲突的问题  
    Fix the problem of port conflict under remote ssh

## v2.0.500 - 2022.04.07
-   更好的代码高亮  
    Better code highlighting

-   函数、关键字、常量代码补全  
    Function, keyword, constant code completion

-   函数文档提示，参数提示  
    Function documentation hints, parameter hints

-   代码执行支持 print 消息  
    Code execution supports print messages

-   优化连接管理、同时支持多个连接  
    Optimized connection management, supports multiple connections at the same time

-   侧边栏会话变量 explorer 重构  
    Sidebar session variable explorer refactoring

-   在浏览器中展示执行结果，并支持数据表、向量的多窗口展示  
    Display the execution results in the browser, and support multi-window display of data tables and vectors

## v0.6.6 - 2019-09-07
* Add right-click menu "Login"

## v0.6.0 - 2019-06-28
* Fix bugs

## v0.5.5 - 2019-06-28
### Improvement
* Improvement of code highlight

### New features
* Support execution of a line by locating the cursor

## v0.5.0 - 2019-06-27
### New features
* Add a `Show` button for checking values of variables in the DolphinDB ENV window  

## v0.4.0 - 2019-06-23
### New features
* Enable autocomplete suggestions 

### Bug fixes
* Fix some code highlight errors

## v0.3.0 - 2019-06-23
### New features
* Support code snippets of common programming constructs

## v0.2.0 - 2019-06-22
### New features
* Enable connections to DolphinDB servers and running DolphinDB script
* Support code highlight
* Support DolphinDB ENV window for the visualization of variables defined

## vUnreleased

* Initial release

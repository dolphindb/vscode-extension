# Change Log (更新日志)
## [2.0.800] - 2022.09.21
-   底部的数据视图（数组、表格、图等）**支持自适应 VSCode 主题颜色**  
    Bottom data view (array, table, graph, etc.) **Supports adaptive VSCode theme colors**

-   支持词典 (dict) 的可视化展示  
    Visual display of dictionaries is supported

-   底部新增代码执行状态栏，显示执行状态，且支持点击取消当前执行任务  
    A code execution status bar is added at the bottom to display the execution status and support clicking to cancel the current execution task

-   顶部增加按钮支持执行选中代码、执行当前行代码、执行整个文件  
    Added buttons at the top to support executing the selected code, executing the current line of code, and executing the entire file

-   顶部增加按钮支持上传代码文件到服务器  
    Add a button at the top to support uploading code files to the server

-   数值显示使用逗号分隔，如 `1,000,000,000`  
    Values are displayed separated by commas, such as `1,000,000,000`

-   底部新增小数点位数配置栏 (配置选项: `dolphindb.decimals`), 支持自定义小数展示位数，如固定显示两位小数 `1.00`
    Added a new decimal point configuration column at the bottom (configuration option: `dolphindb.decimals`), supports custom decimal display digits, such as fixed display with two decimal places `1.00`

-   关键字、函数提示、函数文档更新  
    Keywords, function hints, function documentation update

-   执行代码的输出间隔改为一个空行，显示更紧凑  
    The output interval of the executed code is changed to a blank line, and the display is more compact

-   优化分页样式，增加分页选项，增加新窗口打开等图标悬浮提示  
    Optimize the paging style, add paging options, and add icon floating prompts such as new window opening

-   修复了画图传入时间列未正确格式化的问题  
    Fixed an issue where the incoming time column in Paint was not formatted correctly


## [2.0.600] - 2022.06.10
-   支持通过 plot 函数绘图  
    Support for plotting through the plot function  

-   表格、向量、图在 VSCode 内可以下方的面板中展示，不依赖浏览器  
    Tables, vectors, and graphs can be displayed in the lower panel in VSCode, independent of the browser  

## [2.0.570] - 2022.04.21
-   增加 dolphindb.ports 配置  
    Add dolphindb.ports configuration

-   动态选择 listen port, 以支持多个 VSCode 窗口  
    Dynamically select listen port to support multiple VSCode windows

-   修复 remote ssh 下端口冲突的问题  
    Fix the problem of port conflict under remote ssh

## [2.0.500] - 2022.04.07
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

## [0.6.6] - 2019-09-07
* Add right-click menu "Login"

## [0.6.0] - 2019-06-28
* Fix bugs

## [0.5.5] - 2019-06-28
### Improvement
* Improvement of code highlight

### New features
* Support execution of a line by locating the cursor

## [0.5.0] - 2019-06-27
### New features
* Add a `Show` button for checking values of variables in the DolphinDB ENV window  

## [0.4.0] - 2019-06-23
### New features
* Enable autocomplete suggestions 

### Bug fixes
* Fix some code highlight errors

## [0.3.0] - 2019-06-23
### New features
* Support code snippets of common programming constructs

## [0.2.0] - 2019-06-22
### New features
* Enable connections to DolphinDB servers and running DolphinDB script
* Support code highlight
* Support DolphinDB ENV window for the visualization of variables defined

## [Unreleased]

* Initial release

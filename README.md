# DolphinDB VSCode Extension

<p align='center'>
    <img src='./images/ddb.png' alt='DolphinDB VSCode Extension' width='256'>
</p>

<p align='center'>
    <a href='https://marketplace.visualstudio.com/items?itemName=dolphindb.dolphindb-vscode' target='_blank'>
        <img alt='vscode extension version' src='https://vsmarketplacebadge.apphb.com/version/dolphindb.dolphindb-vscode.svg?style=flat-square&color=39aaf2' />
    </a>
    <a href='https://marketplace.visualstudio.com/items?itemName=dolphindb.dolphindb-vscode' target='_blank'>
        <img alt='vscode extension installs' src='https://vsmarketplacebadge.apphb.com/installs/dolphindb.dolphindb-vscode.svg?style=flat-square&color=39aaf2' />
    </a>
</p>

## English | [中文](./README.zh.md)

VSCode is a lightweight, high-performance and highly extensible code editor developed by Microsoft. It provides a powerful plugin framework, developers can extend the functionality of the VSCode editor by writing extensions, and even support new programming languages.

DolphinDB has developed this VSCode extension for the DolphinDB database, adding support for the self-developed DolphinDB scripting language in VSCode, allowing users to write and execute scripts to operate the database or view the data in the database.

## Features
- Code highlighting
- Code completion for keywords, constants, built-in functions
- Documentation hints, parameter hints for built-in functions
- Execute the code and display the print message and the execution result in the terminal
- Manage multiple database connections in the side panel, showing session variables
- Display data structures such as tables, vectors, matrices, etc. in the browser pop-up window

<img src='./images/demo.png' width='1000'>


## Getting Started
#### 1. Upgrade VSCode to the latest version (above v1.66.0)
https://code.visualstudio.com/


#### 2. Install this extension
Search for dolphindb in the VSCode plugin panel, click install

If the installation fails due to network reasons, you can go to the page below to manually download the plugin with the suffix `.vsix`, and drag it to the VSCode plugin panel after downloading.  
https://marketplace.visualstudio.com/items?itemName=dolphindb.dolphindb-vscode

Click on Version History to download the latest version locally

After installing the plugin, please completely quit all windows of VSCode and reopen VSCode, otherwise you may not be able to view the variables in the browser (see below)

#### 3. View and edit server connection configuration
##### Connections can be viewed in the DOLPhinDB area of the EXPLORER panel on the left side of the VSCode editor
After the plugin is successfully installed, the DOLPHIDB area below will be added to the EXPLORER panel

<img src='./images/connections.png' width='400'>

##### Edit connections
Click `File > Preferences > Settings` in the menu bar or press the shortcut `Ctrl + Comma` to open the VSCode settings  
Enter dolphindb in the search box, click `edit in settings.json` below, and edit the `dolphindb.connections` configuration item in the `settings.json` configuration file jumped to.  
The `dolphindb.connections` configuration item is an array of objects.  
There are four connection configurations by default. You can modify or add connection objects according to the situation.
`name` and `url` attributes are required (different connection objects must have different `name`), by default the admin account is automatically logged in.  
Move the mouse over an attribute to view the description of the corresponding attribute.

#### 4. Open or create a DolphinDB script file
- If the script file name is suffixed with `.dos`, the plugin will automatically recognize the DolphinDB language, and automatically enable syntax highlighting, code completion, and prompts
- If the script file name is not `.dos` suffix, such as `.txt` suffix, you need to manually associate the DolphinDB language, the method is as follows:

Click the language selection button in the status bar in the lower right corner of the VSCode editor, as shown below  
<img src='./images/language-mode.png' width='600'>
Enter `dolphindb` in the language selection pop-up box and press Enter to switch the language associated with the current file to the DolphinDB language  
<img src='./images/select-language.png' width='600'>

#### 5. Press the shortcut key `Ctrl + E` to execute the code
In the opened DolphinDB script file, you can press the shortcut key `Ctrl + E` to send the code to the DolphinDB Server for execution. When the code is executed for the first time, it will automatically connect to the selected connection in the DOLPhinDB area
- If there is currently selected code, the selected code will be sent to DolphinDB Server for execution
- If there is no currently selected code, the line where the current cursor is will be sent to DolphinDB Server for execution

After executing the code, extension will automatically open the page (http://localhost:8321/) in the browser and display the execution result  
There will also be text-based output in the Terminal below the VSCode editor

If you get a connection error (eg: `ws://xxx` errored), make sure that:
- DolphinDB Server version is at least `1.30.16` or `2.00.4`
- If there is a configured system proxy, the proxy software and proxy server need to support WebSocket connections, otherwise please turn off the proxy in the system, or add the DolphinDB Server IP to the exclusion list, and then restart VSCode

(If you need to customize the shortcut keys, you can also modify them in `File > Preferences > Keyboard Shortcuts` in VSCode, enter dolphindb, find `execute`, double-click, and enter the shortcut key you want)

#### 6. Switch connections and view session variables for connections in the DOLPHIDB area of the EXPLORER panel on the left side of the VSCode editor

As shown in the figure below, it has the following functions:
- Switch the connection used to execute the code (the original connection will not be disconnected)
- Click the button to the right of the connection to manually disconnect
- View the value of the session variable
- Variables other than scalar, pair have two icons to the right
    - Click the icon on the left to view the variables in the browser page http://localhost:8321/
    - Click the icon on the right to directly open a browser pop-up window and view the variables in the pop-up window (you need to configure the browser to allow the pop-up window, see later)

<img src='./images/explorer.png' width='400'>

##### Please configure your browser to allow this website to display pop-ups  
<img src='./images/allow-browser-popup.png' width='600'>

#### 7. Expand function documentation
When entering a DolphinDB built-in function in the VSCode editor, click the arrow to the right of the function to expand the function's documentation

<img src='./images/expand-doc.png' width='800'>

After the function input is complete, hover the mouse over the function name to view the function documentation

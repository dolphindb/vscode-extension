# DolphinDB VSCode Extension

<p align='center'>
    <img src='./images/ddb.png' alt='DolphinDB VSCode Extension' width='256'>
</p>

<p align='center'>
    <a href='https://marketplace.visualstudio.com/items?itemName=dolphindb.dolphindb-vscode' target='_blank'>
        <img alt='vscode extension version' src='https://vsmarketplacebadge.apphb.com/version/dolphindb.dolphindb-vscode.svg?style=flat-square&color=39aaf2&refresh' />
    </a>
    <a href='https://marketplace.visualstudio.com/items?itemName=dolphindb-vscode' target='_blank'>
        <img alt='vscode extension installs' src='https://vsmarketplacebadge.apphb.com/installs/dolphindb.dolphindb-vscode.svg?style=flat-square&color=39aaf2' />
    </a>
</p>

## English | [中文](./README.zh.md)

## Getting Started
#### 1. Upgrade VSCode to the latest version (above v1.66.0)
https://code.visualstudio.com/


#### 2. Install this extension
Search for dolphindb in the VSCode plugin panel, click install

If the installation fails due to network reasons, you can go to the page below to manually download the plugin with the suffix `.vsix`, and drag it to the VSCode plugin panel after downloading.  
https://marketplace.visualstudio.com/items?itemName=dolphindb.dolphindb-vscode

Click on Version History to download the latest version locally


#### 3. Edit server connection configuration
Click `File > Preferences > Settings` in the menu bar or press the shortcut `ctrl + ,` to open the VSCode settings  
Enter dolphindb in the search box, click `edit in settings.json` below, and edit the `dolphindb.connections` configuration item in the `settings.json` configuration file jumped to  
The `dolphindb.connections` configuration item is an array of objects. There is a `local8848` connection configuration by default. You can modify or add connection objects according to the situation. Different connection objects must have different `name`  

#### 4. Open or create a DolphinDB script file
- If the script file name is suffixed with `.dos`, the plugin will automatically recognize the DolphinDB language, and automatically enable syntax highlighting, code completion, and prompts
- If the script file name is suffixed with `.txt`, you need to manually associate the DolphinDB language, the method is as follows:

Click the language selection button in the status bar in the lower right corner of the VSCode editor, as shown below  
![](./images/language-mode.png)

Enter `dolphindb` in the language selection pop-up box and press Enter to switch the language associated with the current file to the DolphinDB language  
![](./images/select-language.png)

#### 5. Press the shortcut key `ctrl + e` to execute the code
- If there is currently selected code, the selected code will be sent to DolphinDB Server for execution
- If there is no currently selected code, the line where the current cursor is will be sent to DolphinDB Server for execution

(If you need to customize the shortcut keys, you can also modify them in `File > Preferences > Keyboard Shortcuts` in VSCode, enter dolphindb, find `execute`, double-click, and enter the shortcut key you want)

After executing the code, extension will automatically open the page (http://localhost:8321/) in the browser and display the execution result  
There will also be text-based output in the Terminal below the VSCode editor

If you can't connect to the server with an error, please check:
- DolphinDB Server version cannot be lower than `1.30.16` or `2.00.4`
- Whether the system proxy is turned on, some proxies do not support WebSocket connection, please close it in the system, or exclude the corresponding IP, and then restart VSCode)

#### 6. Switch connections and view session variables in the DOLPHINDB area of ​​the left panel of the VSCode editor

As shown in the figure below, it has the following functions:
- Switch the connection used to execute the code (the original connection will not be disconnected)
- Click the button to the right of the connection to manually disconnect
- View the value of the session variable
- There are two icons on the right side of the variable, click the icon on the left to view the variable in the browser page http://localhost:8321/, click the icon on the right to directly open a browser pop-up window, and view the variable in the pop-up window

![](./images/explorer.png)

Please configure your browser to allow this website to display pop-ups  
![](./images/allow-browser-popup.png)

#### 7. Expand function documentation
![](./images/expand-doc.png)

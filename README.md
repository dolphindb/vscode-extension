# DolphinDB Support for VS Code

The DolpinDB extension makes it easy to work with DolphinDB statements. With this extension, you can:

* Connect to local or remote servers
* Execute scripts and see results directly in VS Code
* Create and view basic data forms in the DolphinDB ENV window

## Prerequisites

[Install DolphinDB](https://www.dolphindb.cn/downloads.html) and [deploy a cluster](https://github.com/dolphindb/Tutorials_CN/blob/master/dolphindb_user_guide.md).

## Features

* Highlight keywords, functions names, commands etc.
* Autocomplete suggestions
* Code snippets of common programming constructs
* Run DolphinDB script

## Usages

* Create a txt file and right click on blank areas to add, remove or choose a server.
  * Typical connection string for instance:
  `local8920:192.168.1.103:8920`

* Press `CTRL+E` to execute a single line of code by locating the cursor or multiple lines of code by selecting the lines.

* Press `CTRL+SHIFT+P` and select the option 'DolphinDB: Helper' for links of more useful documentations.

* Open the DolphinDB ENV window and expand the data forms (eg. scalar, pair, set) to see the variables defined in the datanode.

* Click the button `Show` on the right side of a variable to check its value in the OUTPUT window.

## Issues

We are open to all ideas and we want to get rid of bugs! Use the [Issues](https://github.com/yjhmelody/vscode-dolphindb-extension/issues) section to either report a new issue, provide your ideas or contribute to existing threads.

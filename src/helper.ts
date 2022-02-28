import * as open from 'open'
import * as vscode from 'vscode'

const PAGES = [
    { name: 'Document CN', url: 'https://www.dolphindb.cn/cn/help/index.html' },
    { name: 'Document EN', url: 'https://www.dolphindb.cn/en/help/index.html' },
    { name: 'Tutorials CN', url: 'https://github.com/dolphindb/Tutorials_CN' },
    { name: 'Tutorials EN', url: 'https://github.com/dolphindb/Tutorials_EN' },
    { name: 'DolphinDB Github', url: 'https://github.com/dolphindb/' }
]

export async function dolphindbHelper () {
    vscode.window.showQuickPick(PAGES.map(({ name, url }) => name + ': ' + url)).then(page => {
        if (page === undefined) 
            return
        
        let url = page.split(': ')[1]
        // @ts-ignore
        open(url)
    })
}

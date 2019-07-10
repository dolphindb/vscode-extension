// Copyright 2019 dolphindb
// author: yjhmelody
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
//     http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as open from 'open'
import * as vscode from 'vscode'

const PAGES = [
    { name: 'Document CN', url: 'https://www.dolphindb.cn/cn/help/index.html' },
    { name: 'Document EN', url: 'https://www.dolphindb.cn/en/help/index.html' },
    { name: 'Tutorials CN', url: 'https://github.com/dolphindb/Tutorials_CN' },
    { name: 'Tutorials EN', url: 'https://github.com/dolphindb/Tutorials_EN' },
    { name: 'DolphinDB Github', url: "https://github.com/dolphindb/" }
]

export async function dolphindbHelper() {
    vscode.window.showQuickPick(PAGES.map(({ name, url }) => name + ': ' + url))
        .then((page) => {
            if (page === undefined) {
                return
            }
            let url = page.split(': ')[1]
            open(url)
        })
}
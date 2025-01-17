import * as cp from 'child_process'

import { builder } from './builder.ts'


await builder.build(true)
await new Promise(resolve => {
    cp.exec('npm run build-languageserver', (error, stdout, stderr) => {
        if (error) {
            console.error(error)
            resolve(false)
        } else {
            console.log(stdout)
            resolve(true)
        }
    })
})
await builder.close()

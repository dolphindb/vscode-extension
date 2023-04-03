#!/usr/bin/env node

import { fcopy, fdelete, fmkdir } from 'xshell'
import { fpd_out, build_tm_language, copy_files, build_package_json, dataview_webpack, ext_webpack, fpd_out_dataview, fpd_root } from './webpack.js'

const production = process.argv.includes('--production')

if (production)
    await fdelete(fpd_out)

await fmkdir(fpd_out_dataview)

await Promise.all([
    production ? copy_files() : null,
    (async () => {
        if (!production)
            await fcopy(`${fpd_root}icons/`, `${fpd_out}icons/`)
    })(),
    build_package_json(production),
    build_tm_language(),
    dataview_webpack.build(production),
    ext_webpack.build(production)
])

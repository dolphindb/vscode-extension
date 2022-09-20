#!/usr/bin/env node

import { fdelete, fmkdir } from 'xshell'
import { fpd_out, build_tm_language, copy_files, build_package_json, dataview_webpack, ext_webpack, fpd_out_dataview } from './webpack.js'

const production = process.argv.includes('--production')

if (production)
    await fdelete(fpd_out)

await fmkdir(fpd_out_dataview)

await Promise.all([
    copy_files(),
    build_package_json(),
    build_tm_language(),
    dataview_webpack.build(production),
    ext_webpack.build(production)
])

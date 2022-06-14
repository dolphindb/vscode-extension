#!/usr/bin/env node

import { fmkdir } from 'xshell'
import { build_tm_language, copy_files, build_package_json, dataview_webpack, ext_webpack, fpd_out_dataview } from './webpack.js'

await fmkdir(fpd_out_dataview)

await Promise.all([
    copy_files(),
    build_package_json(),
    build_tm_language(),
    dataview_webpack.start(),
    ext_webpack.start()
])

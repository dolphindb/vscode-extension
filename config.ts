import path from 'upath'

export const fpd_ext = `${path.normalize(__dirname)}/`

export const fpd_out = `${fpd_ext}out/` as const

export const vendors = {
    'react.production.min.js': 'react/umd/react.production.min.js',
    'react-dom.production.min.js': 'react-dom/umd/react-dom.production.min.js',
    
    'antd.css': 'antd/dist/antd.css',
    'antd.js': 'antd/dist/antd.js',
}

// 这个文件在构建流程和实际插件中都会用到

export function get_vendors (dev: boolean) {
    return [
        `react/umd/react.${ dev ? 'development' : 'production.min' }.js`,
        `react-dom/umd/react-dom.${ dev ? 'development' : 'production.min' }.js`,
        'dayjs/dayjs.min.js',
        `lodash/lodash${ dev ? '' : '.min' }.js`,
        `antd/dist/antd${ dev ? '' : '.min' }.js`,
        `antd/dist/antd${ dev ? '' : '.min' }.js.map`,
        '@ant-design/icons/dist/index.umd.min.js',
        '@ant-design/plots/dist/plots.min.js',
        '@ant-design/plots/dist/plots.min.js.map',
    ]
}

import { theme, type ThemeConfig } from 'antd'


export const primary_color = '#6774bd' as const

export const dark_background = '#282828' as const

const common_config: ThemeConfig = {
    hashed: false
}

const common_tokens: ThemeConfig['token'] = {
    motion: false,
    borderRadius: 0,
    controlOutlineWidth: 0,
}


const tabs: ThemeConfig['components']['Tabs'] = {
    horizontalMargin: '0px 0px 8px 0px'
}


export const light: ThemeConfig = {
    ...common_config,
    token: {
        ...common_tokens,
        colorPrimary: primary_color,
        colorError: '#ff4d4f',
        colorLink: primary_color,
        colorInfo: primary_color,
        colorBgLayout: '#f9f9fb',
        colorTextDisabled: '#000000a0',
        colorTextPlaceholder: '#00000070'
    },
    components: {
        Table: {
            headerBg: '#f9f9fb',
            rowSelectedBg: '#ebf0fa',
            headerColor: '#666e7d',
            colorText: '#000000',
            cellPaddingBlock: 10,
            
            bodySortBg: 'unset',
            headerSortActiveBg: '#f9f9fb',
        },
        Segmented: {
            // itemSelectedBg: light_primary_color,
            itemSelectedColor: primary_color,
            // trackBg: '#f9f9fb',
            trackPadding: 4
        },
        Tabs: tabs
    }
}


export const dark: ThemeConfig = {
    ...common_config,
    token: {
        ...common_tokens,
        colorPrimary: primary_color,
        colorBgContainer: dark_background,
        colorBgElevated: '#555555',
        colorInfoActive: '#4093d3',
        colorBgLayout: '#313131',
        colorTextDisabled: '#ffffff60',
        colorTextPlaceholder: '#ffffff70'
    },
    algorithm: theme.darkAlgorithm,
    components: {
        Table: {
            headerBg: '#313131',
            headerColor: '#ffffff',
            colorText: '#ffffff',
            cellPaddingBlock: 10
        },
        Segmented: {
            itemSelectedColor: primary_color,
            itemSelectedBg: '#313131',
            trackPadding: 4
        },
        Tabs: tabs
    }
}

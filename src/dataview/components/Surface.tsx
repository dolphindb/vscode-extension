import './Surface.sass'

import { useEffect, useRef } from 'react'

import { use_size } from 'react-object-model/hooks.js'

import { delay, load_script } from 'xshell/utils.browser.js'

import { dark_background } from '@theme'


let Plotly: typeof import('plotly.js-dist-min')


export function Surface ({
    data,
    options,
    assets_root
}: {
    // 每个子数组 y 不同，x 相同 (行优先)
    data: number[][]
    options: SurfaceOptions
    assets_root: string
}) {
    let rdiv = useRef<HTMLDivElement>(undefined)
    
    let size = use_size(rdiv)
    
    let rinited = useRef<boolean>(false)
    
    
    useEffect(() => {
        let { current: div } = rdiv
        
        ;(async () => {
            const pdelay = delay(100)
            
            if (!Plotly) {
                await load_script(`${assets_root}vendors/plotly.js-dist-min/plotly.min.js`)
                ;({ default: Plotly } = await import('plotly.js-dist-min'))
            }
            
            await pdelay
            
            Plotly.newPlot(
                div,
                get_data(data),
                get_layout(
                    { width: div.clientWidth, height: div.clientHeight },
                    options))
            
            rinited.current = true
        })()
        
        return () => { Plotly?.purge(div) }
    }, [ ])
    
    
    useEffect(() => {
        if (!rinited.current || !size)
            return
        
        Plotly.react(
            rdiv.current,
            get_data(data),
            get_layout(size, options))
    }, [size, options, data])
    
    return <div className='surface-chart' ref={rdiv} />
}


function get_data (data: any) {
    return [{
        type: 'surface',
        z: data
    }] satisfies Plotly.Data[]
}


function get_layout (
    { width, height }: { width: number, height: number },
    options: SurfaceOptions
): Partial<Plotly.Layout> {
    const { title, title_size, font, dark } = options
    
    return {
        width,
        height,
        
        title: {
            yanchor: 'top',
            y: 5,
            text: title,
            font: {
                color: dark ? '#ffffff' : undefined,
                size: title_size || 16,
            }
        },
        
        scene: Object.fromEntries(
            axises.map(a => {
                const axis = `${a}axis`
                
                return [axis, {
                    title: { text: options[axis] || a },
                    gridcolor: '#888888'
                } satisfies Partial<Plotly.SceneAxis>]
            })),
        
        margin: {
            l: 0,
            r: 0,
            b: 0,
            t: title ? 35 : 0
        },
        
        ... dark ? {
            paper_bgcolor: dark_background, // 图表外部背景
            plot_bgcolor: dark_background, // 绘图区域背景
        } : { },
        font: {
            // 默认文字颜色
            color: dark ? '#ffffff' : undefined,
            family: font || undefined
        }
    }
}


export interface SurfaceOptions {
    title?: string
    title_size?: number
    
    xaxis?: string
    yaxis?: string
    zaxis?: string
    
    font?: string
    dark: boolean
}


export const axises = ['x', 'y', 'z'] as const

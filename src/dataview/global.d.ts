declare module '*.icon.svg' {
    const icon: import('react').ComponentType<CustomIconComponentProps | import('react').SVGProps<SVGSVGElement>>
    
    // eslint-disable-next-line
    export default icon
}

declare module '*.svg' {
    const text: string
    
    // eslint-disable-next-line
    export default text
}

interface Window {
    model?: import('react-object-model').Model<any>
}

declare const EXTENSION_VERSION: string

declare const PRODUCTION: boolean

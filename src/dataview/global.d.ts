declare module '*.icon.svg' {
    const icon: import('react').ComponentType<CustomIconComponentProps | import('react').SVGProps<SVGSVGElement>>
    export default icon
}

declare module '*.svg' {
    const text: string
    export default text
}

interface Window {
    model?: import('react-object-model').Model<any>
}

declare const EXTENSION_VERSION: string

declare const PRODUCTION: boolean

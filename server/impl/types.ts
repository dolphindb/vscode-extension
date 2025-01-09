export interface DdbModule {
    filePath: string
    moduleName: string
}

export interface DdbUri {
    external: string
    path: string
    scheme: 'file'
} 

import * as _ from 'lodash/fp'
import { VariableInfo } from './env'

export interface IConfig {
    name: string
    ip: string
    port: number
}

export interface DolphindbContext {
    sessionID: string
    currentCfg: IConfig
    defaultCfg: IConfig
    ENV: Map<string, VariableInfo[]>
}

const defaultCfg: IConfig = {
    name: 'default',
    ip: '127.0.0.1',
    port: 8848
}

export const context: DolphindbContext = {
    sessionID: '0',
    currentCfg: _.cloneDeep(defaultCfg),
    defaultCfg,
    ENV: new Map<string, VariableInfo[]>()
}

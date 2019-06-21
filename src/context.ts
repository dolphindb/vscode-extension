// Copyright 2019 yjhmelody
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
//     http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as _ from 'lodash/fp'
import { VariableInfo } from './env';

export interface IConfig {
    name: string,
    ip: string,
    port: number
}

export interface DolphindbContext {
    sessionID: string,
    currentCfg: IConfig,
    defaultCfg: IConfig,
    ENV: Map<string, VariableInfo[]>,
}

const defaultCfg: IConfig = {
    name: 'default',
    ip: '127.0.0.1',
    port: 8848,
}

export const context: DolphindbContext = {
    sessionID: '0',
    currentCfg: _.cloneDeep(defaultCfg),
    defaultCfg,
    ENV: new Map<string, VariableInfo[]>(),
}
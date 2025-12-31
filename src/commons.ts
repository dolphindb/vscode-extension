export const pyobjs = new Set(['list', 'tuple', 'dict', 'set', '_ddb', 'Exception', 'AssertRaise', 'PyBox'])


export enum LicenseTypes {
    /** 其他方式 */
    Other = 0,
    
    /** 机器指纹绑定 */
    MachineFingerprintBind = 1,
    
    /** 在线验证 */
    OnlineVerify = 2,
    
    /** LicenseServer 验证 */
    LicenseServerVerify = 3
}


export interface DdbLicense {
    authorization: string
    licenseType: LicenseTypes
    maxMemoryPerNode: number
    maxCoresPerNode: number
    clientName: string
    bindCPU: boolean
    expiration: number
    maxNodes: number
    version: string
    modules: bigint
}


export enum NodeType {
    data = 0,
    agent = 1,
    controller = 2,
    single = 3,
    computing = 4
}


export enum DdbNodeState {
    offline = 0,
    online = 1
}


export interface DdbNode {
    name: string
    state: DdbNodeState
    mode: NodeType
    host: string
    port: number
    site: string
    agentSite: string
    maxConnections: number
    maxMemSize: number
    workerNum: number
    /** @deprecated server 2.00.10 后没有 local executor，此项一直为零 */
    executorNum: number
    connectionNum: number
    memoryUsed: bigint
    memoryAlloc: bigint
    diskReadRate: bigint
    diskWriteRate: bigint
    networkRecvRate: bigint
    networkSendRate: bigint
    
    cpuUsage: number
    avgLoad: number
    
    queuedJobs: number
    queuedTasks: number
    runningJobs: number
    runningTasks: number
    
    jobLoad: number
    
    // 下面这些统计时间都不准确，和 timer 结果不一致，不要使用
    // ex1 = table(rand(1.0000,10000000) as c1)
    // timer select count(*) from ex1 where c1 > 0.5 and c1 <=0.8
    // 执行十次后，实际执行时间和返回的不一致
    // 目前发现这两种不会统计
    // 1. 不含 join 的内存表查询
    // 2. SINGLE 模式，使用 snapshot 的查询
    /** 单位 ns */
    medLast10QueryTime: bigint
    maxLast10QueryTime: bigint
    medLast100QueryTime: bigint
    maxLast100QueryTime: bigint
    maxRunningQueryTime: bigint
    
    diskCapacity: bigint
    diskFreeSpace: bigint
    diskFreeSpaceRatio: number
    
    lastMinuteWriteVolume: bigint
    lastMinuteReadVolume: bigint
    
    lastMinuteNetworkSend: bigint
    lastMinuteNetworkRecv: bigint
    
    lastMsgLatency: bigint
    cumMsgLatency: bigint
    
    publicName: string
    
    isLeader: boolean
    
    // ... 省略了一些
}


export const table_actions = ['select', 'update', 'delete', 'truncate', 'load', 'schema'] as const
export const orca_table_actions = ['select', 'update', 'delete', 'schema'] as const

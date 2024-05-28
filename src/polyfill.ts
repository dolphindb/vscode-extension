if (!Promise.withResolvers)
    Promise.withResolvers = function PromiseWithResolvers () {
        let resolve: any, reject: any
        let promise = new Promise((_resolve, _reject) => {
            resolve = _resolve
            reject = _reject
        })
        return { promise, resolve, reject }
    } as any

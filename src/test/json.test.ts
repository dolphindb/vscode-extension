import * as assert from 'assert';
import * as api from '../api';

const ip = '127.0.0.1'
const port = 8848
const enableSSL = true

describe('HTTP JSON', function () {
    it('should be synyax error', async function () {
        let { data } = await api.executeCode(ip, port, 'a =','0' , enableSSL)
        assert.equal(data.resultCode, 1)
        assert.equal(data.userId, 'admin')
        assert(data.msg.startsWith('Syntax Error'))
    })

    it('should be ok', async function () {
        let { data } = await api.executeCode(ip, port, `
            cfg = dict(STRING, ANY)
            cfg["metadata.broker.list"] = "localhost"
            cfg
            `, '0', enableSSL)
        assert.equal(data.resultCode, 0)
        assert.equal(data.userId, 'admin')
        assert(!data.msg.startsWith('Syntax Error'))
    })

    it('should be same sessionID', async function () {
        let { data: data1 } = await api.executeCode(ip, port, 'a = 1', '0', enableSSL)
        let json1 = new api.DolphindbJson(data1)
        let sessionId1 = json1.sessionID()

        let {data: data2} = await api.executeCode(ip, port, 'a = 2', sessionId1, enableSSL)
        let json2 = new api.DolphindbJson(data2)
        let sessionId2 = json2.sessionID()

        assert.equal(sessionId1, sessionId2)
    })

    it('should fetch env', async function () {
        let { data } = await api.fetchEnv(ip, port, '0', enableSSL)
    })
})



describe('test data type', function () {
    it('test scalar', async function () {
        let { data } = await api.executeCode(ip, port, '2012.06.13 13:30:10.008', '0', enableSSL)
        let json = new api.DolphindbJson(data)
        data = json.toScalar()
        assert.equal(data, '2012.06.13 13:30:10.008')
    })

    it('test vector', async function () {
        let { data } = await api.executeCode(ip, port, '1 2 3', '0', enableSSL)
        let json = new api.DolphindbJson(data)
        data = json.toVector()
        assert.equal(data[0], 1)
        assert.equal(data[1], 2)
        assert.equal(data[2], 3)
    })

    it('test table', async function () {
        let { data } = await api.executeCode(ip, port, 'table( 1 2 3 as id, 2019.01M 2019.02M 2019.03M as m)', '0', enableSSL)
        let json = new api.DolphindbJson(data)
        data = json.toTable().table
        assert.equal(data.length, 3)
        assert.equal(data[0].length, 2)
        assert.equal(data[0][0], 1)
    })

    it('test matrix', async function () {
        let { data } = await api.executeCode(ip, port, 'matrix(table(1 2 3 as id, 4.12345 2.0 3.0 as value));', '0', enableSSL)
        let json = new api.DolphindbJson(data)
        data = json.toMatrix().matrix
        assert.equal(data.length, 3)
        assert.equal(data[0].length, 2)
        assert.equal(data[0][0], 1)
    })

    it('test set', async function () {
        let { data } = await api.executeCode(ip, port, 'set(1 2 3 as id)', '0', enableSSL)
        let json = new api.DolphindbJson(data)
        data = json.toSet()
        assert(data.has(1))
        assert(data.has(2))
        assert(data.has(3))
    })

    it('test pair', async function () {
        let { data } = await api.executeCode(ip, port, '10:20', '0', enableSSL)
        let json = new api.DolphindbJson(data)
        data = json.toPair()
        assert.equal(data[0], 10)
        assert.equal(data[1], 20)
    })

    it('test dict', async function () {
        let { data } = await api.executeCode(ip, port, 'dict( 1 2 3 as id, `a`b`c as name)', '0', enableSSL)
        let json = new api.DolphindbJson(data)
        data = json.toDict()
        assert.equal(data.get(1), '"a"')
        assert.equal(data.get(2), '"b"')
        assert.equal(data.get(3), '"c"')
    })
})

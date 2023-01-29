/*
	整个Debug的启动流程是这样的：
	1. ddb vsc插件在初始化(activate)时会调用activate.ts中的 `activateDebug` 注册一个debug configuration provider
	2. 用户启动debug模式时，这个provider会首先修改launch配置，从插件处获取当前连接的数据库url
	3. 在这个文件下调用 `runDebugAdapter`，创建一个debugSession(adapter)
	4. 在debugSession中，vsc会依次调用initialize、launch、setBreakpoints、configurationDone等，
		这个过程中会连接服务端，并把用户脚本和断点情况发送过去，服务端验证断点返回，vsc等待用户下一步操作
*/
import { MockDebugSession } from './mock/mockDebug.js';
import * as Net from 'net';
import { Remote } from './network.js';

function runDebugAdapter(debugSession: typeof MockDebugSession) {
	let port = 0;
	const args = process.argv.slice(2);
	args.forEach((val) => {
		const portMatch = /^--server=(\d{4,5})$/.exec(val);
		if (portMatch) {
			port = parseInt(portMatch[1], 10);
		}
	});

	if (port > 0) {
		// DA跑在本地server以调试DA
		console.error(`waiting for debug protocol on port ${port}`);
		Net.createServer((socket) => {
			console.error('>> accepted connection from client');
			socket.on('end', () => {
				console.error('>> client connection closed\n');
			});
			const session = new debugSession();
			session.setRunAsServer(true);
			session.start(socket, socket);
		}).listen(port);
	} else {
		const session = new debugSession();
		process.on('SIGTERM', () => {
			session.shutdown();
		});
		session.start(process.stdin, process.stdout);
	}
}

console.log(Remote.pack({
	data: { username: 'admin', password: 'admin' },
	id: 0,
	func: ''
}));

runDebugAdapter(MockDebugSession);
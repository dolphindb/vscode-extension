/*
	整个Debug的启动流程是这样的：
	1. ddb-vsc插件在初始化(activate)时会调用activate.ts中的 `activateDebug` 注册一个debug configuration provider
	2. 用户启动debug会话时，这个provider会首先从插件处获取当前连接的数据库url，动态修改用户launch配置
	3. 这个文件下的 `runDebugAdapter` 被调用，创建一个debugSession(adapter)
	4. 在debugSession中，vsc会依次调用initialize、launch、setBreakpoints、configurationDone等，
		这个过程中会连接服务端，并把用户脚本和断点情况发送过去，服务端验证断点返回，执行到第一个断点处，vsc等待用户下一步操作
*/
import { DdbDebugSession } from './adapter.js';
import * as Net from 'net';

function runDebugAdapter(debugSession: typeof DdbDebugSession) {
  let port = 0;
  const args = process.argv.slice(2);
  args.forEach((val) => {
    const portMatch = /^--server=(\d{4,5})$/.exec(val);
    if (portMatch) {
      port = parseInt(portMatch[1], 10);
    }
  });

  if (port > 0) {
    // 在指定的端口开一个server，用于调试调试器 (sampleWorkapsce: launch.json: debugServer配置项)
    console.debug(`waiting for debug protocol on port ${port}`);
    Net.createServer((socket) => {
      console.debug('>> accepted connection from client');
      socket.on('end', () => {
        console.debug('>> client connection closed\n');
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

runDebugAdapter(DdbDebugSession);

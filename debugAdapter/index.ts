import { MockDebugSession } from './mock/mockDebug.js';
import * as Net from 'net';
import { promises as fs } from 'fs';

export interface FileAccessor {
	isWindows: boolean;
	readFile(path: string): Promise<Uint8Array>;
	writeFile(path: string, contents: Uint8Array): Promise<void>;
}

const fsAccessor: FileAccessor = {
	isWindows: process.platform === 'win32',
	readFile(path: string): Promise<Uint8Array> {
		return fs.readFile(path);
	},
	writeFile(path: string, contents: Uint8Array): Promise<void> {
		return fs.writeFile(path, contents);
	}
};

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
			const session = new debugSession(fsAccessor);
			session.setRunAsServer(true);
			session.start(socket, socket);
		}).listen(port);
	} else {
		const session = new debugSession(fsAccessor);
		process.on('SIGTERM', () => {
			session.shutdown();
		});
		session.start(process.stdin, process.stdout);
	}
}

runDebugAdapter(MockDebugSession);
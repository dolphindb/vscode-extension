import { WebSocket, connect_websocket, inspect } from 'xshell';
import { json2DdbDict } from './utils.js';
import { DdbDict, DdbObj } from 'dolphindb';

const decoder = new TextDecoder();

/** 三种传输（client发送，server返回，server主动推送）中所用的message类型 */
export interface Message {
  /**
   * rpc id: 在 rpc 系统中认为是唯一的。
   * 用来在单个 websocket 连接上复用多个 rpc 请求。多个相同 id 的 message 组成一个请求流。
   * 对于client发起的rpc，server返回时附带id用于区分是哪个rpc的返回。
   */
  id?: number;

  /** 由client发起时标识调用的函数名称 */
  func?: string;

  /** 由server主动推送时标识事件名称 */
  event?: string;

  /** 传输时的数据内容，由client发出时包装成DdbDict */
  data?: any;

  /** 状态信息 */
  message?: string;
}

export interface SendMessage extends Message {
  id: number;

  func: string;

  data?: DdbDict;
}

export interface ReturnMessage extends Message {
  id: number;
}

export interface EventMessage extends Message {
  event: string;
}

export type ReceiveMessage = (ReturnMessage | EventMessage) & {
  message: string;
};

/** 接收到消息后的处理函数，包含client发出请求的返回以及server主动推送的事件 */
export type MessageHandler = (
  msg: ReceiveMessage,
  websocket?: WebSocket
) => void | any[] | Promise<void | any[]>;

/**
 * 对socket的一层封装，创建时传入username&password，调用函数时自动登录
 * call用来调用server端的函数，on用来注册处理server端事件的回调
 */
export class Remote {
  private static id = 0;

  static get nextId() {
    return Remote.id++;
  }

  private websocket?: Awaited<ReturnType<typeof connect_websocket>>;

  /** 处理server侧主动推送的事件的回调 */
  private events = new Map<string, MessageHandler>();

  /** map<id, message handler>: 通过 rpc message.id 找到对应的 handler */
  private handlers = new Map<number, MessageHandler>();

  /** debug会话不在开启状态时禁止发送请求 */
  private _terminated = false;
  public terminate() {
    this._terminated = true;
    this.websocket?.close();
  }

  constructor(
    private url: string,
    private username: string,
    private password: string
  ) {}

  get connected() {
    return this.websocket?.readyState === WebSocket.OPEN;
  }

  /** call之前将参数打包成DdbDist */
  public static pack(msg: SendMessage) {
    return json2DdbDict(msg).pack();
  }

  /**
   * 接收服务端消息并处理，一般是4字节jsonLength + json
   * 若为查看变量之类的消息，json中由offset标识ddb内置类型对应二进制位置
   * 此时调用js-api中的方法解析这段二进制数据并inspect成可供用户查看的格式
   */
  public static parse(array_buffer: ArrayBuffer) {
    try {
      const buf = new Uint8Array(array_buffer);
      const dv = new DataView(array_buffer);

      const jsonLength = dv.getUint32(0, true);
      let baseOffset = 4 + jsonLength;

      // TODO: 错误处理（对后端数据校验）
      let msg = JSON.parse(decoder.decode(buf.subarray(4, baseOffset)));

      console.debug('Receive message: ', msg);

      // 仅查询scope或单变量时会出现offset
      if (msg?.data instanceof Array) {
        msg.data.forEach((item: any) => {
          if (item.offset) {
            item.binValue = buf.subarray(baseOffset, baseOffset + item.offset);
            item.ddbValue = DdbObj.parse(item.binValue, true);
            item.value = inspect(item.ddbValue);
            baseOffset += item.offset;
          }
        });
      } else if (msg?.data?.offset) {
        msg.data.binValue = buf.subarray(
          baseOffset,
          baseOffset + msg.data.offset
        );
        msg.data.ddbValue = DdbObj.parse(msg.data.binValue, true);
        msg.data.value = inspect(msg.data.ddbValue);
      }

      return msg;
    } catch (error) {
      console.debug('Parse message error: ', error);
      throw error;
    }
  }

  /** 连接并登录debug server */
  private async connect() {
    if (this.connected) {
      return;
    }

    try {
      this.websocket = await connect_websocket(this.url, {
        protocols: 'debug',
        on_message: this.handle.bind(this),
      });
      await this.call('login', [this.username, this.password]);
    } catch (error) {
      this.websocket = undefined;
      console.debug('Connect error: ', error);
      throw error;
    }
  }

  public disconnect() {
    this.websocket?.close();
  }

  private async send(msg: SendMessage) {
    try {
      if (this.websocket!.readyState !== WebSocket.OPEN) {
        throw new Error('Websocket is not connected');
      }
      console.debug('Send message: ', msg);
      this.websocket!.send(Remote.pack(msg));
    } catch (error) {
      console.debug('Send message error: ', error);
      this.handlers.delete(msg.id);
      throw error;
    }
  }

  /** 接受server传回的消息，根据id或event决定是返回还是推送的消息，并分发到对应handler */
  private async handle(
    socketEvent: ArrayBuffer,
    websocket: WebSocket
  ) {
    const msg = Remote.parse(socketEvent) as ReceiveMessage;

    const { id, event } = msg;

    try {
      if (event !== undefined) {
        const handler = this.events.get(event);
        // event中message不为OK时，一般认为是用户脚本的错误
        if (
          msg.message !== 'OK' &&
          !(event === 'ERROR' || event === 'SYNTAX')
        ) {
          throw msg.message;
        }
        if (handler) {
          await handler(msg);
        } else {
          throw new Error(`"Unknown event from server": ${event}`);
        }
      } else if (id !== undefined) {
        const handler = this.handlers.get(id);
        if (msg.message !== 'OK') {
          // TODO: 错误处理，handler中mesaage不为OK时，一般认为是服务端/DA错误
          throw msg.message;
        } else if (handler) {
          await handler(msg);
        } else {
          throw new Error(`"Unknown function id from server": ${id}`);
        }
      } else {
        throw new Error(`"Unknown message from server": ${msg}`);
      }
    } catch (error) {
      console.debug('Handle message error: ', error);
    }
  }

  /** 注册 server 事件回调 */
  public on(event: string, handler: Function) {
    this.events.set(event, (msg) => handler(msg));
  }

  /** 调用server侧函数 */
  public async call(func: string, args?: any) {
    // 避免debug session未开启时发送其他请求
    if (this._terminated) {
      return;
    }
    // 未连接时自动连接
    if (!this.websocket) {
      await this.connect();
    }

    return new Promise<any>(async (resolve, reject) => {
      const id = Remote.nextId;

      this.handlers.set(id, (msg) => {
        const { message, data } = msg;
        message === 'OK' ? resolve(data) : reject(message);
        this.handlers.delete(id);
      });

      try {
        if (args !== undefined) {
          await this.send({ id, func, data: args });
        } else {
          await this.send({ id, func });
        }
      } catch (error) {
        reject(error);
      }
    });
  }
}

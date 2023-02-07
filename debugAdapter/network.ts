import { WebSocket, connect_websocket, inspect } from "xshell";
import { json2DdbDict } from "./utils.js";
import { DdbObj } from "dolphindb";

const decoder = new TextDecoder();

const encoder = new TextEncoder();

export interface Message {
  /** rpc id: 在 rpc 系统中认为是唯一的。
      用来在单个 websocket 连接上复用多个 rpc 请求。多个相同 id 的 message 组成一个请求流。
      对于client发起的rpc，server返回时附带id用于区分是哪个rpc的返回。
   */
  id?: number;
  
  /* 由client发起时标识调用的函数名称 */
  func?: string;
  
  /* 由server主动推送时标识事件名称 */
  event?: string;

  /** 通过这个 flag 主动表明这是发往对方的最后一个 message, 对方可以销毁 handler 了  
      并非强制，可以不说明，由双方的函数自己约定
      TODO: 需要分段传输吗？
  */
  done?: boolean;

  /* 外层包装成DdbDict，data为数据内容 */
  data?: any; // TODO: 收到的消息引入类型定义？

  /** bins: data 中哪些下标对应的原始值是 Uint8Array 类型的，如: [0, 3] */
  bins?: number[];
  
  /** 状态信息 */
  message?: string;
}

export interface SendMessage extends Message {
  id: number;
}

export interface ReturnMessage extends Message {
  id: number;
}

export interface EventMessage extends Message {
  event: string;
}

export type ReceiveMessage = (ReturnMessage | EventMessage) & { message: string };

/** 接收到消息后的处理函数  
    包含client发出请求的返回以及server主动推送的事件    
*/
export type MessageHandler = (
  msg: ReceiveMessage,
  websocket?: WebSocket
) => void | any[] | Promise<void | any[]>;    

/** 通过创建 remote 对象对 websocket rpc 进行抽象  
  调用方使用 remote.call 进行调用  
  被调方在创建 remote 对象时传入 funcs 注册处理函数，并使用 remote.handle 方法处理 websocket message  
  未连接时自动连接 */
export class Remote {
  private static id = 0;
  
  static get nextId() {
    return Remote.id++;
  }
  
  private websocket?: Awaited<ReturnType<typeof connect_websocket>>;

  /** server侧主动推送事件触发的函数 */
  private events = new Map<string, MessageHandler>();

  /** map<id, message handler>: 通过 rpc message.id 找到对应的 handler, unary rpc 接收方不需要设置 handlers, 发送方需要 */
  private handlers = new Map<number, MessageHandler>();

  get connected() {
    return this.websocket?.readyState === WebSocket.OPEN;
  }
  
  public static pack(msg: SendMessage) {
    const arg = json2DdbDict(msg).pack();
    
    return arg;
  }
  
  public static parse(array_buffer: ArrayBuffer) {
    try {
      const buf = new Uint8Array(array_buffer);
      const dv = new DataView(array_buffer);
      
      const jsonLength = dv.getUint32(0, true);
      let baseOffset = 4 + jsonLength;
      
      // TODO: 错误处理（对后端数据校验）
      let msg = JSON.parse(decoder.decode(buf.subarray(4, baseOffset)));
      
      console.debug("Receive message: ", msg);

      if (msg?.data instanceof Array) {
        // 仅查询scope或变量时会出现
        msg.data.forEach((item: any) => {
          if (item.offset) {
            item.binValue = buf.subarray(baseOffset, baseOffset + item.offset);
            item.ddbValue = DdbObj.parse(item.binValue, true);
            item.value = inspect(item.ddbValue);
            baseOffset += item.offset;
          }
        });
      } else if (msg?.data?.offset) {
        msg.data.binValue = buf.subarray(baseOffset, baseOffset + msg.data.offset);
        msg.data.ddbValue = DdbObj.parse(msg.data.binValue, true);
        msg.data.value = inspect(msg.data.ddbValue);
      }
      return msg;
    } catch (error) {
      console.debug("Parse message error: ", error);
      throw error;
    }
  }

  /**
   * 连接并注册server推送事件的回调
   * @url server地址
   * @events server events 
   */
  constructor(private url: string, private username: string, private password: string) {}

  private async connect() {
    if (this.connected) {
      return;
    }
    
    try {
      this.websocket = await connect_websocket(this.url, {
        protocols: "debug",
        on_message: this.handle.bind(this),
      });
      // TODO: 登录失败抛出error，但其实用户能登录插件应该也能登录debugger
      await this.call('login', [ this.username, this.password ]);
    } catch (error) {
      this.websocket = undefined;
      console.debug("Connect error: ", error);
      throw error;
    }
  }

  public disconnect() {
    this.websocket?.close();
  }

  private async send(msg: SendMessage) {
    try {
      if (this.websocket!.readyState !== WebSocket.OPEN) {
        throw new Error("Websocket is not connected");
      }
      console.debug("Send message: ", msg);
      this.websocket!.send(Remote.pack(msg));
    } catch (error) {
      console.debug("Send message error: ", error);
      this.handlers.delete(msg.id);
      throw error;
    }
  }

  private async handle(socketEvent: { data: ArrayBuffer }, websocket: WebSocket) {
    const msg = Remote.parse(socketEvent.data) as ReceiveMessage;

    const { id, event } = msg;

    try {
      if (event) {
        const handler = this.events.get(event);
        if (msg.message !== 'OK') {
          // TODO: 用户脚本错误
          throw msg.message;
        } else if (handler) {
          await handler(msg);
        } else {
          throw new Error(`"Unknown event from server": ${event}`);
        }
      } else if (id) {
        const handler = this.handlers.get(id);
        if (msg.message !== 'OK') {
          // TODO: 服务端/DA错误
          throw msg.message;
        } else if (handler) {
          await handler(msg);
        } else {
          throw new Error(`"Unknown function id from server": ${id}`);
        }
      }
    } catch (error) {
      console.debug("Handle message error: ", error);
      throw error;
    }
  }
  
  /** 注册 server 事件 */
  public on(event: string, handler: Function) {
    this.events[event] = (msg: EventMessage) => handler(msg.data);
  }

  /**
   * 调用 remote 中的 func
   * @func 要调用的函数名
   * @args 文档中的data部分(number | string | boolean | object | array)
   */
  public async call(func: string, args?: any) {
    // 未连接时自动连接
    if (!this.websocket) {
      await this.connect();
    }
    return new Promise<any>(async (resolve, reject) => {
      const id = Remote.nextId;

      this.handlers.set(id, (msg) => {
        const { message, data } = msg;
        message === 'OK' ? resolve(data) : reject(message) ;
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

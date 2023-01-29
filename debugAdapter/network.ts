import { DdbObj } from "dolphindb";
import { connect_websocket } from "xshell";
import { concat, genid } from "xshell";
import { json2DdbDict } from "./utils.js";

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

  /** 通知对方这里产生的错误，本质上类似 data 也是一种数据，并不代表 rpc 的结束，后续可能继续有 rpc message 交换 */
  error?: Error;

  /* 外层包装成DdbDict，data为数据内容 */
  data?: any; // TODO: 收到的消息引入类型定义？

  /** bins: data 中哪些下标对应的原始值是 Uint8Array 类型的，如: [0, 3] */
  bins?: number[];
}

export interface SendMessage extends Message {
  id: number;
  
  func: string;
}

export interface ReturnMessage extends Message {
  id: number;
}

export interface EventMessage extends Message {
  event: string;
}

export type ReceiveMessage = ReturnMessage | EventMessage;

/** 接收到消息后的处理函数  
    包含client发出请求的返回以及server主动推送的事件    
*/
export type MessageHandler = (
  message: ReceiveMessage,
  websocket?: WebSocket
) => void | any[] | Promise<void | any[]>;    

/** 通过创建 remote 对象对 websocket rpc 进行抽象  
  调用方使用 remote.call 进行调用  
  被调方在创建 remote 对象时传入 funcs 注册处理函数，并使用 remote.handle 方法处理 websocket message  
  未连接时自动连接，断开后自动重连 */
export class Remote {
  private websocket?: Awaited<ReturnType<typeof connect_websocket>>;

  /** server侧主动推送事件触发的函数 */
  private events: Record<string, MessageHandler>;

  /** map<id, message handler>: 通过 rpc message.id 找到对应的 handler, unary rpc 接收方不需要设置 handlers, 发送方需要 */
  private handlers = new Map<number, MessageHandler>();
  
  private connecting: Promise<void> | undefined;

  get connected() {
    return this.websocket?.readyState === WebSocket.OPEN;
  }
  
  public static pack(message: SendMessage) {
    const arg = json2DdbDict(message).pack();
    
    let dv = new DataView(new ArrayBuffer(4));
    dv.setUint32(0, arg.length, true);
        
    return concat([dv, arg]);
  }
  
  public static parse(array_buffer: ArrayBuffer) {
    const buf = new Uint8Array(array_buffer as ArrayBuffer);
    const dv = new DataView(array_buffer);

    const len_json = dv.getUint32(0, true);

    let offset = 4 + len_json;

    let message = JSON.parse(
      decoder.decode(buf.subarray(4, offset))
    );

    if (message.error) {
      message.error = Object.assign(new Error(), message.error);
    }

    return message;
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
    
    let resolve: () => void;
    await this.connecting;
    this.connecting = new Promise(async (_resolve) => {
      resolve = _resolve;
    });
    
    try {
      this.websocket = await connect_websocket(this.url, {
        protocols: "debug",
        on_message: this.handle.bind(this),
      });
    } catch (error) {
      this.websocket = undefined;
      throw error;
    } finally {
      resolve!();
    }
  }

  public disconnect() {
    this.websocket?.close();
  }

  private async send(message: SendMessage) {
    try {
      if (!this.websocket) {
        await this.connect();
        await this.call('login', { username: this.username, password: this.password });
      }
      if (this.websocket!.readyState !== WebSocket.OPEN) {
        throw new Error("remote.send(): websocket client 已断开");
      }
      this.websocket!.send(Remote.pack(message));
    } catch (error) {
      this.handlers.delete(message.id);
      throw error;
    }
  }

  private async handle(event: { data: ArrayBuffer }, websocket: WebSocket) {
    const message = Remote.parse(event.data) as ReceiveMessage;

    const { id, event: serverEvent } = message;

    let handler: MessageHandler | undefined;

    if (serverEvent) {
      handler = this.events[serverEvent];
    } else {
      handler = this.handlers.get(id!);
    }

    try {
      if (handler) {
        // TODO: 是否存在需要返回给服务端的情况
        await handler(message.data);
        // if (data) {
        //   await this.send({ id, data });
        // }
      } else if (message.error) {
        throw message.error;
      } else {
        throw new Error(
          `"找不到 rpc handler":${
            serverEvent ? `event: ${serverEvent}` : `id: ${id}`
          }`
        );
      }
    } catch (error) {
      // TODO: 错误处理&多段消息处理
      // 再往上层抛出错误没有意义了，上层调用栈是 websocket.on('message') 之类的
      console.log(error);
    }
  }
  
  /** 注册 server 事件 */
  public on(event: string, handler: MessageHandler) {
    this.events[event] = handler;
  }

  /**
   * 调用 remote 中的 func
   * @func 要调用的函数名
   * @args 文档中的data部分(number | string | boolean | object | array)
   */
  public async call(func: string, args?: any) {
    return new Promise<any>(async (resolve, reject) => {
      const id = genid();

      this.handlers.set(id, (message) => {
        const { error, data } = message;
        error ? reject(error) : resolve(data);
        this.handlers.delete(id);
      });

      try {
        await this.send({ id, func, data: args });
      } catch (error) {
        reject(error);
      }
    });
  }
}

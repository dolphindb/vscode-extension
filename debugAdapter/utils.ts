import {
  DdbObj,
  DdbDict,
  DdbString,
  DdbVectorString,
  DdbVectorAny,
  DdbInt,
  DdbBool,
  DdbForm,
  DdbType,
} from 'dolphindb';
import { promises as fs } from 'fs';

// DDB数据类型转换相关
/**
 * 基本数据类型到DdbObj的转换
 * @param value 数字、布尔、字符串
 * @returns DdbObj
 */
export function basicType2DdbObj(value: any): DdbObj {
  if (typeof value === 'string') {
    return new DdbString(value);
  } else if (typeof value === 'number') {
    return new DdbInt(value);
  } else if (typeof value === 'boolean') {
    return new DdbBool(value);
  } else {
    return new DdbString(''); // 空值
  }
}

/**
 * json数据转换为DdbDict
 * @param data 支持嵌套json、数组、基本数据类型
 * @returns DdbDict
 */
export function json2DdbDict(data: Object): DdbDict {
  const keys: string[] = [], values: DdbObj[] = [];

  Object.entries(data).forEach(([key, value]) => {
    keys.push(key);
    if (typeof value === 'object' && value instanceof Array) {
      const arr: DdbObj[] = [];
      value.forEach((item) => {
        if (typeof item === 'object') {
          arr.push(json2DdbDict(item));
        } else {
          arr.push(basicType2DdbObj(item));
        }
      });
      values.push(new DdbVectorAny(arr));
    } else if (typeof value === 'object') {
      values.push(json2DdbDict(value));
    } else {
      values.push(basicType2DdbObj(value));
    }
  });

  return new DdbDict(
    new DdbVectorString(keys),
    new DdbObj({
      form: DdbForm.vector,
      type: DdbType.any,
      rows: values.length,
      cols: 1,
      value: DdbObj.to_ddbobjs(values),
    })
  );
}

// 文件读写相关
type FileAccessor = {
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

/**
 * Normalize path casing and separators to match the casing and separators of the OS.
 * @param path path to normalize
 * @returns path with normalized casing and separators
 */
export function normalizePathAndCasing(path: string) {
  if (fsAccessor.isWindows) {
    return path.replace(/\//g, '\\').toLowerCase();
  } else {
    return path.replace(/\\/g, '/');
  }
}

function initializeContents(memory: Uint8Array) {
  return new TextDecoder().decode(memory);
}

/**
 * Load the contents of a file.
 * @param file path to the file
 * @returns string contents of the file
 */
export async function loadSource(file: string) {
  file = normalizePathAndCasing(file);
  return initializeContents(await fsAccessor.readFile(file));
}
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

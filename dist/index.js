var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/@msgpack/msgpack/dist.cjs/utils/utf8.cjs
var require_utf8 = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/utf8.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.utf8Count = utf8Count;
    exports.utf8EncodeJs = utf8EncodeJs;
    exports.utf8EncodeTE = utf8EncodeTE;
    exports.utf8Encode = utf8Encode;
    exports.utf8DecodeJs = utf8DecodeJs;
    exports.utf8DecodeTD = utf8DecodeTD;
    exports.utf8Decode = utf8Decode;
    function utf8Count(str) {
      const strLength = str.length;
      let byteLength = 0;
      let pos = 0;
      while (pos < strLength) {
        let value = str.charCodeAt(pos++);
        if ((value & 4294967168) === 0) {
          byteLength++;
          continue;
        } else if ((value & 4294965248) === 0) {
          byteLength += 2;
        } else {
          if (value >= 55296 && value <= 56319) {
            if (pos < strLength) {
              const extra = str.charCodeAt(pos);
              if ((extra & 64512) === 56320) {
                ++pos;
                value = ((value & 1023) << 10) + (extra & 1023) + 65536;
              }
            }
          }
          if ((value & 4294901760) === 0) {
            byteLength += 3;
          } else {
            byteLength += 4;
          }
        }
      }
      return byteLength;
    }
    function utf8EncodeJs(str, output, outputOffset) {
      const strLength = str.length;
      let offset = outputOffset;
      let pos = 0;
      while (pos < strLength) {
        let value = str.charCodeAt(pos++);
        if ((value & 4294967168) === 0) {
          output[offset++] = value;
          continue;
        } else if ((value & 4294965248) === 0) {
          output[offset++] = value >> 6 & 31 | 192;
        } else {
          if (value >= 55296 && value <= 56319) {
            if (pos < strLength) {
              const extra = str.charCodeAt(pos);
              if ((extra & 64512) === 56320) {
                ++pos;
                value = ((value & 1023) << 10) + (extra & 1023) + 65536;
              }
            }
          }
          if ((value & 4294901760) === 0) {
            output[offset++] = value >> 12 & 15 | 224;
            output[offset++] = value >> 6 & 63 | 128;
          } else {
            output[offset++] = value >> 18 & 7 | 240;
            output[offset++] = value >> 12 & 63 | 128;
            output[offset++] = value >> 6 & 63 | 128;
          }
        }
        output[offset++] = value & 63 | 128;
      }
    }
    var sharedTextEncoder = new TextEncoder();
    var TEXT_ENCODER_THRESHOLD = 50;
    function utf8EncodeTE(str, output, outputOffset) {
      sharedTextEncoder.encodeInto(str, output.subarray(outputOffset));
    }
    function utf8Encode(str, output, outputOffset) {
      if (str.length > TEXT_ENCODER_THRESHOLD) {
        utf8EncodeTE(str, output, outputOffset);
      } else {
        utf8EncodeJs(str, output, outputOffset);
      }
    }
    var CHUNK_SIZE = 4096;
    function utf8DecodeJs(bytes, inputOffset, byteLength) {
      let offset = inputOffset;
      const end = offset + byteLength;
      const units = [];
      let result = "";
      while (offset < end) {
        const byte1 = bytes[offset++];
        if ((byte1 & 128) === 0) {
          units.push(byte1);
        } else if ((byte1 & 224) === 192) {
          const byte2 = bytes[offset++] & 63;
          units.push((byte1 & 31) << 6 | byte2);
        } else if ((byte1 & 240) === 224) {
          const byte2 = bytes[offset++] & 63;
          const byte3 = bytes[offset++] & 63;
          units.push((byte1 & 31) << 12 | byte2 << 6 | byte3);
        } else if ((byte1 & 248) === 240) {
          const byte2 = bytes[offset++] & 63;
          const byte3 = bytes[offset++] & 63;
          const byte4 = bytes[offset++] & 63;
          let unit = (byte1 & 7) << 18 | byte2 << 12 | byte3 << 6 | byte4;
          if (unit > 65535) {
            unit -= 65536;
            units.push(unit >>> 10 & 1023 | 55296);
            unit = 56320 | unit & 1023;
          }
          units.push(unit);
        } else {
          units.push(byte1);
        }
        if (units.length >= CHUNK_SIZE) {
          result += String.fromCharCode(...units);
          units.length = 0;
        }
      }
      if (units.length > 0) {
        result += String.fromCharCode(...units);
      }
      return result;
    }
    var sharedTextDecoder = new TextDecoder();
    var TEXT_DECODER_THRESHOLD = 200;
    function utf8DecodeTD(bytes, inputOffset, byteLength) {
      const stringBytes = bytes.subarray(inputOffset, inputOffset + byteLength);
      return sharedTextDecoder.decode(stringBytes);
    }
    function utf8Decode(bytes, inputOffset, byteLength) {
      if (byteLength > TEXT_DECODER_THRESHOLD) {
        return utf8DecodeTD(bytes, inputOffset, byteLength);
      } else {
        return utf8DecodeJs(bytes, inputOffset, byteLength);
      }
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/ExtData.cjs
var require_ExtData = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/ExtData.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ExtData = void 0;
    var ExtData = class {
      type;
      data;
      constructor(type, data) {
        this.type = type;
        this.data = data;
      }
    };
    exports.ExtData = ExtData;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/DecodeError.cjs
var require_DecodeError = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/DecodeError.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DecodeError = void 0;
    var DecodeError2 = class _DecodeError extends Error {
      constructor(message) {
        super(message);
        const proto = Object.create(_DecodeError.prototype);
        Object.setPrototypeOf(this, proto);
        Object.defineProperty(this, "name", {
          configurable: true,
          enumerable: false,
          value: _DecodeError.name
        });
      }
    };
    exports.DecodeError = DecodeError2;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/int.cjs
var require_int = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/int.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.UINT32_MAX = void 0;
    exports.setUint64 = setUint64;
    exports.setInt64 = setInt64;
    exports.getInt64 = getInt64;
    exports.getUint64 = getUint64;
    exports.UINT32_MAX = 4294967295;
    function setUint64(view, offset, value) {
      const high = value / 4294967296;
      const low = value;
      view.setUint32(offset, high);
      view.setUint32(offset + 4, low);
    }
    function setInt64(view, offset, value) {
      const high = Math.floor(value / 4294967296);
      const low = value;
      view.setUint32(offset, high);
      view.setUint32(offset + 4, low);
    }
    function getInt64(view, offset) {
      const high = view.getInt32(offset);
      const low = view.getUint32(offset + 4);
      return high * 4294967296 + low;
    }
    function getUint64(view, offset) {
      const high = view.getUint32(offset);
      const low = view.getUint32(offset + 4);
      return high * 4294967296 + low;
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/timestamp.cjs
var require_timestamp = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/timestamp.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.timestampExtension = exports.EXT_TIMESTAMP = void 0;
    exports.encodeTimeSpecToTimestamp = encodeTimeSpecToTimestamp;
    exports.encodeDateToTimeSpec = encodeDateToTimeSpec;
    exports.encodeTimestampExtension = encodeTimestampExtension;
    exports.decodeTimestampToTimeSpec = decodeTimestampToTimeSpec;
    exports.decodeTimestampExtension = decodeTimestampExtension;
    var DecodeError_ts_1 = require_DecodeError();
    var int_ts_1 = require_int();
    exports.EXT_TIMESTAMP = -1;
    var TIMESTAMP32_MAX_SEC = 4294967296 - 1;
    var TIMESTAMP64_MAX_SEC = 17179869184 - 1;
    function encodeTimeSpecToTimestamp({ sec, nsec }) {
      if (sec >= 0 && nsec >= 0 && sec <= TIMESTAMP64_MAX_SEC) {
        if (nsec === 0 && sec <= TIMESTAMP32_MAX_SEC) {
          const rv = new Uint8Array(4);
          const view = new DataView(rv.buffer);
          view.setUint32(0, sec);
          return rv;
        } else {
          const secHigh = sec / 4294967296;
          const secLow = sec & 4294967295;
          const rv = new Uint8Array(8);
          const view = new DataView(rv.buffer);
          view.setUint32(0, nsec << 2 | secHigh & 3);
          view.setUint32(4, secLow);
          return rv;
        }
      } else {
        const rv = new Uint8Array(12);
        const view = new DataView(rv.buffer);
        view.setUint32(0, nsec);
        (0, int_ts_1.setInt64)(view, 4, sec);
        return rv;
      }
    }
    function encodeDateToTimeSpec(date) {
      const msec = date.getTime();
      const sec = Math.floor(msec / 1e3);
      const nsec = (msec - sec * 1e3) * 1e6;
      const nsecInSec = Math.floor(nsec / 1e9);
      return {
        sec: sec + nsecInSec,
        nsec: nsec - nsecInSec * 1e9
      };
    }
    function encodeTimestampExtension(object) {
      if (object instanceof Date) {
        const timeSpec = encodeDateToTimeSpec(object);
        return encodeTimeSpecToTimestamp(timeSpec);
      } else {
        return null;
      }
    }
    function decodeTimestampToTimeSpec(data) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      switch (data.byteLength) {
        case 4: {
          const sec = view.getUint32(0);
          const nsec = 0;
          return { sec, nsec };
        }
        case 8: {
          const nsec30AndSecHigh2 = view.getUint32(0);
          const secLow32 = view.getUint32(4);
          const sec = (nsec30AndSecHigh2 & 3) * 4294967296 + secLow32;
          const nsec = nsec30AndSecHigh2 >>> 2;
          return { sec, nsec };
        }
        case 12: {
          const sec = (0, int_ts_1.getInt64)(view, 4);
          const nsec = view.getUint32(0);
          return { sec, nsec };
        }
        default:
          throw new DecodeError_ts_1.DecodeError(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${data.length}`);
      }
    }
    function decodeTimestampExtension(data) {
      const timeSpec = decodeTimestampToTimeSpec(data);
      return new Date(timeSpec.sec * 1e3 + timeSpec.nsec / 1e6);
    }
    exports.timestampExtension = {
      type: exports.EXT_TIMESTAMP,
      encode: encodeTimestampExtension,
      decode: decodeTimestampExtension
    };
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/ExtensionCodec.cjs
var require_ExtensionCodec = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/ExtensionCodec.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ExtensionCodec = void 0;
    var ExtData_ts_1 = require_ExtData();
    var timestamp_ts_1 = require_timestamp();
    var ExtensionCodec = class _ExtensionCodec {
      static defaultCodec = new _ExtensionCodec();
      // ensures ExtensionCodecType<X> matches ExtensionCodec<X>
      // this will make type errors a lot more clear
      // eslint-disable-next-line @typescript-eslint/naming-convention
      __brand;
      // built-in extensions
      builtInEncoders = [];
      builtInDecoders = [];
      // custom extensions
      encoders = [];
      decoders = [];
      constructor() {
        this.register(timestamp_ts_1.timestampExtension);
      }
      register({ type, encode: encode2, decode }) {
        if (type >= 0) {
          this.encoders[type] = encode2;
          this.decoders[type] = decode;
        } else {
          const index = -1 - type;
          this.builtInEncoders[index] = encode2;
          this.builtInDecoders[index] = decode;
        }
      }
      tryToEncode(object, context) {
        for (let i = 0; i < this.builtInEncoders.length; i++) {
          const encodeExt = this.builtInEncoders[i];
          if (encodeExt != null) {
            const data = encodeExt(object, context);
            if (data != null) {
              const type = -1 - i;
              return new ExtData_ts_1.ExtData(type, data);
            }
          }
        }
        for (let i = 0; i < this.encoders.length; i++) {
          const encodeExt = this.encoders[i];
          if (encodeExt != null) {
            const data = encodeExt(object, context);
            if (data != null) {
              const type = i;
              return new ExtData_ts_1.ExtData(type, data);
            }
          }
        }
        if (object instanceof ExtData_ts_1.ExtData) {
          return object;
        }
        return null;
      }
      decode(data, type, context) {
        const decodeExt = type < 0 ? this.builtInDecoders[-1 - type] : this.decoders[type];
        if (decodeExt) {
          return decodeExt(data, type, context);
        } else {
          return new ExtData_ts_1.ExtData(type, data);
        }
      }
    };
    exports.ExtensionCodec = ExtensionCodec;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/typedArrays.cjs
var require_typedArrays = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/typedArrays.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ensureUint8Array = ensureUint8Array;
    function isArrayBufferLike(buffer) {
      return buffer instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer;
    }
    function ensureUint8Array(buffer) {
      if (buffer instanceof Uint8Array) {
        return buffer;
      } else if (ArrayBuffer.isView(buffer)) {
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      } else if (isArrayBufferLike(buffer)) {
        return new Uint8Array(buffer);
      } else {
        return Uint8Array.from(buffer);
      }
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/Encoder.cjs
var require_Encoder = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/Encoder.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Encoder = exports.DEFAULT_INITIAL_BUFFER_SIZE = exports.DEFAULT_MAX_DEPTH = void 0;
    var utf8_ts_1 = require_utf8();
    var ExtensionCodec_ts_1 = require_ExtensionCodec();
    var int_ts_1 = require_int();
    var typedArrays_ts_1 = require_typedArrays();
    exports.DEFAULT_MAX_DEPTH = 100;
    exports.DEFAULT_INITIAL_BUFFER_SIZE = 2048;
    var Encoder = class _Encoder {
      extensionCodec;
      context;
      useBigInt64;
      maxDepth;
      initialBufferSize;
      sortKeys;
      forceFloat32;
      ignoreUndefined;
      forceIntegerToFloat;
      pos;
      view;
      bytes;
      entered = false;
      constructor(options) {
        this.extensionCodec = options?.extensionCodec ?? ExtensionCodec_ts_1.ExtensionCodec.defaultCodec;
        this.context = options?.context;
        this.useBigInt64 = options?.useBigInt64 ?? false;
        this.maxDepth = options?.maxDepth ?? exports.DEFAULT_MAX_DEPTH;
        this.initialBufferSize = options?.initialBufferSize ?? exports.DEFAULT_INITIAL_BUFFER_SIZE;
        this.sortKeys = options?.sortKeys ?? false;
        this.forceFloat32 = options?.forceFloat32 ?? false;
        this.ignoreUndefined = options?.ignoreUndefined ?? false;
        this.forceIntegerToFloat = options?.forceIntegerToFloat ?? false;
        this.pos = 0;
        this.view = new DataView(new ArrayBuffer(this.initialBufferSize));
        this.bytes = new Uint8Array(this.view.buffer);
      }
      clone() {
        return new _Encoder({
          extensionCodec: this.extensionCodec,
          context: this.context,
          useBigInt64: this.useBigInt64,
          maxDepth: this.maxDepth,
          initialBufferSize: this.initialBufferSize,
          sortKeys: this.sortKeys,
          forceFloat32: this.forceFloat32,
          ignoreUndefined: this.ignoreUndefined,
          forceIntegerToFloat: this.forceIntegerToFloat
        });
      }
      reinitializeState() {
        this.pos = 0;
      }
      /**
       * This is almost equivalent to {@link Encoder#encode}, but it returns an reference of the encoder's internal buffer and thus much faster than {@link Encoder#encode}.
       *
       * @returns Encodes the object and returns a shared reference the encoder's internal buffer.
       */
      encodeSharedRef(object) {
        if (this.entered) {
          const instance = this.clone();
          return instance.encodeSharedRef(object);
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.doEncode(object, 1);
          return this.bytes.subarray(0, this.pos);
        } finally {
          this.entered = false;
        }
      }
      /**
       * @returns Encodes the object and returns a copy of the encoder's internal buffer.
       */
      encode(object) {
        if (this.entered) {
          const instance = this.clone();
          return instance.encode(object);
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.doEncode(object, 1);
          return this.bytes.slice(0, this.pos);
        } finally {
          this.entered = false;
        }
      }
      doEncode(object, depth) {
        if (depth > this.maxDepth) {
          throw new Error(`Too deep objects in depth ${depth}`);
        }
        if (object == null) {
          this.encodeNil();
        } else if (typeof object === "boolean") {
          this.encodeBoolean(object);
        } else if (typeof object === "number") {
          if (!this.forceIntegerToFloat) {
            this.encodeNumber(object);
          } else {
            this.encodeNumberAsFloat(object);
          }
        } else if (typeof object === "string") {
          this.encodeString(object);
        } else if (this.useBigInt64 && typeof object === "bigint") {
          this.encodeBigInt64(object);
        } else {
          this.encodeObject(object, depth);
        }
      }
      ensureBufferSizeToWrite(sizeToWrite) {
        const requiredSize = this.pos + sizeToWrite;
        if (this.view.byteLength < requiredSize) {
          this.resizeBuffer(requiredSize * 2);
        }
      }
      resizeBuffer(newSize) {
        const newBuffer = new ArrayBuffer(newSize);
        const newBytes = new Uint8Array(newBuffer);
        const newView = new DataView(newBuffer);
        newBytes.set(this.bytes);
        this.view = newView;
        this.bytes = newBytes;
      }
      encodeNil() {
        this.writeU8(192);
      }
      encodeBoolean(object) {
        if (object === false) {
          this.writeU8(194);
        } else {
          this.writeU8(195);
        }
      }
      encodeNumber(object) {
        if (!this.forceIntegerToFloat && Number.isSafeInteger(object)) {
          if (object >= 0) {
            if (object < 128) {
              this.writeU8(object);
            } else if (object < 256) {
              this.writeU8(204);
              this.writeU8(object);
            } else if (object < 65536) {
              this.writeU8(205);
              this.writeU16(object);
            } else if (object < 4294967296) {
              this.writeU8(206);
              this.writeU32(object);
            } else if (!this.useBigInt64) {
              this.writeU8(207);
              this.writeU64(object);
            } else {
              this.encodeNumberAsFloat(object);
            }
          } else {
            if (object >= -32) {
              this.writeU8(224 | object + 32);
            } else if (object >= -128) {
              this.writeU8(208);
              this.writeI8(object);
            } else if (object >= -32768) {
              this.writeU8(209);
              this.writeI16(object);
            } else if (object >= -2147483648) {
              this.writeU8(210);
              this.writeI32(object);
            } else if (!this.useBigInt64) {
              this.writeU8(211);
              this.writeI64(object);
            } else {
              this.encodeNumberAsFloat(object);
            }
          }
        } else {
          this.encodeNumberAsFloat(object);
        }
      }
      encodeNumberAsFloat(object) {
        if (this.forceFloat32) {
          this.writeU8(202);
          this.writeF32(object);
        } else {
          this.writeU8(203);
          this.writeF64(object);
        }
      }
      encodeBigInt64(object) {
        if (object >= BigInt(0)) {
          this.writeU8(207);
          this.writeBigUint64(object);
        } else {
          this.writeU8(211);
          this.writeBigInt64(object);
        }
      }
      writeStringHeader(byteLength) {
        if (byteLength < 32) {
          this.writeU8(160 + byteLength);
        } else if (byteLength < 256) {
          this.writeU8(217);
          this.writeU8(byteLength);
        } else if (byteLength < 65536) {
          this.writeU8(218);
          this.writeU16(byteLength);
        } else if (byteLength < 4294967296) {
          this.writeU8(219);
          this.writeU32(byteLength);
        } else {
          throw new Error(`Too long string: ${byteLength} bytes in UTF-8`);
        }
      }
      encodeString(object) {
        const maxHeaderSize = 1 + 4;
        const byteLength = (0, utf8_ts_1.utf8Count)(object);
        this.ensureBufferSizeToWrite(maxHeaderSize + byteLength);
        this.writeStringHeader(byteLength);
        (0, utf8_ts_1.utf8Encode)(object, this.bytes, this.pos);
        this.pos += byteLength;
      }
      encodeObject(object, depth) {
        const ext = this.extensionCodec.tryToEncode(object, this.context);
        if (ext != null) {
          this.encodeExtension(ext);
        } else if (Array.isArray(object)) {
          this.encodeArray(object, depth);
        } else if (ArrayBuffer.isView(object)) {
          this.encodeBinary(object);
        } else if (typeof object === "object") {
          this.encodeMap(object, depth);
        } else {
          throw new Error(`Unrecognized object: ${Object.prototype.toString.apply(object)}`);
        }
      }
      encodeBinary(object) {
        const size = object.byteLength;
        if (size < 256) {
          this.writeU8(196);
          this.writeU8(size);
        } else if (size < 65536) {
          this.writeU8(197);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(198);
          this.writeU32(size);
        } else {
          throw new Error(`Too large binary: ${size}`);
        }
        const bytes = (0, typedArrays_ts_1.ensureUint8Array)(object);
        this.writeU8a(bytes);
      }
      encodeArray(object, depth) {
        const size = object.length;
        if (size < 16) {
          this.writeU8(144 + size);
        } else if (size < 65536) {
          this.writeU8(220);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(221);
          this.writeU32(size);
        } else {
          throw new Error(`Too large array: ${size}`);
        }
        for (const item of object) {
          this.doEncode(item, depth + 1);
        }
      }
      countWithoutUndefined(object, keys) {
        let count = 0;
        for (const key of keys) {
          if (object[key] !== void 0) {
            count++;
          }
        }
        return count;
      }
      encodeMap(object, depth) {
        const keys = Object.keys(object);
        if (this.sortKeys) {
          keys.sort();
        }
        const size = this.ignoreUndefined ? this.countWithoutUndefined(object, keys) : keys.length;
        if (size < 16) {
          this.writeU8(128 + size);
        } else if (size < 65536) {
          this.writeU8(222);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(223);
          this.writeU32(size);
        } else {
          throw new Error(`Too large map object: ${size}`);
        }
        for (const key of keys) {
          const value = object[key];
          if (!(this.ignoreUndefined && value === void 0)) {
            this.encodeString(key);
            this.doEncode(value, depth + 1);
          }
        }
      }
      encodeExtension(ext) {
        if (typeof ext.data === "function") {
          const data = ext.data(this.pos + 6);
          const size2 = data.length;
          if (size2 >= 4294967296) {
            throw new Error(`Too large extension object: ${size2}`);
          }
          this.writeU8(201);
          this.writeU32(size2);
          this.writeI8(ext.type);
          this.writeU8a(data);
          return;
        }
        const size = ext.data.length;
        if (size === 1) {
          this.writeU8(212);
        } else if (size === 2) {
          this.writeU8(213);
        } else if (size === 4) {
          this.writeU8(214);
        } else if (size === 8) {
          this.writeU8(215);
        } else if (size === 16) {
          this.writeU8(216);
        } else if (size < 256) {
          this.writeU8(199);
          this.writeU8(size);
        } else if (size < 65536) {
          this.writeU8(200);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(201);
          this.writeU32(size);
        } else {
          throw new Error(`Too large extension object: ${size}`);
        }
        this.writeI8(ext.type);
        this.writeU8a(ext.data);
      }
      writeU8(value) {
        this.ensureBufferSizeToWrite(1);
        this.view.setUint8(this.pos, value);
        this.pos++;
      }
      writeU8a(values) {
        const size = values.length;
        this.ensureBufferSizeToWrite(size);
        this.bytes.set(values, this.pos);
        this.pos += size;
      }
      writeI8(value) {
        this.ensureBufferSizeToWrite(1);
        this.view.setInt8(this.pos, value);
        this.pos++;
      }
      writeU16(value) {
        this.ensureBufferSizeToWrite(2);
        this.view.setUint16(this.pos, value);
        this.pos += 2;
      }
      writeI16(value) {
        this.ensureBufferSizeToWrite(2);
        this.view.setInt16(this.pos, value);
        this.pos += 2;
      }
      writeU32(value) {
        this.ensureBufferSizeToWrite(4);
        this.view.setUint32(this.pos, value);
        this.pos += 4;
      }
      writeI32(value) {
        this.ensureBufferSizeToWrite(4);
        this.view.setInt32(this.pos, value);
        this.pos += 4;
      }
      writeF32(value) {
        this.ensureBufferSizeToWrite(4);
        this.view.setFloat32(this.pos, value);
        this.pos += 4;
      }
      writeF64(value) {
        this.ensureBufferSizeToWrite(8);
        this.view.setFloat64(this.pos, value);
        this.pos += 8;
      }
      writeU64(value) {
        this.ensureBufferSizeToWrite(8);
        (0, int_ts_1.setUint64)(this.view, this.pos, value);
        this.pos += 8;
      }
      writeI64(value) {
        this.ensureBufferSizeToWrite(8);
        (0, int_ts_1.setInt64)(this.view, this.pos, value);
        this.pos += 8;
      }
      writeBigUint64(value) {
        this.ensureBufferSizeToWrite(8);
        this.view.setBigUint64(this.pos, value);
        this.pos += 8;
      }
      writeBigInt64(value) {
        this.ensureBufferSizeToWrite(8);
        this.view.setBigInt64(this.pos, value);
        this.pos += 8;
      }
    };
    exports.Encoder = Encoder;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/encode.cjs
var require_encode = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/encode.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.encode = encode2;
    var Encoder_ts_1 = require_Encoder();
    function encode2(value, options) {
      const encoder = new Encoder_ts_1.Encoder(options);
      return encoder.encodeSharedRef(value);
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/prettyByte.cjs
var require_prettyByte = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/prettyByte.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.prettyByte = prettyByte;
    function prettyByte(byte) {
      return `${byte < 0 ? "-" : ""}0x${Math.abs(byte).toString(16).padStart(2, "0")}`;
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/CachedKeyDecoder.cjs
var require_CachedKeyDecoder = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/CachedKeyDecoder.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CachedKeyDecoder = void 0;
    var utf8_ts_1 = require_utf8();
    var DEFAULT_MAX_KEY_LENGTH = 16;
    var DEFAULT_MAX_LENGTH_PER_KEY = 16;
    var CachedKeyDecoder = class {
      hit = 0;
      miss = 0;
      caches;
      maxKeyLength;
      maxLengthPerKey;
      constructor(maxKeyLength = DEFAULT_MAX_KEY_LENGTH, maxLengthPerKey = DEFAULT_MAX_LENGTH_PER_KEY) {
        this.maxKeyLength = maxKeyLength;
        this.maxLengthPerKey = maxLengthPerKey;
        this.caches = [];
        for (let i = 0; i < this.maxKeyLength; i++) {
          this.caches.push([]);
        }
      }
      canBeCached(byteLength) {
        return byteLength > 0 && byteLength <= this.maxKeyLength;
      }
      find(bytes, inputOffset, byteLength) {
        const records = this.caches[byteLength - 1];
        FIND_CHUNK: for (const record of records) {
          const recordBytes = record.bytes;
          for (let j2 = 0; j2 < byteLength; j2++) {
            if (recordBytes[j2] !== bytes[inputOffset + j2]) {
              continue FIND_CHUNK;
            }
          }
          return record.str;
        }
        return null;
      }
      store(bytes, value) {
        const records = this.caches[bytes.length - 1];
        const record = { bytes, str: value };
        if (records.length >= this.maxLengthPerKey) {
          records[Math.random() * records.length | 0] = record;
        } else {
          records.push(record);
        }
      }
      decode(bytes, inputOffset, byteLength) {
        const cachedValue = this.find(bytes, inputOffset, byteLength);
        if (cachedValue != null) {
          this.hit++;
          return cachedValue;
        }
        this.miss++;
        const str = (0, utf8_ts_1.utf8DecodeJs)(bytes, inputOffset, byteLength);
        const slicedCopyOfBytes = Uint8Array.prototype.slice.call(bytes, inputOffset, inputOffset + byteLength);
        this.store(slicedCopyOfBytes, str);
        return str;
      }
    };
    exports.CachedKeyDecoder = CachedKeyDecoder;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/Decoder.cjs
var require_Decoder = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/Decoder.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Decoder = void 0;
    var prettyByte_ts_1 = require_prettyByte();
    var ExtensionCodec_ts_1 = require_ExtensionCodec();
    var int_ts_1 = require_int();
    var utf8_ts_1 = require_utf8();
    var typedArrays_ts_1 = require_typedArrays();
    var CachedKeyDecoder_ts_1 = require_CachedKeyDecoder();
    var DecodeError_ts_1 = require_DecodeError();
    var STATE_ARRAY = "array";
    var STATE_MAP_KEY = "map_key";
    var STATE_MAP_VALUE = "map_value";
    var mapKeyConverter = (key) => {
      if (typeof key === "string" || typeof key === "number") {
        return key;
      }
      throw new DecodeError_ts_1.DecodeError("The type of key must be string or number but " + typeof key);
    };
    var StackPool = class {
      stack = [];
      stackHeadPosition = -1;
      get length() {
        return this.stackHeadPosition + 1;
      }
      top() {
        return this.stack[this.stackHeadPosition];
      }
      pushArrayState(size) {
        const state = this.getUninitializedStateFromPool();
        state.type = STATE_ARRAY;
        state.position = 0;
        state.size = size;
        state.array = new Array(size);
      }
      pushMapState(size) {
        const state = this.getUninitializedStateFromPool();
        state.type = STATE_MAP_KEY;
        state.readCount = 0;
        state.size = size;
        state.map = {};
      }
      getUninitializedStateFromPool() {
        this.stackHeadPosition++;
        if (this.stackHeadPosition === this.stack.length) {
          const partialState = {
            type: void 0,
            size: 0,
            array: void 0,
            position: 0,
            readCount: 0,
            map: void 0,
            key: null
          };
          this.stack.push(partialState);
        }
        return this.stack[this.stackHeadPosition];
      }
      release(state) {
        const topStackState = this.stack[this.stackHeadPosition];
        if (topStackState !== state) {
          throw new Error("Invalid stack state. Released state is not on top of the stack.");
        }
        if (state.type === STATE_ARRAY) {
          const partialState = state;
          partialState.size = 0;
          partialState.array = void 0;
          partialState.position = 0;
          partialState.type = void 0;
        }
        if (state.type === STATE_MAP_KEY || state.type === STATE_MAP_VALUE) {
          const partialState = state;
          partialState.size = 0;
          partialState.map = void 0;
          partialState.readCount = 0;
          partialState.type = void 0;
        }
        this.stackHeadPosition--;
      }
      reset() {
        this.stack.length = 0;
        this.stackHeadPosition = -1;
      }
    };
    var HEAD_BYTE_REQUIRED = -1;
    var EMPTY_VIEW = new DataView(new ArrayBuffer(0));
    var EMPTY_BYTES = new Uint8Array(EMPTY_VIEW.buffer);
    try {
      EMPTY_VIEW.getInt8(0);
    } catch (e) {
      if (!(e instanceof RangeError)) {
        throw new Error("This module is not supported in the current JavaScript engine because DataView does not throw RangeError on out-of-bounds access");
      }
    }
    var MORE_DATA = new RangeError("Insufficient data");
    var sharedCachedKeyDecoder = new CachedKeyDecoder_ts_1.CachedKeyDecoder();
    var Decoder = class _Decoder {
      extensionCodec;
      context;
      useBigInt64;
      rawStrings;
      maxStrLength;
      maxBinLength;
      maxArrayLength;
      maxMapLength;
      maxExtLength;
      keyDecoder;
      mapKeyConverter;
      totalPos = 0;
      pos = 0;
      view = EMPTY_VIEW;
      bytes = EMPTY_BYTES;
      headByte = HEAD_BYTE_REQUIRED;
      stack = new StackPool();
      entered = false;
      constructor(options) {
        this.extensionCodec = options?.extensionCodec ?? ExtensionCodec_ts_1.ExtensionCodec.defaultCodec;
        this.context = options?.context;
        this.useBigInt64 = options?.useBigInt64 ?? false;
        this.rawStrings = options?.rawStrings ?? false;
        this.maxStrLength = options?.maxStrLength ?? int_ts_1.UINT32_MAX;
        this.maxBinLength = options?.maxBinLength ?? int_ts_1.UINT32_MAX;
        this.maxArrayLength = options?.maxArrayLength ?? int_ts_1.UINT32_MAX;
        this.maxMapLength = options?.maxMapLength ?? int_ts_1.UINT32_MAX;
        this.maxExtLength = options?.maxExtLength ?? int_ts_1.UINT32_MAX;
        this.keyDecoder = options?.keyDecoder !== void 0 ? options.keyDecoder : sharedCachedKeyDecoder;
        this.mapKeyConverter = options?.mapKeyConverter ?? mapKeyConverter;
      }
      clone() {
        return new _Decoder({
          extensionCodec: this.extensionCodec,
          context: this.context,
          useBigInt64: this.useBigInt64,
          rawStrings: this.rawStrings,
          maxStrLength: this.maxStrLength,
          maxBinLength: this.maxBinLength,
          maxArrayLength: this.maxArrayLength,
          maxMapLength: this.maxMapLength,
          maxExtLength: this.maxExtLength,
          keyDecoder: this.keyDecoder
        });
      }
      reinitializeState() {
        this.totalPos = 0;
        this.headByte = HEAD_BYTE_REQUIRED;
        this.stack.reset();
      }
      setBuffer(buffer) {
        const bytes = (0, typedArrays_ts_1.ensureUint8Array)(buffer);
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.pos = 0;
      }
      appendBuffer(buffer) {
        if (this.headByte === HEAD_BYTE_REQUIRED && !this.hasRemaining(1)) {
          this.setBuffer(buffer);
        } else {
          const remainingData = this.bytes.subarray(this.pos);
          const newData = (0, typedArrays_ts_1.ensureUint8Array)(buffer);
          const newBuffer = new Uint8Array(remainingData.length + newData.length);
          newBuffer.set(remainingData);
          newBuffer.set(newData, remainingData.length);
          this.setBuffer(newBuffer);
        }
      }
      hasRemaining(size) {
        return this.view.byteLength - this.pos >= size;
      }
      createExtraByteError(posToShow) {
        const { view, pos } = this;
        return new RangeError(`Extra ${view.byteLength - pos} of ${view.byteLength} byte(s) found at buffer[${posToShow}]`);
      }
      /**
       * @throws {@link DecodeError}
       * @throws {@link RangeError}
       */
      decode(buffer) {
        if (this.entered) {
          const instance = this.clone();
          return instance.decode(buffer);
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.setBuffer(buffer);
          const object = this.doDecodeSync();
          if (this.hasRemaining(1)) {
            throw this.createExtraByteError(this.pos);
          }
          return object;
        } finally {
          this.entered = false;
        }
      }
      *decodeMulti(buffer) {
        if (this.entered) {
          const instance = this.clone();
          yield* instance.decodeMulti(buffer);
          return;
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.setBuffer(buffer);
          while (this.hasRemaining(1)) {
            yield this.doDecodeSync();
          }
        } finally {
          this.entered = false;
        }
      }
      async decodeAsync(stream) {
        if (this.entered) {
          const instance = this.clone();
          return instance.decodeAsync(stream);
        }
        try {
          this.entered = true;
          let decoded = false;
          let object;
          for await (const buffer of stream) {
            if (decoded) {
              this.entered = false;
              throw this.createExtraByteError(this.totalPos);
            }
            this.appendBuffer(buffer);
            try {
              object = this.doDecodeSync();
              decoded = true;
            } catch (e) {
              if (!(e instanceof RangeError)) {
                throw e;
              }
            }
            this.totalPos += this.pos;
          }
          if (decoded) {
            if (this.hasRemaining(1)) {
              throw this.createExtraByteError(this.totalPos);
            }
            return object;
          }
          const { headByte, pos, totalPos } = this;
          throw new RangeError(`Insufficient data in parsing ${(0, prettyByte_ts_1.prettyByte)(headByte)} at ${totalPos} (${pos} in the current buffer)`);
        } finally {
          this.entered = false;
        }
      }
      decodeArrayStream(stream) {
        return this.decodeMultiAsync(stream, true);
      }
      decodeStream(stream) {
        return this.decodeMultiAsync(stream, false);
      }
      async *decodeMultiAsync(stream, isArray) {
        if (this.entered) {
          const instance = this.clone();
          yield* instance.decodeMultiAsync(stream, isArray);
          return;
        }
        try {
          this.entered = true;
          let isArrayHeaderRequired = isArray;
          let arrayItemsLeft = -1;
          for await (const buffer of stream) {
            if (isArray && arrayItemsLeft === 0) {
              throw this.createExtraByteError(this.totalPos);
            }
            this.appendBuffer(buffer);
            if (isArrayHeaderRequired) {
              arrayItemsLeft = this.readArraySize();
              isArrayHeaderRequired = false;
              this.complete();
            }
            try {
              while (true) {
                yield this.doDecodeSync();
                if (--arrayItemsLeft === 0) {
                  break;
                }
              }
            } catch (e) {
              if (!(e instanceof RangeError)) {
                throw e;
              }
            }
            this.totalPos += this.pos;
          }
        } finally {
          this.entered = false;
        }
      }
      doDecodeSync() {
        DECODE: while (true) {
          const headByte = this.readHeadByte();
          let object;
          if (headByte >= 224) {
            object = headByte - 256;
          } else if (headByte < 192) {
            if (headByte < 128) {
              object = headByte;
            } else if (headByte < 144) {
              const size = headByte - 128;
              if (size !== 0) {
                this.pushMapState(size);
                this.complete();
                continue DECODE;
              } else {
                object = {};
              }
            } else if (headByte < 160) {
              const size = headByte - 144;
              if (size !== 0) {
                this.pushArrayState(size);
                this.complete();
                continue DECODE;
              } else {
                object = [];
              }
            } else {
              const byteLength = headByte - 160;
              object = this.decodeString(byteLength, 0);
            }
          } else if (headByte === 192) {
            object = null;
          } else if (headByte === 194) {
            object = false;
          } else if (headByte === 195) {
            object = true;
          } else if (headByte === 202) {
            object = this.readF32();
          } else if (headByte === 203) {
            object = this.readF64();
          } else if (headByte === 204) {
            object = this.readU8();
          } else if (headByte === 205) {
            object = this.readU16();
          } else if (headByte === 206) {
            object = this.readU32();
          } else if (headByte === 207) {
            if (this.useBigInt64) {
              object = this.readU64AsBigInt();
            } else {
              object = this.readU64();
            }
          } else if (headByte === 208) {
            object = this.readI8();
          } else if (headByte === 209) {
            object = this.readI16();
          } else if (headByte === 210) {
            object = this.readI32();
          } else if (headByte === 211) {
            if (this.useBigInt64) {
              object = this.readI64AsBigInt();
            } else {
              object = this.readI64();
            }
          } else if (headByte === 217) {
            const byteLength = this.lookU8();
            object = this.decodeString(byteLength, 1);
          } else if (headByte === 218) {
            const byteLength = this.lookU16();
            object = this.decodeString(byteLength, 2);
          } else if (headByte === 219) {
            const byteLength = this.lookU32();
            object = this.decodeString(byteLength, 4);
          } else if (headByte === 220) {
            const size = this.readU16();
            if (size !== 0) {
              this.pushArrayState(size);
              this.complete();
              continue DECODE;
            } else {
              object = [];
            }
          } else if (headByte === 221) {
            const size = this.readU32();
            if (size !== 0) {
              this.pushArrayState(size);
              this.complete();
              continue DECODE;
            } else {
              object = [];
            }
          } else if (headByte === 222) {
            const size = this.readU16();
            if (size !== 0) {
              this.pushMapState(size);
              this.complete();
              continue DECODE;
            } else {
              object = {};
            }
          } else if (headByte === 223) {
            const size = this.readU32();
            if (size !== 0) {
              this.pushMapState(size);
              this.complete();
              continue DECODE;
            } else {
              object = {};
            }
          } else if (headByte === 196) {
            const size = this.lookU8();
            object = this.decodeBinary(size, 1);
          } else if (headByte === 197) {
            const size = this.lookU16();
            object = this.decodeBinary(size, 2);
          } else if (headByte === 198) {
            const size = this.lookU32();
            object = this.decodeBinary(size, 4);
          } else if (headByte === 212) {
            object = this.decodeExtension(1, 0);
          } else if (headByte === 213) {
            object = this.decodeExtension(2, 0);
          } else if (headByte === 214) {
            object = this.decodeExtension(4, 0);
          } else if (headByte === 215) {
            object = this.decodeExtension(8, 0);
          } else if (headByte === 216) {
            object = this.decodeExtension(16, 0);
          } else if (headByte === 199) {
            const size = this.lookU8();
            object = this.decodeExtension(size, 1);
          } else if (headByte === 200) {
            const size = this.lookU16();
            object = this.decodeExtension(size, 2);
          } else if (headByte === 201) {
            const size = this.lookU32();
            object = this.decodeExtension(size, 4);
          } else {
            throw new DecodeError_ts_1.DecodeError(`Unrecognized type byte: ${(0, prettyByte_ts_1.prettyByte)(headByte)}`);
          }
          this.complete();
          const stack = this.stack;
          while (stack.length > 0) {
            const state = stack.top();
            if (state.type === STATE_ARRAY) {
              state.array[state.position] = object;
              state.position++;
              if (state.position === state.size) {
                object = state.array;
                stack.release(state);
              } else {
                continue DECODE;
              }
            } else if (state.type === STATE_MAP_KEY) {
              if (object === "__proto__") {
                throw new DecodeError_ts_1.DecodeError("The key __proto__ is not allowed");
              }
              state.key = this.mapKeyConverter(object);
              state.type = STATE_MAP_VALUE;
              continue DECODE;
            } else {
              state.map[state.key] = object;
              state.readCount++;
              if (state.readCount === state.size) {
                object = state.map;
                stack.release(state);
              } else {
                state.key = null;
                state.type = STATE_MAP_KEY;
                continue DECODE;
              }
            }
          }
          return object;
        }
      }
      readHeadByte() {
        if (this.headByte === HEAD_BYTE_REQUIRED) {
          this.headByte = this.readU8();
        }
        return this.headByte;
      }
      complete() {
        this.headByte = HEAD_BYTE_REQUIRED;
      }
      readArraySize() {
        const headByte = this.readHeadByte();
        switch (headByte) {
          case 220:
            return this.readU16();
          case 221:
            return this.readU32();
          default: {
            if (headByte < 160) {
              return headByte - 144;
            } else {
              throw new DecodeError_ts_1.DecodeError(`Unrecognized array type byte: ${(0, prettyByte_ts_1.prettyByte)(headByte)}`);
            }
          }
        }
      }
      pushMapState(size) {
        if (size > this.maxMapLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: map length (${size}) > maxMapLengthLength (${this.maxMapLength})`);
        }
        this.stack.pushMapState(size);
      }
      pushArrayState(size) {
        if (size > this.maxArrayLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: array length (${size}) > maxArrayLength (${this.maxArrayLength})`);
        }
        this.stack.pushArrayState(size);
      }
      decodeString(byteLength, headerOffset) {
        if (!this.rawStrings || this.stateIsMapKey()) {
          return this.decodeUtf8String(byteLength, headerOffset);
        }
        return this.decodeBinary(byteLength, headerOffset);
      }
      /**
       * @throws {@link RangeError}
       */
      decodeUtf8String(byteLength, headerOffset) {
        if (byteLength > this.maxStrLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: UTF-8 byte length (${byteLength}) > maxStrLength (${this.maxStrLength})`);
        }
        if (this.bytes.byteLength < this.pos + headerOffset + byteLength) {
          throw MORE_DATA;
        }
        const offset = this.pos + headerOffset;
        let object;
        if (this.stateIsMapKey() && this.keyDecoder?.canBeCached(byteLength)) {
          object = this.keyDecoder.decode(this.bytes, offset, byteLength);
        } else {
          object = (0, utf8_ts_1.utf8Decode)(this.bytes, offset, byteLength);
        }
        this.pos += headerOffset + byteLength;
        return object;
      }
      stateIsMapKey() {
        if (this.stack.length > 0) {
          const state = this.stack.top();
          return state.type === STATE_MAP_KEY;
        }
        return false;
      }
      /**
       * @throws {@link RangeError}
       */
      decodeBinary(byteLength, headOffset) {
        if (byteLength > this.maxBinLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: bin length (${byteLength}) > maxBinLength (${this.maxBinLength})`);
        }
        if (!this.hasRemaining(byteLength + headOffset)) {
          throw MORE_DATA;
        }
        const offset = this.pos + headOffset;
        const object = this.bytes.subarray(offset, offset + byteLength);
        this.pos += headOffset + byteLength;
        return object;
      }
      decodeExtension(size, headOffset) {
        if (size > this.maxExtLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: ext length (${size}) > maxExtLength (${this.maxExtLength})`);
        }
        const extType = this.view.getInt8(this.pos + headOffset);
        const data = this.decodeBinary(
          size,
          headOffset + 1
          /* extType */
        );
        return this.extensionCodec.decode(data, extType, this.context);
      }
      lookU8() {
        return this.view.getUint8(this.pos);
      }
      lookU16() {
        return this.view.getUint16(this.pos);
      }
      lookU32() {
        return this.view.getUint32(this.pos);
      }
      readU8() {
        const value = this.view.getUint8(this.pos);
        this.pos++;
        return value;
      }
      readI8() {
        const value = this.view.getInt8(this.pos);
        this.pos++;
        return value;
      }
      readU16() {
        const value = this.view.getUint16(this.pos);
        this.pos += 2;
        return value;
      }
      readI16() {
        const value = this.view.getInt16(this.pos);
        this.pos += 2;
        return value;
      }
      readU32() {
        const value = this.view.getUint32(this.pos);
        this.pos += 4;
        return value;
      }
      readI32() {
        const value = this.view.getInt32(this.pos);
        this.pos += 4;
        return value;
      }
      readU64() {
        const value = (0, int_ts_1.getUint64)(this.view, this.pos);
        this.pos += 8;
        return value;
      }
      readI64() {
        const value = (0, int_ts_1.getInt64)(this.view, this.pos);
        this.pos += 8;
        return value;
      }
      readU64AsBigInt() {
        const value = this.view.getBigUint64(this.pos);
        this.pos += 8;
        return value;
      }
      readI64AsBigInt() {
        const value = this.view.getBigInt64(this.pos);
        this.pos += 8;
        return value;
      }
      readF32() {
        const value = this.view.getFloat32(this.pos);
        this.pos += 4;
        return value;
      }
      readF64() {
        const value = this.view.getFloat64(this.pos);
        this.pos += 8;
        return value;
      }
    };
    exports.Decoder = Decoder;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/decode.cjs
var require_decode = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/decode.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decode = decode;
    exports.decodeMulti = decodeMulti;
    var Decoder_ts_1 = require_Decoder();
    function decode(buffer, options) {
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decode(buffer);
    }
    function decodeMulti(buffer, options) {
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeMulti(buffer);
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/stream.cjs
var require_stream = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/stream.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isAsyncIterable = isAsyncIterable;
    exports.asyncIterableFromStream = asyncIterableFromStream;
    exports.ensureAsyncIterable = ensureAsyncIterable;
    function isAsyncIterable(object) {
      return object[Symbol.asyncIterator] != null;
    }
    async function* asyncIterableFromStream(stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            return;
          }
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    }
    function ensureAsyncIterable(streamLike) {
      if (isAsyncIterable(streamLike)) {
        return streamLike;
      } else {
        return asyncIterableFromStream(streamLike);
      }
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/decodeAsync.cjs
var require_decodeAsync = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/decodeAsync.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decodeAsync = decodeAsync;
    exports.decodeArrayStream = decodeArrayStream;
    exports.decodeMultiStream = decodeMultiStream2;
    var Decoder_ts_1 = require_Decoder();
    var stream_ts_1 = require_stream();
    async function decodeAsync(streamLike, options) {
      const stream = (0, stream_ts_1.ensureAsyncIterable)(streamLike);
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeAsync(stream);
    }
    function decodeArrayStream(streamLike, options) {
      const stream = (0, stream_ts_1.ensureAsyncIterable)(streamLike);
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeArrayStream(stream);
    }
    function decodeMultiStream2(streamLike, options) {
      const stream = (0, stream_ts_1.ensureAsyncIterable)(streamLike);
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeStream(stream);
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/index.cjs
var require_dist = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/index.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decodeTimestampExtension = exports.encodeTimestampExtension = exports.decodeTimestampToTimeSpec = exports.encodeTimeSpecToTimestamp = exports.encodeDateToTimeSpec = exports.EXT_TIMESTAMP = exports.ExtData = exports.ExtensionCodec = exports.Encoder = exports.DecodeError = exports.Decoder = exports.decodeMultiStream = exports.decodeArrayStream = exports.decodeAsync = exports.decodeMulti = exports.decode = exports.encode = void 0;
    var encode_ts_1 = require_encode();
    Object.defineProperty(exports, "encode", { enumerable: true, get: function() {
      return encode_ts_1.encode;
    } });
    var decode_ts_1 = require_decode();
    Object.defineProperty(exports, "decode", { enumerable: true, get: function() {
      return decode_ts_1.decode;
    } });
    Object.defineProperty(exports, "decodeMulti", { enumerable: true, get: function() {
      return decode_ts_1.decodeMulti;
    } });
    var decodeAsync_ts_1 = require_decodeAsync();
    Object.defineProperty(exports, "decodeAsync", { enumerable: true, get: function() {
      return decodeAsync_ts_1.decodeAsync;
    } });
    Object.defineProperty(exports, "decodeArrayStream", { enumerable: true, get: function() {
      return decodeAsync_ts_1.decodeArrayStream;
    } });
    Object.defineProperty(exports, "decodeMultiStream", { enumerable: true, get: function() {
      return decodeAsync_ts_1.decodeMultiStream;
    } });
    var Decoder_ts_1 = require_Decoder();
    Object.defineProperty(exports, "Decoder", { enumerable: true, get: function() {
      return Decoder_ts_1.Decoder;
    } });
    var DecodeError_ts_1 = require_DecodeError();
    Object.defineProperty(exports, "DecodeError", { enumerable: true, get: function() {
      return DecodeError_ts_1.DecodeError;
    } });
    var Encoder_ts_1 = require_Encoder();
    Object.defineProperty(exports, "Encoder", { enumerable: true, get: function() {
      return Encoder_ts_1.Encoder;
    } });
    var ExtensionCodec_ts_1 = require_ExtensionCodec();
    Object.defineProperty(exports, "ExtensionCodec", { enumerable: true, get: function() {
      return ExtensionCodec_ts_1.ExtensionCodec;
    } });
    var ExtData_ts_1 = require_ExtData();
    Object.defineProperty(exports, "ExtData", { enumerable: true, get: function() {
      return ExtData_ts_1.ExtData;
    } });
    var timestamp_ts_1 = require_timestamp();
    Object.defineProperty(exports, "EXT_TIMESTAMP", { enumerable: true, get: function() {
      return timestamp_ts_1.EXT_TIMESTAMP;
    } });
    Object.defineProperty(exports, "encodeDateToTimeSpec", { enumerable: true, get: function() {
      return timestamp_ts_1.encodeDateToTimeSpec;
    } });
    Object.defineProperty(exports, "encodeTimeSpecToTimestamp", { enumerable: true, get: function() {
      return timestamp_ts_1.encodeTimeSpecToTimestamp;
    } });
    Object.defineProperty(exports, "decodeTimestampToTimeSpec", { enumerable: true, get: function() {
      return timestamp_ts_1.decodeTimestampToTimeSpec;
    } });
    Object.defineProperty(exports, "encodeTimestampExtension", { enumerable: true, get: function() {
      return timestamp_ts_1.encodeTimestampExtension;
    } });
    Object.defineProperty(exports, "decodeTimestampExtension", { enumerable: true, get: function() {
      return timestamp_ts_1.decodeTimestampExtension;
    } });
  }
});

// src/index.ts
import { Key, isKeyRelease as isKeyRelease2, matchesKey as matchesKey3 } from "@earendil-works/pi-tui";

// src/paths.ts
import { opendirSync, statSync } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
var MAX_COMPLETIONS = 500;
var MAX_LIST_ENTRIES = 1e4;
function parseArg(raw) {
  const s = raw.replace(/^\s+/, "");
  let logical = "";
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else logical += c;
    } else if (quote === '"') {
      if (c === "\\" && (s[i + 1] === '"' || s[i + 1] === "\\")) logical += s[++i];
      else if (c === '"') quote = null;
      else logical += c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else {
      logical += c;
    }
  }
  return { logical, flag: s.startsWith("-"), url: /^[\w+.-]+:\/\//.test(logical) };
}
function expandHome(value) {
  if (value === "~") return homedir();
  return value.startsWith("~/") || path.sep === "\\" && value.startsWith("~\\") ? path.join(homedir(), value.slice(2)) : value;
}
function resolvePath(args, cwd) {
  const { logical, flag, url } = parseArg(args);
  if (logical === "") throw new Error("no path given");
  if (flag) throw new Error(`flags are not supported: ${args.trim()}`);
  if (url) throw new Error(`URLs are not supported: ${args.trim()}`);
  return path.resolve(cwd, expandHome(logical));
}
function byDirThenName(a, b2) {
  if (a.directory !== b2.directory) return a.directory ? -1 : 1;
  return a.name < b2.name ? -1 : a.name > b2.name ? 1 : 0;
}
function completePath(args, cwd) {
  const { logical, flag, url } = parseArg(args);
  if (flag || url) return null;
  const tilde = logical === "~" || logical.startsWith("~/") || path.sep === "\\" && logical.startsWith("~\\");
  const sep3 = Math.max(logical.lastIndexOf("/"), path.sep === "\\" ? logical.lastIndexOf("\\") : -1);
  let dirLogical;
  let base;
  if (tilde && sep3 <= 1) {
    dirLogical = "~";
    base = sep3 === -1 ? "" : logical.slice(2);
  } else if (sep3 === -1) {
    dirLogical = path.sep === "\\" && /^[A-Za-z]:/.test(logical) ? logical.slice(0, 2) : "";
    base = logical.slice(dirLogical.length);
  } else {
    dirLogical = logical.slice(0, sep3 + 1);
    base = logical.slice(sep3 + 1);
  }
  const dirAbs = path.resolve(cwd, expandHome(dirLogical));
  let dirents = [];
  try {
    const directory = opendirSync(dirAbs);
    try {
      for (let i = 0; i < MAX_LIST_ENTRIES; i++) {
        const entry = directory.readSync();
        if (!entry) break;
        dirents.push(entry);
      }
    } finally {
      directory.closeSync();
    }
  } catch {
    return null;
  }
  const showHidden = base.startsWith(".");
  const head = sep3 === -1 ? tilde ? "~/" : dirLogical : logical.slice(0, sep3 + 1);
  const rows = [];
  for (const d2 of dirents) {
    if (/[\x00-\x1f\x7f-\x9f]/.test(d2.name)) continue;
    if (!d2.name.startsWith(base)) continue;
    if (!showHidden && d2.name.startsWith(".")) continue;
    let directory = d2.isDirectory();
    if (!directory && d2.isSymbolicLink()) {
      try {
        directory = statSync(path.join(dirAbs, d2.name)).isDirectory();
      } catch {
      }
    }
    rows.push({
      name: d2.name,
      directory,
      value: serializeValue(!head && !tilde && d2.name === "~" ? "./~" : head + d2.name, directory),
      label: d2.name + (directory ? "/" : "")
    });
    if (rows.length >= MAX_COMPLETIONS) break;
  }
  if (rows.length === 0) return null;
  rows.sort(byDirThenName);
  return rows.map(({ value, label }) => ({ value, label }));
}
function serializeValue(full, directory = false) {
  const withSep = directory && !full.endsWith("/") && !(path.sep === "\\" && full.endsWith("\\")) ? `${full}/` : full;
  if (!/[\s"']/.test(withSep) && !withSep.startsWith("-")) return withSep;
  return `"${withSep.replace(/[\\"]/g, "\\$&")}${directory ? "" : '"'}`;
}
async function listDirectory(dirPath) {
  const rows = [];
  for await (const entry of await opendir(dirPath)) {
    const full = path.join(dirPath, entry.name);
    const directory = entry.isDirectory() || entry.isSymbolicLink() && await stat(full).then((info) => info.isDirectory(), () => false);
    rows.push({ name: entry.name, path: full, directory });
    if (rows.length >= MAX_LIST_ENTRIES) break;
  }
  rows.sort(byDirThenName);
  return rows;
}

// src/documents.ts
import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join as join2, resolve as resolve2 } from "node:path";
import { fileURLToPath as fileURLToPath2, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

// node_modules/marked/lib/marked.esm.js
function M() {
  return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
}
var T = M();
function N(l3) {
  T = l3;
}
var _ = { exec: () => null };
function E(l3) {
  let e = [];
  return (t) => {
    let n = Math.max(0, Math.min(3, t - 1)), s = e[n];
    return s || (s = l3(n), e[n] = s), s;
  };
}
function d(l3, e = "") {
  let t = typeof l3 == "string" ? l3 : l3.source, n = { replace: (s, r) => {
    let i = typeof r == "string" ? r : r.source;
    return i = i.replace(m.caret, "$1"), t = t.replace(s, i), n;
  }, getRegex: () => new RegExp(t, e) };
  return n;
}
var Te = ((l3 = "") => {
  try {
    return !!new RegExp("(?<=1)(?<!1)" + l3);
  } catch {
    return false;
  }
})();
var m = { codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] +\S/, listReplaceTask: /^\[[ xX]\] +/, listTaskCheckbox: /\[[ xX]\]/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (l3) => new RegExp(`^( {0,3}${l3})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: E((l3) => new RegExp(`^ {0,${l3}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)), hrRegex: E((l3) => new RegExp(`^ {0,${l3}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`)), fencesBeginRegex: E((l3) => new RegExp(`^ {0,${l3}}(?:\`\`\`|~~~)`)), headingBeginRegex: E((l3) => new RegExp(`^ {0,${l3}}#`)), htmlBeginRegex: E((l3) => new RegExp(`^ {0,${l3}}<(?:[a-z].*>|!--)`, "i")), blockquoteBeginRegex: E((l3) => new RegExp(`^ {0,${l3}}>`)) };
var Oe = /^(?:[ \t]*(?:\n|$))+/;
var we = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var ye = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var B = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var Pe = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var j = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
var oe = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
var ae = d(oe).replace(/bull/g, j).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
var Se = d(oe).replace(/bull/g, j).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
var F = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/;
var $e = /^[^\n]+/;
var U = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
var Le = d(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", U).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var _e = d(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, j).getRegex();
var H = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var K = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var ze = d("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", K).replace("tag", H).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var le = d(F).replace("hr", B).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", H).getRegex();
var Me = d(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", le).getRegex();
var W = { blockquote: Me, code: we, def: Le, fences: ye, heading: Pe, hr: B, html: ze, lheading: ae, list: _e, newline: Oe, paragraph: le, table: _, text: $e };
var se = d("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", B).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", H).getRegex();
var Ee = { ...W, lheading: Se, table: se, paragraph: d(F).replace("hr", B).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", se).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", H).getRegex() };
var Ie = { ...W, html: d(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", K).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: _, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: d(F).replace("hr", B).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", ae).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
var Ae = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var Ce = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var ue = /^( {2,}|\\)\n(?!\s*$)/;
var Be = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var I = /[\p{P}\p{S}]/u;
var Z = /[\s\p{P}\p{S}]/u;
var X = /[^\s\p{P}\p{S}]/u;
var De = d(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, Z).getRegex();
var pe = /(?!~)[\p{P}\p{S}]/u;
var qe = /(?!~)[\s\p{P}\p{S}]/u;
var ve = /(?:[^\s\p{P}\p{S}]|~)/u;
var He = d(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", Te ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var ce = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
var Ze = d(ce, "u").replace(/punct/g, I).getRegex();
var Ge = d(ce, "u").replace(/punct/g, pe).getRegex();
var he = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var Ne = d(he, "gu").replace(/notPunctSpace/g, X).replace(/punctSpace/g, Z).replace(/punct/g, I).getRegex();
var Qe = d(he, "gu").replace(/notPunctSpace/g, ve).replace(/punctSpace/g, qe).replace(/punct/g, pe).getRegex();
var je = d("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, X).replace(/punctSpace/g, Z).replace(/punct/g, I).getRegex();
var Fe = d(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, I).getRegex();
var Ue = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
var Ke = d(Ue, "gu").replace(/notPunctSpace/g, X).replace(/punctSpace/g, Z).replace(/punct/g, I).getRegex();
var We = d(/\\(punct)/, "gu").replace(/punct/g, I).getRegex();
var Xe = d(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var Je = d(K).replace("(?:-->|$)", "-->").getRegex();
var Ve = d("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", Je).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var v = /(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/;
var Ye = d(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?\s*\)/).replace("label", v).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var ke = d(/^!?\[(label)\]\[(ref)\]/).replace("label", v).replace("ref", U).getRegex();
var de = d(/^!?\[(ref)\](?:\[\])?/).replace("ref", U).getRegex();
var et = d("reflink|nolink(?!\\()", "g").replace("reflink", ke).replace("nolink", de).getRegex();
var ie = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var J = { _backpedal: _, anyPunctuation: We, autolink: Xe, blockSkip: He, br: ue, code: Ce, del: _, delLDelim: _, delRDelim: _, emStrongLDelim: Ze, emStrongRDelimAst: Ne, emStrongRDelimUnd: je, escape: Ae, link: Ye, nolink: de, punctuation: De, reflink: ke, reflinkSearch: et, tag: Ve, text: Be, url: _ };
var tt = { ...J, link: d(/^!?\[(label)\]\((.*?)\)/).replace("label", v).getRegex(), reflink: d(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", v).getRegex() };
var Q = { ...J, emStrongRDelimAst: Qe, emStrongLDelim: Ge, delLDelim: Fe, delRDelim: Ke, url: d(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol", ie).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: d(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol", ie).getRegex() };
var nt = { ...Q, br: d(ue).replace("{2,}", "*").getRegex(), text: d(Q.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() };
var D = { normal: W, gfm: Ee, pedantic: Ie };
var A = { normal: J, gfm: Q, breaks: nt, pedantic: tt };
var rt = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var ge = (l3) => rt[l3];
function O(l3, e) {
  if (e) {
    if (m.escapeTest.test(l3)) return l3.replace(m.escapeReplace, ge);
  } else if (m.escapeTestNoEncode.test(l3)) return l3.replace(m.escapeReplaceNoEncode, ge);
  return l3;
}
function V(l3) {
  try {
    l3 = encodeURI(l3).replace(m.percentDecode, "%");
  } catch {
    return null;
  }
  return l3;
}
function Y(l3, e) {
  let t = l3.replace(m.findPipe, (r, i, o) => {
    let u = false, a = i;
    for (; --a >= 0 && o[a] === "\\"; ) u = !u;
    return u ? "|" : " |";
  }), n = t.split(m.splitPipe), s = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
  else for (; n.length < e; ) n.push("");
  for (; s < n.length; s++) n[s] = n[s].trim().replace(m.slashPipe, "|");
  return n;
}
function $(l3, e, t) {
  let n = l3.length;
  if (n === 0) return "";
  let s = 0;
  for (; s < n; ) {
    let r = l3.charAt(n - s - 1);
    if (r === e && !t) s++;
    else if (r !== e && t) s++;
    else break;
  }
  return l3.slice(0, n - s);
}
function ee(l3) {
  let e = l3.split(`
`), t = e.length - 1;
  for (; t >= 0 && m.blankLine.test(e[t]); ) t--;
  return e.length - t <= 2 ? l3 : e.slice(0, t + 1).join(`
`);
}
function fe(l3, e) {
  if (l3.indexOf(e[1]) === -1) return -1;
  let t = 0;
  for (let n = 0; n < l3.length; n++) if (l3[n] === "\\") n++;
  else if (l3[n] === e[0]) t++;
  else if (l3[n] === e[1] && (t--, t < 0)) return n;
  return t > 0 ? -2 : -1;
}
function me(l3, e = 0) {
  let t = e, n = "";
  for (let s of l3) if (s === "	") {
    let r = 4 - t % 4;
    n += " ".repeat(r), t += r;
  } else n += s, t++;
  return n;
}
function xe(l3, e, t, n, s) {
  let r = e.href, i = e.title || null, o = l3[1].replace(s.other.outputLinkReplace, "$1");
  n.state.inLink = true;
  let u = { type: l3[0].charAt(0) === "!" ? "image" : "link", raw: t, href: r, title: i, text: o, tokens: n.inlineTokens(o) };
  return n.state.inLink = false, u;
}
function st(l3, e, t) {
  let n = l3.match(t.other.indentCodeCompensation);
  if (n === null) return e;
  let s = n[1];
  return e.split(`
`).map((r) => {
    let i = r.match(t.other.beginningSpace);
    if (i === null) return r;
    let [o] = i;
    return o.length >= s.length ? r.slice(s.length) : r;
  }).join(`
`);
}
var w = class {
  options;
  rules;
  lexer;
  constructor(e) {
    this.options = e || T;
  }
  space(e) {
    let t = this.rules.block.newline.exec(e);
    if (t && t[0].length > 0) return { type: "space", raw: t[0] };
  }
  code(e) {
    let t = this.rules.block.code.exec(e);
    if (t) {
      let n = this.options.pedantic ? t[0] : ee(t[0]), s = n.replace(this.rules.other.codeRemoveIndent, "");
      return { type: "code", raw: n, codeBlockStyle: "indented", text: s };
    }
  }
  fences(e) {
    let t = this.rules.block.fences.exec(e);
    if (t) {
      let n = t[0], s = st(n, t[3] || "", this.rules);
      return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: s };
    }
  }
  heading(e) {
    let t = this.rules.block.heading.exec(e);
    if (t) {
      let n = t[2].trim();
      if (this.rules.other.endingHash.test(n)) {
        let s = $(n, "#");
        (this.options.pedantic || !s || this.rules.other.endingSpaceChar.test(s)) && (n = s.trim());
      }
      return { type: "heading", raw: $(t[0], `
`), depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
    }
  }
  hr(e) {
    let t = this.rules.block.hr.exec(e);
    if (t) return { type: "hr", raw: $(t[0], `
`) };
  }
  blockquote(e) {
    let t = this.rules.block.blockquote.exec(e);
    if (t) {
      let n = $(t[0], `
`).split(`
`), s = "", r = "", i = [];
      for (; n.length > 0; ) {
        let o = false, u = [], a;
        for (a = 0; a < n.length; a++) if (this.rules.other.blockquoteStart.test(n[a])) u.push(n[a]), o = true;
        else if (!o) u.push(n[a]);
        else break;
        n = n.slice(a);
        let c = u.join(`
`), p = c.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
        s = s ? `${s}
${c}` : c, r = r ? `${r}
${p}` : p;
        let k = this.lexer.state.top;
        if (this.lexer.state.top = true, this.lexer.blockTokens(p, i, true), this.lexer.state.top = k, n.length === 0) break;
        let h = i.at(-1);
        if (h?.type === "code") break;
        if (h?.type === "blockquote") {
          let R = h, f = R.raw + `
` + n.join(`
`), S = this.blockquote(f);
          i[i.length - 1] = S, s = s.substring(0, s.length - R.raw.length) + S.raw, r = r.substring(0, r.length - R.text.length) + S.text;
          break;
        } else if (h?.type === "list") {
          let R = h, f = R.raw + `
` + n.join(`
`), S = this.list(f);
          i[i.length - 1] = S, s = s.substring(0, s.length - h.raw.length) + S.raw, r = r.substring(0, r.length - R.raw.length) + S.raw, n = f.substring(i.at(-1).raw.length).split(`
`);
          continue;
        }
      }
      return { type: "blockquote", raw: s, tokens: i, text: r };
    }
  }
  list(e) {
    let t = this.rules.block.list.exec(e);
    if (t) {
      let n = t[1].trim(), s = n.length > 1, r = { type: "list", raw: "", ordered: s, start: s ? +n.slice(0, -1) : "", loose: false, items: [] };
      n = s ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = s ? n : "[*+-]");
      let i = this.rules.other.listItemRegex(n), o = false;
      for (; e; ) {
        let a = false, c = "", p = "";
        if (!(t = i.exec(e)) || this.rules.block.hr.test(e)) break;
        c = t[0], e = e.substring(c.length);
        let k = me(t[2].split(`
`, 1)[0], t[1].length), h = e.split(`
`, 1)[0], R = !k.trim(), f = 0;
        if (this.options.pedantic ? (f = 2, p = k.trimStart()) : R ? f = t[1].length + 1 : (f = k.search(this.rules.other.nonSpaceChar), f = f > 4 ? 1 : f, p = k.slice(f), f += t[1].length), R && this.rules.other.blankLine.test(h) && (c += h + `
`, e = e.substring(h.length + 1), a = true), !a) {
          let S = this.rules.other.nextBulletRegex(f), te = this.rules.other.hrRegex(f), ne = this.rules.other.fencesBeginRegex(f), re = this.rules.other.headingBeginRegex(f), be = this.rules.other.htmlBeginRegex(f), Re = this.rules.other.blockquoteBeginRegex(f);
          for (; e; ) {
            let G = e.split(`
`, 1)[0], C;
            if (h = G, this.options.pedantic ? (h = h.replace(this.rules.other.listReplaceNesting, "  "), C = h) : C = h.replace(this.rules.other.tabCharGlobal, "    "), ne.test(h) || re.test(h) || be.test(h) || Re.test(h) || S.test(h) || te.test(h)) break;
            if (C.search(this.rules.other.nonSpaceChar) >= f || !h.trim()) p += `
` + C.slice(f);
            else {
              if (R || k.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || ne.test(k) || re.test(k) || te.test(k)) break;
              p += `
` + h;
            }
            R = !h.trim(), c += G + `
`, e = e.substring(G.length + 1), k = C.slice(f);
          }
        }
        r.loose || (o ? r.loose = true : this.rules.other.doubleBlankLine.test(c) && (o = true)), r.items.push({ type: "list_item", raw: c, task: !!this.options.gfm && this.rules.other.listIsTask.test(p), loose: false, text: p, tokens: [] }), r.raw += c;
      }
      let u = r.items.at(-1);
      if (u) u.raw = u.raw.trimEnd(), u.text = u.text.trimEnd();
      else return;
      r.raw = r.raw.trimEnd();
      for (let a of r.items) {
        this.lexer.state.top = false, a.tokens = this.lexer.blockTokens(a.text, []);
        let c = a.tokens[0];
        if (a.task && (c?.type === "text" || c?.type === "paragraph")) {
          a.text = a.text.replace(this.rules.other.listReplaceTask, ""), c.raw = c.raw.replace(this.rules.other.listReplaceTask, ""), c.text = c.text.replace(this.rules.other.listReplaceTask, "");
          for (let k = this.lexer.inlineQueue.length - 1; k >= 0; k--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[k].src)) {
            this.lexer.inlineQueue[k].src = this.lexer.inlineQueue[k].src.replace(this.rules.other.listReplaceTask, "");
            break;
          }
          let p = this.rules.other.listTaskCheckbox.exec(a.raw);
          if (p) {
            let k = { type: "checkbox", raw: p[0] + " ", checked: p[0] !== "[ ]" };
            a.checked = k.checked, r.loose ? a.tokens[0] && ["paragraph", "text"].includes(a.tokens[0].type) && "tokens" in a.tokens[0] && a.tokens[0].tokens ? (a.tokens[0].raw = k.raw + a.tokens[0].raw, a.tokens[0].text = k.raw + a.tokens[0].text, a.tokens[0].tokens.unshift(k)) : a.tokens.unshift({ type: "paragraph", raw: k.raw, text: k.raw, tokens: [k] }) : a.tokens.unshift(k);
          }
        } else a.task && (a.task = false);
        if (!r.loose) {
          let p = a.tokens.filter((h) => h.type === "space"), k = p.length > 0 && p.some((h) => this.rules.other.anyLine.test(h.raw));
          r.loose = k;
        }
      }
      if (r.loose) for (let a of r.items) {
        a.loose = true;
        for (let c of a.tokens) c.type === "text" && (c.type = "paragraph");
      }
      return r;
    }
  }
  html(e) {
    let t = this.rules.block.html.exec(e);
    if (t) {
      let n = ee(t[0]);
      return { type: "html", block: true, raw: n, pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: n };
    }
  }
  def(e) {
    let t = this.rules.block.def.exec(e);
    if (t) {
      let n = t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, " "), s = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
      return { type: "def", tag: n, raw: $(t[0], `
`), href: s, title: r };
    }
  }
  table(e) {
    let t = this.rules.block.table.exec(e);
    if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
    let n = Y(t[1]), s = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], i = { type: "table", raw: $(t[0], `
`), header: [], align: [], rows: [] };
    if (n.length === s.length) {
      for (let o of s) this.rules.other.tableAlignRight.test(o) ? i.align.push("right") : this.rules.other.tableAlignCenter.test(o) ? i.align.push("center") : this.rules.other.tableAlignLeft.test(o) ? i.align.push("left") : i.align.push(null);
      for (let o = 0; o < n.length; o++) i.header.push({ text: n[o], tokens: this.lexer.inline(n[o]), header: true, align: i.align[o] });
      for (let o of r) i.rows.push(Y(o, i.header.length).map((u, a) => ({ text: u, tokens: this.lexer.inline(u), header: false, align: i.align[a] })));
      return i;
    }
  }
  lheading(e) {
    let t = this.rules.block.lheading.exec(e);
    if (t) {
      let n = t[1].trim();
      return { type: "heading", raw: $(t[0], `
`), depth: t[2].charAt(0) === "=" ? 1 : 2, text: n, tokens: this.lexer.inline(n) };
    }
  }
  paragraph(e) {
    let t = this.rules.block.paragraph.exec(e);
    if (t) {
      let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
      return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
    }
  }
  text(e) {
    let t = this.rules.block.text.exec(e);
    if (t) return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
  }
  escape(e) {
    let t = this.rules.inline.escape.exec(e);
    if (t) return { type: "escape", raw: t[0], text: t[1] };
  }
  tag(e) {
    let t = this.rules.inline.tag.exec(e);
    if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
  }
  link(e) {
    let t = this.rules.inline.link.exec(e);
    if (t) {
      let n = t[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(n)) {
        if (!this.rules.other.endAngleBracket.test(n)) return;
        let i = $(n.slice(0, -1), "\\");
        if ((n.length - i.length) % 2 === 0) return;
      } else {
        let i = fe(t[2], "()");
        if (i === -2) return;
        if (i > -1) {
          let u = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + i;
          t[2] = t[2].substring(0, i), t[0] = t[0].substring(0, u).trim(), t[3] = "";
        }
      }
      let s = t[2], r = "";
      if (this.options.pedantic) {
        let i = this.rules.other.pedanticHrefTitle.exec(s);
        i && (s = i[1], r = i[3]);
      } else r = t[3] ? t[3].slice(1, -1) : "";
      return s = s.trim(), this.rules.other.startAngleBracket.test(s) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(n) ? s = s.slice(1) : s = s.slice(1, -1)), xe(t, { href: s && s.replace(this.rules.inline.anyPunctuation, "$1"), title: r && r.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
    }
  }
  reflink(e, t) {
    let n;
    if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
      let s = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), r = t[s.toLowerCase()];
      if (!r) {
        let i = n[0].charAt(0);
        return { type: "text", raw: i, text: i };
      }
      return xe(n, r, n[0], this.lexer, this.rules);
    }
  }
  emStrong(e, t, n = "") {
    let s = this.rules.inline.emStrongLDelim.exec(e);
    if (!s || !s[1] && !s[2] && !s[3] && !s[4] || s[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
    if (!(s[1] || s[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let i = [...s[0]].length - 1, o, u, a = i, c = 0, p = s[0][0] === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      for (p.lastIndex = 0, t = t.slice(-1 * e.length + i); (s = p.exec(t)) !== null; ) {
        if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o) continue;
        if (u = [...o].length, s[3] || s[4]) {
          a += u;
          continue;
        } else if ((s[5] || s[6]) && i % 3 && !((i + u) % 3)) {
          c += u;
          continue;
        }
        if (a -= u, a > 0) continue;
        u = Math.min(u, u + a + c);
        let k = [...s[0]][0].length, h = e.slice(0, i + s.index + k + u);
        if (Math.min(i, u) % 2) {
          let f = h.slice(1, -1);
          return { type: "em", raw: h, text: f, tokens: this.lexer.inlineTokens(f) };
        }
        let R = h.slice(2, -2);
        return { type: "strong", raw: h, text: R, tokens: this.lexer.inlineTokens(R) };
      }
    }
  }
  codespan(e) {
    let t = this.rules.inline.code.exec(e);
    if (t) {
      let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), s = this.rules.other.nonSpaceChar.test(n), r = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
      return s && r && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
    }
  }
  br(e) {
    let t = this.rules.inline.br.exec(e);
    if (t) return { type: "br", raw: t[0] };
  }
  del(e, t, n = "") {
    let s = this.rules.inline.delLDelim.exec(e);
    if (!s) return;
    if (!(s[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let i = [...s[0]].length - 1, o, u, a = i, c = this.rules.inline.delRDelim;
      for (c.lastIndex = 0, t = t.slice(-1 * e.length + i); (s = c.exec(t)) !== null; ) {
        if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o || (u = [...o].length, u !== i)) continue;
        if (s[3] || s[4]) {
          a += u;
          continue;
        }
        if (a -= u, a > 0) continue;
        u = Math.min(u, u + a);
        let p = [...s[0]][0].length, k = e.slice(0, i + s.index + p + u), h = k.slice(i, -i);
        return { type: "del", raw: k, text: h, tokens: this.lexer.inlineTokens(h) };
      }
    }
  }
  autolink(e) {
    let t = this.rules.inline.autolink.exec(e);
    if (t) {
      let n, s;
      return t[2] === "@" ? (n = t[1], s = "mailto:" + n) : (n = t[1], s = n), { type: "link", raw: t[0], text: n, href: s, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  url(e) {
    let t;
    if (t = this.rules.inline.url.exec(e)) {
      let n, s;
      if (t[2] === "@") n = t[0], s = "mailto:" + n;
      else {
        let r;
        do
          r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
        while (r !== t[0]);
        n = t[0], t[1] === "www." ? s = "http://" + t[0] : s = t[0];
      }
      return { type: "link", raw: t[0], text: n, href: s, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  inlineText(e) {
    let t = this.rules.inline.text.exec(e);
    if (t) {
      let n = this.lexer.state.inRawBlock;
      return { type: "text", raw: t[0], text: t[0], escaped: n };
    }
  }
};
var x = class l {
  tokens;
  options;
  state;
  inlineQueue;
  tokenizer;
  constructor(e) {
    this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = e || T, this.options.tokenizer = this.options.tokenizer || new w(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, top: true };
    let t = { other: m, block: D.normal, inline: A.normal };
    this.options.pedantic ? (t.block = D.pedantic, t.inline = A.pedantic) : this.options.gfm && (t.block = D.gfm, this.options.breaks ? t.inline = A.breaks : t.inline = A.gfm), this.tokenizer.rules = t;
  }
  static get rules() {
    return { block: D, inline: A };
  }
  static lex(e, t) {
    return new l(t).lex(e);
  }
  static lexInline(e, t) {
    return new l(t).inlineTokens(e);
  }
  lex(e) {
    e = e.replace(m.carriageReturn, `
`), this.blockTokens(e, this.tokens);
    for (let t = 0; t < this.inlineQueue.length; t++) {
      let n = this.inlineQueue[t];
      this.inlineTokens(n.src, n.tokens);
    }
    return this.inlineQueue = [], this.tokens;
  }
  blockTokens(e, t = [], n = false) {
    this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(m.tabCharGlobal, "    ").replace(m.spaceLine, ""));
    let s = 1 / 0;
    for (; e; ) {
      if (e.length < s) s = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      let r;
      if (this.options.extensions?.block?.some((o) => (r = o.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), true) : false)) continue;
      if (r = this.tokenizer.space(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        r.raw.length === 1 && o !== void 0 ? o.raw += `
` : t.push(r);
        continue;
      }
      if (r = this.tokenizer.code(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.at(-1).src = o.text) : t.push(r);
        continue;
      }
      if (r = this.tokenizer.fences(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.heading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.hr(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.blockquote(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.list(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.html(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.def(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.raw, this.inlineQueue.at(-1).src = o.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = { href: r.href, title: r.title }, t.push(r));
        continue;
      }
      if (r = this.tokenizer.table(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.lheading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      let i = e;
      if (this.options.extensions?.startBlock) {
        let o = 1 / 0, u = e.slice(1), a;
        this.options.extensions.startBlock.forEach((c) => {
          a = c.call({ lexer: this }, u), typeof a == "number" && a >= 0 && (o = Math.min(o, a));
        }), o < 1 / 0 && o >= 0 && (i = e.substring(0, o + 1));
      }
      if (this.state.top && (r = this.tokenizer.paragraph(i))) {
        let o = t.at(-1);
        n && o?.type === "paragraph" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r), n = i.length !== e.length, e = e.substring(r.raw.length);
        continue;
      }
      if (r = this.tokenizer.text(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return this.state.top = true, t;
  }
  inline(e, t = []) {
    return this.inlineQueue.push({ src: e, tokens: t }), t;
  }
  inlineTokens(e, t = []) {
    this.tokenizer.lexer = this;
    let n = e, s = null;
    if (this.tokens.links) {
      let a = Object.keys(this.tokens.links);
      if (a.length > 0) for (; (s = this.tokenizer.rules.inline.reflinkSearch.exec(n)) !== null; ) a.includes(s[0].slice(s[0].lastIndexOf("[") + 1, -1)) && (n = n.slice(0, s.index) + "[" + "a".repeat(s[0].length - 2) + "]" + n.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex));
    }
    for (; (s = this.tokenizer.rules.inline.anyPunctuation.exec(n)) !== null; ) n = n.slice(0, s.index) + "++" + n.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
    let r;
    for (; (s = this.tokenizer.rules.inline.blockSkip.exec(n)) !== null; ) r = s[2] ? s[2].length : 0, n = n.slice(0, s.index + r) + "[" + "a".repeat(s[0].length - r - 2) + "]" + n.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
    n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
    let i = false, o = "", u = 1 / 0;
    for (; e; ) {
      if (e.length < u) u = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      i || (o = ""), i = false;
      let a;
      if (this.options.extensions?.inline?.some((p) => (a = p.call({ lexer: this }, e, t)) ? (e = e.substring(a.raw.length), t.push(a), true) : false)) continue;
      if (a = this.tokenizer.escape(e)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.tag(e)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.link(e)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.reflink(e, this.tokens.links)) {
        e = e.substring(a.raw.length);
        let p = t.at(-1);
        a.type === "text" && p?.type === "text" ? (p.raw += a.raw, p.text += a.text) : t.push(a);
        continue;
      }
      if (a = this.tokenizer.emStrong(e, n, o)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.codespan(e)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.br(e)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.del(e, n, o)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.autolink(e)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (!this.state.inLink && (a = this.tokenizer.url(e))) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      let c = e;
      if (this.options.extensions?.startInline) {
        let p = 1 / 0, k = e.slice(1), h;
        this.options.extensions.startInline.forEach((R) => {
          h = R.call({ lexer: this }, k), typeof h == "number" && h >= 0 && (p = Math.min(p, h));
        }), p < 1 / 0 && p >= 0 && (c = e.substring(0, p + 1));
      }
      if (a = this.tokenizer.inlineText(c)) {
        e = e.substring(a.raw.length), a.raw.slice(-1) !== "_" && (o = a.raw.slice(-1)), i = true;
        let p = t.at(-1);
        p?.type === "text" ? (p.raw += a.raw, p.text += a.text) : t.push(a);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return t;
  }
  infiniteLoopError(e) {
    let t = "Infinite loop on byte: " + e;
    if (this.options.silent) console.error(t);
    else throw new Error(t);
  }
};
var y = class {
  options;
  parser;
  constructor(e) {
    this.options = e || T;
  }
  space(e) {
    return "";
  }
  code({ text: e, lang: t, escaped: n }) {
    let s = (t || "").match(m.notSpaceStart)?.[0], r = e.replace(m.endingNewline, "") + `
`;
    return s ? '<pre><code class="language-' + O(s) + '">' + (n ? r : O(r, true)) + `</code></pre>
` : "<pre><code>" + (n ? r : O(r, true)) + `</code></pre>
`;
  }
  blockquote({ tokens: e }) {
    return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
  }
  html({ text: e }) {
    return e;
  }
  def(e) {
    return "";
  }
  heading({ tokens: e, depth: t }) {
    return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
  }
  hr(e) {
    return `<hr>
`;
  }
  list(e) {
    let t = e.ordered, n = e.start, s = "";
    for (let o = 0; o < e.items.length; o++) {
      let u = e.items[o];
      s += this.listitem(u);
    }
    let r = t ? "ol" : "ul", i = t && n !== 1 ? ' start="' + n + '"' : "";
    return "<" + r + i + `>
` + s + "</" + r + `>
`;
  }
  listitem(e) {
    return `<li>${this.parser.parse(e.tokens)}</li>
`;
  }
  checkbox({ checked: e }) {
    return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
  }
  paragraph({ tokens: e }) {
    return `<p>${this.parser.parseInline(e)}</p>
`;
  }
  table(e) {
    let t = "", n = "";
    for (let r = 0; r < e.header.length; r++) n += this.tablecell(e.header[r]);
    t += this.tablerow({ text: n });
    let s = "";
    for (let r = 0; r < e.rows.length; r++) {
      let i = e.rows[r];
      n = "";
      for (let o = 0; o < i.length; o++) n += this.tablecell(i[o]);
      s += this.tablerow({ text: n });
    }
    return s && (s = `<tbody>${s}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + s + `</table>
`;
  }
  tablerow({ text: e }) {
    return `<tr>
${e}</tr>
`;
  }
  tablecell(e) {
    let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
    return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
  }
  strong({ tokens: e }) {
    return `<strong>${this.parser.parseInline(e)}</strong>`;
  }
  em({ tokens: e }) {
    return `<em>${this.parser.parseInline(e)}</em>`;
  }
  codespan({ text: e }) {
    return `<code>${O(e, true)}</code>`;
  }
  br(e) {
    return "<br>";
  }
  del({ tokens: e }) {
    return `<del>${this.parser.parseInline(e)}</del>`;
  }
  link({ href: e, title: t, tokens: n }) {
    let s = this.parser.parseInline(n), r = V(e);
    if (r === null) return s;
    e = r;
    let i = '<a href="' + e + '"';
    return t && (i += ' title="' + O(t) + '"'), i += ">" + s + "</a>", i;
  }
  image({ href: e, title: t, text: n, tokens: s }) {
    s && (n = this.parser.parseInline(s, this.parser.textRenderer));
    let r = V(e);
    if (r === null) return O(n);
    e = r;
    let i = `<img src="${e}" alt="${O(n)}"`;
    return t && (i += ` title="${O(t)}"`), i += ">", i;
  }
  text(e) {
    return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : O(e.text);
  }
};
var L = class {
  strong({ text: e }) {
    return e;
  }
  em({ text: e }) {
    return e;
  }
  codespan({ text: e }) {
    return e;
  }
  del({ text: e }) {
    return e;
  }
  html({ text: e }) {
    return e;
  }
  text({ text: e }) {
    return e;
  }
  link({ text: e }) {
    return "" + e;
  }
  image({ text: e }) {
    return "" + e;
  }
  br() {
    return "";
  }
  checkbox({ raw: e }) {
    return e;
  }
};
var b = class l2 {
  options;
  renderer;
  textRenderer;
  constructor(e) {
    this.options = e || T, this.options.renderer = this.options.renderer || new y(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new L();
  }
  static parse(e, t) {
    return new l2(t).parse(e);
  }
  static parseInline(e, t) {
    return new l2(t).parseInline(e);
  }
  parse(e) {
    this.renderer.parser = this;
    let t = "";
    for (let n = 0; n < e.length; n++) {
      let s = e[n];
      if (this.options.extensions?.renderers?.[s.type]) {
        let i = s, o = this.options.extensions.renderers[i.type].call({ parser: this }, i);
        if (o !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "html", "def", "paragraph", "text"].includes(i.type)) {
          t += o || "";
          continue;
        }
      }
      let r = s;
      switch (r.type) {
        case "space": {
          t += this.renderer.space(r);
          break;
        }
        case "hr": {
          t += this.renderer.hr(r);
          break;
        }
        case "heading": {
          t += this.renderer.heading(r);
          break;
        }
        case "code": {
          t += this.renderer.code(r);
          break;
        }
        case "table": {
          t += this.renderer.table(r);
          break;
        }
        case "blockquote": {
          t += this.renderer.blockquote(r);
          break;
        }
        case "list": {
          t += this.renderer.list(r);
          break;
        }
        case "checkbox": {
          t += this.renderer.checkbox(r);
          break;
        }
        case "html": {
          t += this.renderer.html(r);
          break;
        }
        case "def": {
          t += this.renderer.def(r);
          break;
        }
        case "paragraph": {
          t += this.renderer.paragraph(r);
          break;
        }
        case "text": {
          t += this.renderer.text(r);
          break;
        }
        default: {
          let i = 'Token with "' + r.type + '" type was not found.';
          if (this.options.silent) return console.error(i), "";
          throw new Error(i);
        }
      }
    }
    return t;
  }
  parseInline(e, t = this.renderer) {
    this.renderer.parser = this;
    let n = "";
    for (let s = 0; s < e.length; s++) {
      let r = e[s];
      if (this.options.extensions?.renderers?.[r.type]) {
        let o = this.options.extensions.renderers[r.type].call({ parser: this }, r);
        if (o !== false || !["escape", "html", "link", "image", "strong", "em", "codespan", "br", "del", "text"].includes(r.type)) {
          n += o || "";
          continue;
        }
      }
      let i = r;
      switch (i.type) {
        case "escape": {
          n += t.text(i);
          break;
        }
        case "html": {
          n += t.html(i);
          break;
        }
        case "link": {
          n += t.link(i);
          break;
        }
        case "image": {
          n += t.image(i);
          break;
        }
        case "checkbox": {
          n += t.checkbox(i);
          break;
        }
        case "strong": {
          n += t.strong(i);
          break;
        }
        case "em": {
          n += t.em(i);
          break;
        }
        case "codespan": {
          n += t.codespan(i);
          break;
        }
        case "br": {
          n += t.br(i);
          break;
        }
        case "del": {
          n += t.del(i);
          break;
        }
        case "text": {
          n += t.text(i);
          break;
        }
        default: {
          let o = 'Token with "' + i.type + '" type was not found.';
          if (this.options.silent) return console.error(o), "";
          throw new Error(o);
        }
      }
    }
    return n;
  }
};
var P = class {
  options;
  block;
  constructor(e) {
    this.options = e || T;
  }
  static passThroughHooks = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
  static passThroughHooksRespectAsync = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"]);
  preprocess(e) {
    return e;
  }
  postprocess(e) {
    return e;
  }
  processAllTokens(e) {
    return e;
  }
  emStrongMask(e) {
    return e;
  }
  provideLexer(e = this.block) {
    return e ? x.lex : x.lexInline;
  }
  provideParser(e = this.block) {
    return e ? b.parse : b.parseInline;
  }
};
var q = class {
  defaults = M();
  options = this.setOptions;
  parse = this.parseMarkdown(true);
  parseInline = this.parseMarkdown(false);
  Parser = b;
  Renderer = y;
  TextRenderer = L;
  Lexer = x;
  Tokenizer = w;
  Hooks = P;
  constructor(...e) {
    this.use(...e);
  }
  walkTokens(e, t) {
    let n = [];
    for (let s of e) switch (n = n.concat(t.call(this, s)), s.type) {
      case "table": {
        let r = s;
        for (let i of r.header) n = n.concat(this.walkTokens(i.tokens, t));
        for (let i of r.rows) for (let o of i) n = n.concat(this.walkTokens(o.tokens, t));
        break;
      }
      case "list": {
        let r = s;
        n = n.concat(this.walkTokens(r.items, t));
        break;
      }
      default: {
        let r = s;
        this.defaults.extensions?.childTokens?.[r.type] ? this.defaults.extensions.childTokens[r.type].forEach((i) => {
          let o = r[i].flat(1 / 0);
          n = n.concat(this.walkTokens(o, t));
        }) : r.tokens && (n = n.concat(this.walkTokens(r.tokens, t)));
      }
    }
    return n;
  }
  use(...e) {
    let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
    return e.forEach((n) => {
      let s = { ...n };
      if (s.async = this.defaults.async || s.async || false, n.extensions && (n.extensions.forEach((r) => {
        if (!r.name) throw new Error("extension name required");
        if ("renderer" in r) {
          let i = t.renderers[r.name];
          i ? t.renderers[r.name] = function(...o) {
            let u = r.renderer.apply(this, o);
            return u === false && (u = i.apply(this, o)), u;
          } : t.renderers[r.name] = r.renderer;
        }
        if ("tokenizer" in r) {
          if (!r.level || r.level !== "block" && r.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
          let i = t[r.level];
          i ? i.unshift(r.tokenizer) : t[r.level] = [r.tokenizer], r.start && (r.level === "block" ? t.startBlock ? t.startBlock.push(r.start) : t.startBlock = [r.start] : r.level === "inline" && (t.startInline ? t.startInline.push(r.start) : t.startInline = [r.start]));
        }
        "childTokens" in r && r.childTokens && (t.childTokens[r.name] = r.childTokens);
      }), s.extensions = t), n.renderer) {
        let r = this.defaults.renderer || new y(this.defaults);
        for (let i in n.renderer) {
          if (!(i in r)) throw new Error(`renderer '${i}' does not exist`);
          if (["options", "parser"].includes(i)) continue;
          let o = i, u = n.renderer[o], a = r[o];
          r[o] = (...c) => {
            let p = u.apply(r, c);
            return p === false && (p = a.apply(r, c)), p || "";
          };
        }
        s.renderer = r;
      }
      if (n.tokenizer) {
        let r = this.defaults.tokenizer || new w(this.defaults);
        for (let i in n.tokenizer) {
          if (!(i in r)) throw new Error(`tokenizer '${i}' does not exist`);
          if (["options", "rules", "lexer"].includes(i)) continue;
          let o = i, u = n.tokenizer[o], a = r[o];
          r[o] = (...c) => {
            let p = u.apply(r, c);
            return p === false && (p = a.apply(r, c)), p;
          };
        }
        s.tokenizer = r;
      }
      if (n.hooks) {
        let r = this.defaults.hooks || new P();
        for (let i in n.hooks) {
          if (!(i in r)) throw new Error(`hook '${i}' does not exist`);
          if (["options", "block"].includes(i)) continue;
          let o = i, u = n.hooks[o], a = r[o];
          P.passThroughHooks.has(i) ? r[o] = (c) => {
            if (this.defaults.async && P.passThroughHooksRespectAsync.has(i)) return (async () => {
              let k = await u.call(r, c);
              return a.call(r, k);
            })();
            let p = u.call(r, c);
            return a.call(r, p);
          } : r[o] = (...c) => {
            if (this.defaults.async) return (async () => {
              let k = await u.apply(r, c);
              return k === false && (k = await a.apply(r, c)), k;
            })();
            let p = u.apply(r, c);
            return p === false && (p = a.apply(r, c)), p;
          };
        }
        s.hooks = r;
      }
      if (n.walkTokens) {
        let r = this.defaults.walkTokens, i = n.walkTokens;
        s.walkTokens = function(o) {
          let u = [];
          return u.push(i.call(this, o)), r && (u = u.concat(r.call(this, o))), u;
        };
      }
      this.defaults = { ...this.defaults, ...s };
    }), this;
  }
  setOptions(e) {
    return this.defaults = { ...this.defaults, ...e }, this;
  }
  lexer(e, t) {
    return x.lex(e, t ?? this.defaults);
  }
  parser(e, t) {
    return b.parse(e, t ?? this.defaults);
  }
  parseMarkdown(e) {
    return (n, s) => {
      let r = { ...s }, i = { ...this.defaults, ...r }, o = this.onError(!!i.silent, !!i.async);
      if (this.defaults.async === true && r.async === false) return o(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      if (typeof n > "u" || n === null) return o(new Error("marked(): input parameter is undefined or null"));
      if (typeof n != "string") return o(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
      if (i.hooks && (i.hooks.options = i, i.hooks.block = e), i.async) return (async () => {
        let u = i.hooks ? await i.hooks.preprocess(n) : n, c = await (i.hooks ? await i.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(u, i), p = i.hooks ? await i.hooks.processAllTokens(c) : c;
        i.walkTokens && await Promise.all(this.walkTokens(p, i.walkTokens));
        let h = await (i.hooks ? await i.hooks.provideParser(e) : e ? b.parse : b.parseInline)(p, i);
        return i.hooks ? await i.hooks.postprocess(h) : h;
      })().catch(o);
      try {
        i.hooks && (n = i.hooks.preprocess(n));
        let a = (i.hooks ? i.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(n, i);
        i.hooks && (a = i.hooks.processAllTokens(a)), i.walkTokens && this.walkTokens(a, i.walkTokens);
        let p = (i.hooks ? i.hooks.provideParser(e) : e ? b.parse : b.parseInline)(a, i);
        return i.hooks && (p = i.hooks.postprocess(p)), p;
      } catch (u) {
        return o(u);
      }
    };
  }
  onError(e, t) {
    return (n) => {
      if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
        let s = "<p>An error occurred:</p><pre>" + O(n.message + "", true) + "</pre>";
        return t ? Promise.resolve(s) : s;
      }
      if (t) return Promise.reject(n);
      throw n;
    };
  }
};
var z = new q();
function g(l3, e) {
  return z.parse(l3, e);
}
g.options = g.setOptions = function(l3) {
  return z.setOptions(l3), g.defaults = z.defaults, N(g.defaults), g;
};
g.getDefaults = M;
g.defaults = T;
g.use = function(...l3) {
  return z.use(...l3), g.defaults = z.defaults, N(g.defaults), g;
};
g.walkTokens = function(l3, e) {
  return z.walkTokens(l3, e);
};
g.parseInline = z.parseInline;
g.Parser = b;
g.parser = b.parse;
g.Renderer = y;
g.TextRenderer = L;
g.Lexer = x;
g.lexer = x.lex;
g.Tokenizer = w;
g.Hooks = P;
g.parse = g;
var Ft = g.options;
var Ut = g.setOptions;
var Kt = g.use;
var Wt = g.walkTokens;
var Xt = g.parseInline;
var Vt = b.parse;
var Yt = x.lex;

// src/image-client.ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
var worker;
var active;
var stopping = false;
var nextId = 0;
var idle;
var queue = [];
function settle(error, value) {
  const job = active;
  active = void 0;
  if (job) {
    clearTimeout(job.timer);
    job.signal?.removeEventListener("abort", job.cancel);
    if (error) job.reject(error);
    else job.resolve(value);
  }
}
function stop(error) {
  stopping = true;
  settle(error);
  worker?.kill("SIGKILL");
  if (!worker) {
    stopping = false;
    pump();
  }
}
function pump() {
  if (active || stopping) return;
  clearTimeout(idle);
  if (!queue.length) {
    if (worker) {
      const current = worker;
      current.unref();
      for (const stream of [current.stdin, current.stdout, current.stderr]) stream.unref?.();
      idle = setTimeout(() => {
        if (worker === current && !active) {
          stopping = true;
          current.kill();
        }
      }, 5e3);
      idle.unref();
    }
    return;
  }
  active = queue.shift();
  if (!worker) {
    const node = process.env.PI_VIEW_NODE || (process.versions.bun ? "node" : process.execPath);
    const current = worker = spawn(node, [fileURLToPath(new URL("./image-worker.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    current.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-4096);
    });
    current.stdin.on("error", (error) => {
      if (worker === current) stop(error);
    });
    const lines = createInterface({ input: current.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (worker !== current || stopping) return;
      try {
        const result = JSON.parse(line);
        if (result.id !== active?.id) return;
        if (result.error) settle(new Error(result.error));
        else settle(void 0, { ...result, data: Buffer.from(result.data, "base64") });
        pump();
      } catch (error) {
        stop(error);
      }
    });
    current.on("error", (error) => {
      if (worker === current) {
        stopping = true;
        settle(new Error(`Image worker could not start: ${error.message}. Install Node.js >=22.19 or set PI_VIEW_NODE.`));
      }
    });
    current.on("close", () => {
      if (worker !== current) return;
      lines.close();
      worker = void 0;
      stopping = false;
      settle(new Error(`Image worker stopped${stderr ? `: ${stderr.trim()}` : ""}`));
      pump();
    });
  }
  worker.ref();
  for (const stream of [worker.stdin, worker.stdout, worker.stderr]) stream.ref?.();
  const job = active;
  if (!job) return;
  job.timer = setTimeout(() => stop(new Error("Image rendering exceeded the 20 second limit")), 2e4);
  worker.stdin.write(job.payload + "\n");
}
function request(operation, data, metadata, signal) {
  signal?.throwIfAborted();
  if (data.length > 32 * 1024 * 1024) throw new Error("Image exceeds the 32 MiB worker limit");
  if (queue.length >= 16) throw new Error("Too many pending image previews");
  const deferred = Promise.withResolvers();
  const id = ++nextId;
  const job = {
    id,
    payload: JSON.stringify({ id, operation, data: data.toString("base64"), ...metadata }),
    resolve: deferred.resolve,
    reject: deferred.reject,
    signal,
    cancel: () => {
      const error = new Error("Image preview aborted");
      if (active === job) stop(error);
      else {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        signal?.removeEventListener("abort", job.cancel);
        deferred.reject(error);
      }
    }
  };
  signal?.addEventListener("abort", job.cancel, { once: true });
  queue.push(job);
  pump();
  return deferred.promise;
}
async function decodeImage(data, label, signal) {
  const result = await request("decode", data, { label }, signal);
  return { data: result.data, width: result.width, height: result.height, label: result.label };
}
async function renderRaster(image, options, signal) {
  return (await request("render", image.data, { image: { width: image.width, height: image.height, label: image.label }, options }, signal)).data;
}
function stopImageWorker() {
  clearTimeout(idle);
  for (const job of queue.splice(0)) {
    job.signal?.removeEventListener("abort", job.cancel);
    job.reject(new Error("Image viewer shut down"));
  }
  if (worker) stop(new Error("Image viewer shut down"));
}

// src/documents.ts
var TEXT_LIMIT = 2 * 1024 * 1024;
var IMAGE_LIMIT = 32 * 1024 * 1024;
var PDF_LIMIT = 128 * 1024 * 1024;
var REFERENCE_BUDGET = 1024 * 1024;
var imageExtensions = { ".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".svg": true };
function safeText(text) {
  return stripVTControlCharacters(text.replace(/\x1b[P_^][\s\S]*?(?:\x1b\\|$)/g, "")).replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}
async function boundedRead(path3, limit, signal) {
  signal?.throwIfAborted();
  const file = await open(path3, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat5 = await file.stat();
    if (!stat5.isFile()) throw new Error("Only regular files can be previewed");
    if (stat5.size > limit) throw new Error(`File exceeds the ${Math.round(limit / 1024 / 1024)} MiB preview limit`);
    const buffer = Buffer.alloc(Math.min(stat5.size + 1, limit + 1));
    let length = 0;
    while (length < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > stat5.size || length > limit) throw new Error("File changed while reading; reload the preview");
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}
function markdownBlocks(source) {
  const spans = [];
  const usages = [];
  const prefix = /^[ \t]*(?:(?:>[ \t]?|(?:[-+*]|\d+[.)])[ \t]+)[ \t]*)*/gm;
  const positions = [];
  let normalized = "";
  for (const match of source.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const line = match[0];
    const stripped = line.replace(prefix, "");
    const removed = line.length - stripped.length;
    normalized += stripped;
    for (let i = removed; i < line.length; i++) positions.push(match.index + i);
  }
  function recordImage(at, stop2, target, alt) {
    spans.push({ start: positions[at], end: positions[stop2 - 1] + 1, target, alt });
  }
  function recordUsage(at, href, title) {
    usages.push({ start: positions[at], href, title: title ?? null });
  }
  function visit(tokens2, start, end) {
    let cursor2 = start;
    for (const token of tokens2) {
      const raw = token.raw?.replace(prefix, "");
      if (!raw) continue;
      const at = normalized.indexOf(raw, cursor2);
      if (at < cursor2 || at + raw.length > end) continue;
      const stop2 = at + raw.length;
      cursor2 = stop2;
      if (token.type === "image") recordImage(at, stop2, token.href, token.text);
      else if (token.type === "link" && raw.startsWith("[") && raw.endsWith("]")) recordUsage(at, token.href, token.title);
      if (token.type !== "code" && token.type !== "codespan" && token.type !== "html") {
        if ("tokens" in token && Array.isArray(token.tokens)) visit(token.tokens, at, stop2);
        if (token.type === "list") visit(token.items, at, stop2);
        if (token.type === "table") mapCells([...token.header, ...token.rows.flat()], at, stop2);
      }
    }
  }
  function mapCells(cells, at, stop2) {
    const tableRaw = normalized.slice(at, stop2);
    let plain = "";
    const map = [];
    let slashes = 0;
    for (let i = 0; i < tableRaw.length; ) {
      map.push(i);
      const ch = tableRaw[i];
      if (ch === "\\" && tableRaw[i + 1] === "|" && slashes % 2 === 0) {
        plain += "|";
        slashes = 0;
        i += 2;
        continue;
      }
      plain += ch;
      slashes = ch === "\\" ? slashes + 1 : 0;
      i += 1;
    }
    map.push(tableRaw.length);
    let cellCursor = 0;
    for (const cell of cells) {
      const cellAt = plain.indexOf(cell.text, cellCursor);
      if (cellAt < 0) continue;
      const cellEnd = cellAt + cell.text.length;
      cellCursor = cellEnd;
      visitCell(cell.tokens ?? [], plain, at, map, cellAt, cellEnd);
    }
  }
  function visitCell(tokens2, plain, base, map, start, end) {
    let cursor2 = start;
    for (const token of tokens2) {
      const raw = token.raw;
      if (!raw) continue;
      const at = plain.indexOf(raw, cursor2);
      if (at < cursor2 || at + raw.length > end) continue;
      const stop2 = at + raw.length;
      cursor2 = stop2;
      if (token.type === "image") recordImage(base + map[at], base + map[stop2], token.href, token.text);
      else if (token.type === "link" && raw.startsWith("[") && raw.endsWith("]")) recordUsage(base + map[at], token.href, token.title);
      if (token.type !== "code" && token.type !== "codespan" && token.type !== "html") {
        if ("tokens" in token && Array.isArray(token.tokens)) visitCell(token.tokens, plain, base, map, at, stop2);
      }
    }
  }
  const tokens = g.lexer(source);
  visit(tokens, 0, normalized.length);
  const definitions = /* @__PURE__ */ new Map();
  for (const [name, link] of Object.entries(tokens.links)) {
    const key = `${link.href}\0${link.title ?? ""}`;
    const line = `[${name}]: <${link.href.replace(/>/g, "%3E")}>${link.title ? ` ${JSON.stringify(link.title)}` : ""}`;
    const group = definitions.get(key);
    if (group) group.push(line);
    else definitions.set(key, [line]);
  }
  const blocks = [];
  const fragments = [];
  let cursor = 0;
  for (const span of spans.sort((a, b2) => a.start - b2.start)) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      const block = { kind: "text", text: source.slice(cursor, span.start) };
      blocks.push(block);
      fragments.push({ block, from: cursor, to: span.start });
    }
    blocks.push({ kind: "image", target: span.target, alt: safeText(span.alt) });
    cursor = span.end;
  }
  if (cursor < source.length) {
    const block = { kind: "text", text: source.slice(cursor) };
    blocks.push(block);
    fragments.push({ block, from: cursor, to: source.length });
  }
  const sortedUsages = usages.sort((a, b2) => a.start - b2.start);
  let usageCursor = 0;
  let budget = REFERENCE_BUDGET;
  for (const { block, from, to } of fragments) {
    const used = /* @__PURE__ */ new Set();
    while (usageCursor < sortedUsages.length && sortedUsages[usageCursor].start < from) usageCursor++;
    for (let i = usageCursor; i < sortedUsages.length && sortedUsages[i].start < to; i++) {
      used.add(`${sortedUsages[i].href}\0${sortedUsages[i].title ?? ""}`);
    }
    if (!used.size) continue;
    const lines = [];
    for (const key of used) {
      for (const line of definitions.get(key) ?? []) {
        if (line.length > budget) throw new Error(`Markdown reference definitions exceed the ${Math.round(REFERENCE_BUDGET / 1024 / 1024)} MiB expansion budget`);
        budget -= line.length;
        lines.push(line);
      }
    }
    block.text += `

${lines.join("\n")}
`;
  }
  return blocks;
}
async function loadDocument(path3, signal) {
  const extension = extname(path3).toLowerCase();
  if ([".html", ".htm", ".xhtml", ".mhtml", ".mht"].includes(extension)) {
    throw new Error("HTML and webpage preview are intentionally not supported");
  }
  if (imageExtensions[extension]) return { kind: "image", path: path3, image: await loadImage(pathToFileURL(path3).href, dirname(path3), false, signal) };
  if (extension === ".pdf") {
    await checkPdf(path3, signal);
    const info = await run("pdfinfo", [path3], signal);
    const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
    if (!Number.isSafeInteger(pages) || pages < 1) throw new Error("Could not read PDF page count (encrypted or invalid PDF)");
    return { kind: "pdf", path: path3, pages };
  }
  const bytes = await boundedRead(path3, TEXT_LIMIT, signal);
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("This is not a supported image/PDF or UTF-8 text file");
  }
  if (source.includes("\0")) throw new Error("Binary file preview is not supported");
  source = safeText(source);
  const markdown = [".md", ".markdown", ".mdown", ".mkd"].includes(extension);
  return {
    kind: markdown ? "markdown" : "text",
    path: path3,
    source,
    language: extension.slice(1),
    blocks: markdown ? markdownBlocks(source) : [{ kind: "text", text: source }]
  };
}
async function remoteImage(url, signal) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Unsupported image URL");
  const abort = AbortSignal.any([AbortSignal.timeout(1e4), ...signal ? [signal] : []]);
  const response = await fetch(parsed, { signal: abort, credentials: "omit" });
  if (!response.ok || !response.body) throw new Error(`Image download failed: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMAGE_LIMIT) throw new Error("Remote image exceeds the 32 MiB limit");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {
    });
  }
  return Buffer.concat(chunks);
}
async function loadImage(target, baseDir, allowRemote, signal) {
  let bytes;
  if (/^https?:\/\//i.test(target)) {
    if (!allowRemote) throw new Error("Remote image not fetched; press R to allow remote images for this preview");
    bytes = await remoteImage(target, signal);
  } else if (/^data:/i.test(target)) {
    const match = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/i.exec(target);
    if (!match || target.length > IMAGE_LIMIT * 1.4) throw new Error("Unsupported or oversized embedded image");
    bytes = Buffer.from(match[1], "base64");
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(target) && !target.startsWith("file:") && !/^[a-z]:[\\/]/i.test(target)) throw new Error("Unsupported image scheme");
    let path3 = target.startsWith("file:") ? fileURLToPath2(target) : target;
    if (!target.startsWith("file:")) {
      const suffix = path3.search(/[?#]/);
      if (suffix >= 0) path3 = path3.slice(0, suffix);
      try {
        path3 = decodeURIComponent(path3);
      } catch {
      }
    }
    bytes = await boundedRead(resolve2(baseDir, path3), IMAGE_LIMIT, signal);
  }
  return decodeImage(bytes, target.startsWith("data:") ? "embedded image" : target, signal);
}
function run(command, args, signal) {
  const { promise, resolve: resolveResult, reject } = Promise.withResolvers();
  let failure = null;
  let output = "";
  const child = execFile(command, args, {
    signal,
    timeout: 2e4,
    killSignal: "SIGKILL",
    maxBuffer: TEXT_LIMIT,
    encoding: "utf8",
    windowsHide: true
  }, (error, stdout) => {
    failure = error;
    output = stdout;
  });
  child.once("close", () => {
    if (failure?.code === "ENOENT") {
      const poppler = command === "pdfinfo" || command === "pdftoppm" || command === "pdftotext";
      reject(new Error(`${command} is missing${poppler ? ". Install Poppler (brew install poppler / apt install poppler-utils)." : ""}`));
    } else if (failure) reject(new Error(safeText(failure.message)));
    else resolveResult(output);
  });
  return promise;
}
async function checkPdf(path3, signal) {
  signal?.throwIfAborted();
  const file = await open(path3, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat5 = await file.stat();
    if (!stat5.isFile() || stat5.size > PDF_LIMIT) throw new Error("PDF must be a regular file no larger than 128 MiB");
    const signature = Buffer.alloc(5);
    await file.read(signature, 0, 5, 0);
    if (signature.toString() !== "%PDF-") throw new Error("Invalid PDF signature");
  } finally {
    await file.close();
  }
}
async function loadPdfPage(path3, page, signal) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid PDF page number");
  await checkPdf(path3, signal);
  const dir = await mkdtemp(join2(tmpdir(), "pi-view-"));
  try {
    const prefix = join2(dir, "page");
    await run("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "2400", "-png", path3, prefix], signal);
    return decodeImage(await boundedRead(`${prefix}.png`, IMAGE_LIMIT, signal), `${path3} \xB7 page ${page}`, signal);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function pdfText(path3, signal) {
  await checkPdf(path3, signal);
  return safeText(await run("pdftotext", ["-layout", path3, "-"], signal));
}
async function mediaDiagnostics() {
  const node = process.env.PI_VIEW_NODE || (process.versions.bun ? "node" : process.execPath);
  return Promise.all([["pdfinfo"], ["pdftoppm"], ["pdftotext"], [node, "Node image worker"]].map(async ([command, label]) => {
    try {
      await run(command, label ? ["--version"] : ["-v"]);
      return `${label ?? command}: available`;
    } catch (error) {
      return `${label ?? command}: ${safeText(error.message)}`;
    }
  }));
}

// src/viewer.ts
import { unwatchFile, watchFile } from "node:fs";
import { stat as stat2 } from "node:fs/promises";
import { dirname as dirname3 } from "node:path";
import { stripVTControlCharacters as stripVTControlCharacters2 } from "node:util";
import { getLanguageFromPath, getMarkdownTheme, highlightCode } from "@earendil-works/pi-coding-agent";
import { Input, Markdown, isKeyRelease, matchesKey, parseKey as parseKey2, sliceByColumn, truncateToWidth, visibleWidth as visibleWidth2, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// src/host.ts
import { randomInt } from "node:crypto";
import * as piTui from "@earendil-works/pi-tui";
var {
  Image,
  allocateImageId,
  deleteKittyImage,
  getCapabilities,
  getCellDimensions,
  getImageDimensions
} = piTui;
var SIXEL_IMAGE_PROTOCOL = "\x1BPq";
var KITTY_IMAGE_PROTOCOL = "\x1B_G";
var ITERM2_IMAGE_PROTOCOL = "\x1B]1337;File=";
function ompTerminal() {
  return piTui.TERMINAL;
}
function isOmpHost() {
  return ompTerminal() !== void 0;
}
function hostImageProtocol() {
  return ompTerminal()?.imageProtocol;
}
function mapHostImageProtocol(marker) {
  if (marker === KITTY_IMAGE_PROTOCOL) return "kitty";
  if (marker === ITERM2_IMAGE_PROTOCOL) return "iterm2";
  if (marker === SIXEL_IMAGE_PROTOCOL) return "sixel";
  return null;
}
function imagesDisabled(env) {
  const value = env.PI_VIEW_IMAGES?.trim().toLowerCase();
  return value === "off" || value === "0" || value === "false";
}
function detectTerminalName(env) {
  const termProgram = env.TERM_PROGRAM?.toLowerCase() ?? "";
  const term = env.TERM?.toLowerCase() ?? "";
  if (env.KITTY_WINDOW_ID || termProgram === "kitty") return "kitty";
  if (env.GHOSTTY_RESOURCES_DIR || termProgram === "ghostty" || term.includes("ghostty")) return "ghostty";
  if (env.WEZTERM_PANE || termProgram === "wezterm") return "wezterm";
  if (env.ITERM_SESSION_ID || termProgram === "iterm.app") return "iterm2";
  if (env.ALACRITTY_WINDOW_ID || termProgram === "alacritty") return "alacritty";
  if (env.VSCODE_PID || termProgram === "vscode") return "vscode";
  if (termProgram === "warpterminal" || env.WARP_SESSION_ID || env.WARP_TERMINAL_SESSION_UUID) return "warp";
  if (env.WT_SESSION) return "windows-terminal";
  if (termProgram === "apple_terminal") return "terminal.app";
  if (env.TERMINAL_EMULATOR === "jetbrains-jediterm") return "jetbrains";
  return env.TERM || "unknown";
}
function detectMultiplexer(env) {
  if (env.TMUX) return "tmux";
  if (env.STY) return "screen";
  if (env.ZELLIJ) return "zellij";
  return "none";
}
function resolveImageProtocol(env, hostProtocolMarker) {
  if (imagesDisabled(env)) {
    return { protocol: null, detail: `images: disabled (PI_VIEW_IMAGES=${env.PI_VIEW_IMAGES})` };
  }
  const marker = hostProtocolMarker === void 0 ? hostImageProtocol() : hostProtocolMarker;
  if (marker === SIXEL_IMAGE_PROTOCOL) {
    return { protocol: "sixel", detail: "protocol: sixel (host-reported)" };
  }
  if (env.PI_FORCE_IMAGE_PROTOCOL?.trim() && marker !== void 0) {
    const mapped = mapHostImageProtocol(marker);
    return {
      protocol: mapped,
      detail: mapped ? `protocol: ${mapped} (host override)` : "protocol: none (host override)"
    };
  }
  const caps = getCapabilities();
  if (caps.images) return { protocol: caps.images, detail: `protocol: ${caps.images}` };
  const mux = detectMultiplexer(env);
  if (mux !== "none") {
    return { protocol: null, detail: `protocol: none (${mux} conservatively disables image protocols)` };
  }
  return { protocol: null, detail: "protocol: none (terminal fallback)" };
}
function hostDiagnostics(env) {
  const onSsh = Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
  const cell = getCellDimensions();
  const details = [
    `host: ${ompTerminal() ? "oh-my-pi" : "pi"}`,
    `terminal: ${detectTerminalName(env)}`,
    `multiplexer: ${detectMultiplexer(env)}`,
    `ssh: ${onSsh ? "yes" : "no"}`,
    `cell: ${cell.widthPx}x${cell.heightPx}px`
  ];
  const forced = env.PI_FORCE_IMAGE_PROTOCOL?.trim().toLowerCase();
  if (forced) details.push(`env: PI_FORCE_IMAGE_PROTOCOL=${forced}`);
  return details;
}
function capabilities(env = process.env, hostProtocolMarker) {
  const cell = getCellDimensions();
  const cellWidth = Math.max(1, cell.widthPx);
  const cellHeight = Math.max(1, cell.heightPx);
  const resolved = resolveImageProtocol(env, hostProtocolMarker);
  return {
    protocol: resolved.protocol,
    cellWidth,
    cellHeight,
    details: [...hostDiagnostics(env), resolved.detail]
  };
}
function fitCells(dims, maxWidthCells, maxHeightCells, cell) {
  const scale = Math.min(
    maxWidthCells * cell.widthPx / dims.widthPx,
    maxHeightCells * cell.heightPx / dims.heightPx
  );
  return {
    columns: Math.max(1, Math.min(maxWidthCells, Math.ceil(dims.widthPx * scale / cell.widthPx))),
    rows: Math.max(1, Math.min(maxHeightCells, Math.ceil(dims.heightPx * scale / cell.heightPx)))
  };
}
function sanitizeLabel(label) {
  return label.replace(/[\x00-\x1f\x7f]/gu, " ").replace(/\s+/gu, " ").trim();
}
function writeRaw(tui, data) {
  const terminal = tui?.terminal;
  if (typeof terminal?.write === "function") {
    terminal.write(data);
  } else {
    process.stdout.write(data);
  }
}
function createTerminalImage(png, widthCells, heightCells, label, tui) {
  const maxWidthCells = Math.max(1, Math.floor(widthCells));
  const maxHeightCells = Math.max(1, Math.floor(heightCells));
  const base64 = png.toString("base64");
  const cell = getCellDimensions();
  const dims = getImageDimensions(base64, "image/png") ?? {
    widthPx: maxWidthCells * cell.widthPx,
    heightPx: maxHeightCells * cell.heightPx
  };
  const fit = fitCells(dims, maxWidthCells, maxHeightCells, cell);
  const protocol = resolveImageProtocol(process.env).protocol;
  const imageId = protocol === "kitty" ? typeof allocateImageId === "function" ? allocateImageId() : randomInt(1, 4294967296) : void 0;
  const native = new Image(
    base64,
    "image/png",
    { fallbackColor: (s) => s },
    {
      maxWidthCells,
      maxHeightCells,
      filename: sanitizeLabel(label),
      ...imageId !== void 0 ? { imageId } : {}
    },
    dims
  );
  let disposed = false;
  let nativeLines;
  let ownedLines;
  return {
    get imageId() {
      return imageId;
    },
    get columns() {
      return fit.columns;
    },
    get rows() {
      return fit.rows;
    },
    render(width) {
      if (disposed) return [];
      const lines = native.render(width);
      if (imageId === void 0) return lines;
      if (lines === nativeLines) return ownedLines;
      nativeLines = lines;
      ownedLines = lines.map((line) => line.replace(/\x1b_G([^;]*);/g, (sequence, header) => {
        const fields = header.split(",");
        if (!fields.some((field) => field === "a=T" || field === "a=t" || field === "a=p")) return sequence;
        return `\x1B_G${fields.filter((field) => !field.startsWith("i=") && !field.startsWith("z=")).join(",")},i=${imageId},z=-1073741825;`;
      }));
      return ownedLines;
    },
    invalidate() {
      native.invalidate();
      nativeLines = void 0;
      ownedLines = void 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      native.invalidate();
      nativeLines = void 0;
      ownedLines = void 0;
      if (imageId !== void 0) {
        try {
          const ompDelete = piTui.encodeKittyDeleteImage;
          const remove = typeof deleteKittyImage === "function" ? deleteKittyImage : ompDelete;
          let sequence;
          if (remove) sequence = remove(imageId);
          else {
            sequence = `\x1B_Ga=d,d=I,i=${imageId},q=2\x1B\\`;
            if (process.env.TMUX) sequence = `\x1BPtmux;${sequence.replaceAll("\x1B", "\x1B\x1B")}\x1B\\`;
          }
          writeRaw(tui, sequence);
        } catch {
        }
      }
    }
  };
}
var WHEEL_STEP_LINES = 3;
var MAX_PENDING_BYTES = 64;
var SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
var SGR_MOUSE_PARTIAL = /^\x1b\[<[\d;]*$/;
var X10_MOUSE_PREFIX = "\x1B[M";
var URXVT_MOUSE = /^\x1b\[(\d+);(\d+);(\d+)[Mm]/;
var DECRPM_REPLY = /^\x1b\[\?(\d+);(\d+)\$y/;
var DECRPM_PARTIAL = /^\x1b\[\?[\d;]+\$?$/;
var MOUSE_ENABLE = "\x1B[?1000h\x1B[?1006h";
var MOUSE_QUERY = "\x1B[?1000$p\x1B[?1002$p\x1B[?1003$p\x1B[?1006$p";
var PROBED_MODES = [1e3, 1002, 1003, 1006];
function wheelDelta(button) {
  if ((button & 64) === 0) return null;
  const direction = button & 3;
  if (direction === 0) return -WHEEL_STEP_LINES;
  if (direction === 1) return WHEEL_STEP_LINES;
  return null;
}
function probeTimeoutMs(env) {
  const raw = Number.parseInt(env.PI_VIEW_MOUSE_PROBE_MS ?? "", 10);
  if (Number.isFinite(raw)) return Math.max(0, Math.min(2e3, raw));
  return 200;
}
function parseMouseStream(buffer, state) {
  const events = [];
  let rest = "";
  let pos = 0;
  while (pos < buffer.length) {
    const slice = buffer.slice(pos);
    if (state.probing) {
      const reply = DECRPM_REPLY.exec(slice);
      if (reply) {
        events.push({ kind: "decrpm", mode: Number(reply[1]), value: Number(reply[2]) });
        pos += reply[0].length;
        continue;
      }
      if (slice.length <= MAX_PENDING_BYTES && DECRPM_PARTIAL.test(slice)) {
        return { events, rest, held: slice };
      }
    }
    if (!slice.startsWith("\x1B")) {
      const nextEsc2 = slice.indexOf("\x1B");
      const plain = nextEsc2 === -1 ? slice : slice.slice(0, nextEsc2);
      rest += plain;
      pos += plain.length;
      continue;
    }
    const sgr = SGR_MOUSE.exec(slice);
    if (sgr) {
      const delta = wheelDelta(Number(sgr[1]));
      events.push(delta === null ? { kind: "noise" } : { kind: "wheel", delta });
      pos += sgr[0].length;
      continue;
    }
    if (slice.startsWith(X10_MOUSE_PREFIX) && slice.length >= 6) {
      const delta = wheelDelta(slice.charCodeAt(3) - 32);
      events.push(delta === null ? { kind: "noise" } : { kind: "wheel", delta });
      pos += 6;
      continue;
    }
    const urxvt = URXVT_MOUSE.exec(slice);
    if (urxvt) {
      const delta = wheelDelta(Number(urxvt[1]) - 32);
      events.push(delta === null ? { kind: "noise" } : { kind: "wheel", delta });
      pos += urxvt[0].length;
      continue;
    }
    const holdable = slice.length <= MAX_PENDING_BYTES && (slice === X10_MOUSE_PREFIX || slice.startsWith(X10_MOUSE_PREFIX) && slice.length < 6 || slice.startsWith("\x1B[<") && SGR_MOUSE_PARTIAL.test(slice) || state.probing && DECRPM_PARTIAL.test(slice));
    if (holdable) {
      return { events, rest, held: slice };
    }
    const nextEsc = slice.indexOf("\x1B", 1);
    const chunk = nextEsc === -1 ? slice : slice.slice(0, nextEsc);
    rest += chunk;
    pos += chunk.length;
  }
  return { events, rest, held: "" };
}
function attachMouse(tui, onWheel) {
  if (typeof tui.addInputListener !== "function") return () => {
  };
  const hostOwnsMouse = ompTerminal() !== void 0;
  const timeout = hostOwnsMouse ? 0 : probeTimeoutMs(process.env);
  const state = { probing: timeout > 0, pendingModes: new Set(PROBED_MODES), held: "" };
  const originalModes = /* @__PURE__ */ new Map();
  const changedModes = [];
  let detached = false;
  let timer;
  const listener = (data) => {
    if (detached) return;
    const { events, rest, held } = parseMouseStream(state.held + data, state);
    state.held = held;
    for (const event of events) {
      if (event.kind === "decrpm" && state.pendingModes.delete(event.mode)) {
        originalModes.set(event.mode, event.value);
        if (!state.pendingModes.size) {
          state.probing = false;
          if ([...originalModes.values()].every((value) => value >= 1 && value <= 4)) {
            const tracking = [1e3, 1002, 1003].some((mode) => [1, 3].includes(originalModes.get(mode)));
            if (!tracking && originalModes.get(1e3) === 2) changedModes.push(1e3);
            if (originalModes.get(1006) === 2) changedModes.push(1006);
            for (const mode of changedModes) writeRaw(tui, `\x1B[?${mode}h`);
          }
        }
      } else if (event.kind === "wheel") {
        onWheel(event.delta);
      }
    }
    if (!state.held && rest === data) return;
    return rest ? { data: rest } : { consume: true };
  };
  const removeListener = tui.addInputListener(listener);
  if (timeout > 0) {
    writeRaw(tui, MOUSE_QUERY);
    timer = setTimeout(() => {
      state.probing = false;
      state.held = "";
    }, timeout);
    timer.unref();
  } else if (!hostOwnsMouse) {
    changedModes.push(1e3, 1006);
    writeRaw(tui, MOUSE_ENABLE);
  }
  return () => {
    if (detached) return;
    detached = true;
    clearTimeout(timer);
    state.held = "";
    removeListener();
    try {
      for (const mode of changedModes.reverse()) writeRaw(tui, `\x1B[?${mode}l`);
    } catch {
    }
  };
}

// src/nvim.ts
var import_msgpack = __toESM(require_dist(), 1);
import { spawn as spawn2 } from "node:child_process";
import { dirname as dirname2, resolve as resolvePath2 } from "node:path";
import { getCapabilities as getCapabilities2, parseKey } from "@earendil-works/pi-tui";

// src/nvim-grid.ts
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
var RESET = "\x1B[0m";
var NvimGrid = class {
  constructor(trueColor) {
    this.trueColor = trueColor;
  }
  trueColor;
  width = 0;
  height = 0;
  cursor;
  busy = false;
  attrs = /* @__PURE__ */ new Map();
  rows = [];
  sgrCache = /* @__PURE__ */ new Map();
  /**
   * Apply one UI event tuple from a redraw batch. Unknown events and
   * parameters appended by future Neovim versions are ignored by contract.
   */
  handle(name, params) {
    switch (name) {
      case "grid_resize": {
        const [width, height] = numbers(params, 1, 2);
        this.width = width;
        this.height = height;
        this.rows = blankRows(height, width);
        this.cursor = void 0;
        this.sgrCache.clear();
        break;
      }
      case "grid_clear":
        this.rows = blankRows(this.height, this.width);
        break;
      case "grid_destroy":
        this.rows = [];
        this.cursor = void 0;
        break;
      case "grid_cursor_goto": {
        const [row, col] = numbers(params, 1, 2);
        this.cursor = { row, col };
        break;
      }
      case "grid_line": {
        const row = params[1], colStart = params[2], cells = params[3];
        if (typeof row === "number" && typeof colStart === "number" && Array.isArray(cells)) {
          this.applyLine(row, colStart, cells);
        }
        break;
      }
      case "grid_scroll": {
        const [top, bottom, left, right, count] = numbers(params, 1, 2, 3, 4, 5);
        this.applyScroll(top, bottom, left, right, count);
        break;
      }
      case "hl_attr_define": {
        const id = params[0];
        if (typeof id !== "number") break;
        this.attrs.set(id, parseAttr(params[1], params[2]));
        this.sgrCache.delete(id);
        break;
      }
      // default_colors_set is deliberately ignored: the embedded editor keeps
      // the terminal's own default colors, matching the preview around it.
      default:
        break;
    }
  }
  applyLine(row, colStart, cells) {
    if (row < 0 || row >= this.rows.length || colStart < 0 || colStart >= this.width) return;
    const line = this.rows[row];
    let col = colStart;
    let attr = 0;
    for (const entry of cells) {
      if (!Array.isArray(entry)) continue;
      const [text, hlId, repeat] = entry;
      if (typeof hlId === "number") attr = hlId;
      const times = typeof repeat === "number" && repeat > 0 ? repeat : 1;
      for (let i = 0; i < times && col < this.width; i++) {
        line[col++] = { text, attr };
      }
    }
  }
  applyScroll(top, bottom, left, right, count) {
    if (count === 0 || this.rows.length === 0) return;
    const topRow = clamp(top, 0, this.rows.length);
    const bottomRow = clamp(bottom, topRow, this.rows.length);
    const leftCol = clamp(left, 0, this.width);
    const rightCol = clamp(right, leftCol, this.width);
    const region = bottomRow - topRow;
    const shift = Math.min(Math.abs(count), region);
    const blank = () => blankRow(rightCol - leftCol);
    if (count > 0) {
      for (let row = topRow; row < bottomRow; row++) {
        const source = row + shift;
        this.rows[row].splice(
          leftCol,
          rightCol - leftCol,
          ...source < bottomRow ? this.rows[source].slice(leftCol, rightCol) : blank()
        );
      }
    } else {
      for (let row = bottomRow - 1; row >= topRow; row--) {
        const source = row - shift;
        this.rows[row].splice(
          leftCol,
          rightCol - leftCol,
          ...source >= topRow ? this.rows[source].slice(leftCol, rightCol) : blank()
        );
      }
    }
  }
  /** Committed ANSI lines, one per grid row, with cursor marker when focused. */
  render(focused) {
    const lines = [];
    for (let row = 0; row < this.rows.length; row++) lines.push(this.renderRow(row, focused));
    return lines;
  }
  renderRow(row, focused) {
    const cells = this.rows[row] ?? [];
    const cursor = focused && !this.busy ? this.cursor : void 0;
    let out = "";
    let open2 = "";
    let markerAt = -1;
    let column = 0;
    for (const cell of cells) {
      if (cursor?.row === row && markerAt < 0 && column + visibleWidth(cell.text) > cursor.col) markerAt = out.length;
      const sgr = this.sgrFor(cell.attr);
      if (sgr !== open2) {
        out += sgr === "" ? open2 === "" ? "" : RESET : RESET + sgr;
        open2 = sgr;
      }
      out += cell.text;
      column += visibleWidth(cell.text);
    }
    if (open2 !== "") out += RESET;
    if (cursor?.row === row && markerAt < 0) markerAt = out.length;
    if (markerAt >= 0) out = out.slice(0, markerAt) + CURSOR_MARKER + out.slice(markerAt);
    return out;
  }
  sgrFor(attrId) {
    if (attrId === 0) return "";
    const cached = this.sgrCache.get(attrId);
    if (cached !== void 0) return cached;
    const attr = this.attrs.get(attrId);
    let sgr = "";
    if (attr) {
      const parts = [];
      if (attr.bold) parts.push("1");
      if (attr.dim) parts.push("2");
      if (attr.italic) parts.push("3");
      if (attr.underline) parts.push("4");
      if (attr.strikethrough) parts.push("9");
      let foreground = attr.foreground;
      let background = attr.background;
      let ctermForeground = attr.ctermForeground;
      let ctermBackground = attr.ctermBackground;
      if (attr.reverse && foreground !== void 0 && background !== void 0) {
        [foreground, background] = [background, foreground];
        [ctermForeground, ctermBackground] = [ctermBackground, ctermForeground];
      } else if (attr.reverse) {
        parts.push("7");
      }
      const fg = this.colorSgr(foreground, ctermForeground, true);
      const bg = this.colorSgr(background, ctermBackground, false);
      if (fg) parts.push(fg);
      if (bg) parts.push(bg);
      if (parts.length) sgr = `\x1B[${parts.join(";")}m`;
    }
    this.sgrCache.set(attrId, sgr);
    return sgr;
  }
  // rgb_attr on truecolor terminals; the protocol's own cterm palette index
  // otherwise. When the preferred form is absent, the other one still applies.
  colorSgr(rgb, cterm, foreground) {
    const code = foreground ? 38 : 48;
    if (this.trueColor || cterm === void 0) {
      if (rgb === void 0) return "";
      return `${code};2;${rgb >> 16 & 255};${rgb >> 8 & 255};${rgb & 255}`;
    }
    return `${code};5;${cterm}`;
  }
};
function parseAttr(rgbAttr, ctermAttr) {
  const attr = {};
  if (typeof rgbAttr?.foreground === "number") attr.foreground = rgbAttr.foreground;
  if (typeof rgbAttr?.background === "number") attr.background = rgbAttr.background;
  if (typeof ctermAttr?.foreground === "number") attr.ctermForeground = ctermAttr.foreground;
  if (typeof ctermAttr?.background === "number") attr.ctermBackground = ctermAttr.background;
  for (const key of ["bold", "dim", "italic", "reverse", "strikethrough"]) {
    if (rgbAttr?.[key] === true) attr[key] = true;
  }
  if (rgbAttr?.underline === true || rgbAttr?.undercurl === true || rgbAttr?.underdouble === true || rgbAttr?.underdotted === true || rgbAttr?.underdashed === true) attr.underline = true;
  return attr;
}
function numbers(params, ...indexes) {
  return indexes.map((index) => typeof params[index] === "number" ? params[index] : 0);
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function blankRow(width) {
  return Array.from({ length: Math.max(0, width) }, () => ({ text: " ", attr: 0 }));
}
function blankRows(height, width) {
  return Array.from({ length: Math.max(0, height) }, () => blankRow(width));
}

// src/nvim.ts
var MINIMUM_VERSION = 0 * 1e4 + 9 * 100 + 0;
var PASTE_START = "\x1B[200~";
var PASTE_END = "\x1B[201~";
var MOUSE_PACKET = /^\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[[MIDO]/;
var NOTATION_BY_KEY = {
  escape: "Esc",
  enter: "CR",
  return: "CR",
  tab: "Tab",
  backspace: "BS",
  delete: "Del",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageUp: "PageUp",
  pageDown: "PageDown",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  clear: "Clear",
  f1: "F1",
  f2: "F2",
  f3: "F3",
  f4: "F4",
  f5: "F5",
  f6: "F6",
  f7: "F7",
  f8: "F8",
  f9: "F9",
  f10: "F10",
  f11: "F11",
  f12: "F12"
};
var NOTATION_BY_MODIFIER = { ctrl: "C", alt: "M", meta: "M", super: "D", shift: "S" };
var LUA_SETUP = [
  "vim.o.modeline = false",
  "vim.o.loadplugins = false",
  'vim.o.shadafile = "NONE"',
  "vim.o.undofile = false",
  "local runtime = vim.env.VIMRUNTIME; if runtime and #runtime > 0 then vim.opt.runtimepath = { runtime } end",
  'vim.cmd("filetype plugin indent on")',
  'vim.cmd("syntax on")'
].join("; ");
var REGISTER_LUA = `local channel = ...
local function report()
  local dirty = false
  for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
    if vim.bo[buffer].modified and vim.bo[buffer].buftype == "" and vim.bo[buffer].buflisted then
      dirty = true
      break
    end
  end
  vim.rpcnotify(channel, "pi_view_dirty", dirty)
end
vim.api.nvim_create_autocmd(
  { "TextChanged", "TextChangedI", "TextChangedP", "TextChangedT", "BufModifiedSet", "BufWritePre", "BufWritePost", "BufNew", "BufReadPost" },
  { callback = report })
report()
vim.api.nvim_create_autocmd("VimLeavePre", {
  callback = function() vim.rpcnotify(channel, "pi_view_exit") end,
})`;
var NvimEditor = class {
  constructor(path3, options, spawnChild = spawn2) {
    this.path = path3;
    this.options = options;
    this.spawnChild = spawnChild;
    this.path = resolvePath2(path3);
    this.desired = { cols: Math.max(4, options.cols), rows: Math.max(2, options.rows) };
    this.grid = new NvimGrid(getCapabilities2().trueColor);
  }
  path;
  options;
  spawnChild;
  grid;
  pending = /* @__PURE__ */ new Map();
  child;
  nextId = 1;
  stderrTail = "";
  readyTimer;
  pasteTimer;
  killTimer;
  pasteBuffer;
  inputQueue = [];
  pumping = false;
  desired;
  sent = { cols: 0, rows: 0 };
  drawing = false;
  mode = "";
  _dirty = false;
  userExit = false;
  finished = false;
  launched = false;
  get dirty() {
    return this._dirty;
  }
  get running() {
    return !this.finished;
  }
  // True once Neovim started drawing: input is live and the grid renders,
  // including native startup prompts such as swap recovery.
  get ready() {
    return this.drawing && !this.finished;
  }
  /** Launch Neovim and attach. Failures surface via onError; never throws. */
  start() {
    if (this.launched || this.finished) return;
    this.launched = true;
    try {
      const child = this.spawnChild(
        "nvim",
        ["--embed", "-u", "NONE", "-i", "NONE", "--noplugin", "--cmd", `lua ${LUA_SETUP}`, "--", this.path],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, cwd: dirname2(this.path) }
      );
      this.child = child;
      child.stdin?.on("error", () => {
      });
      child.stderr?.on("error", () => {
      });
      this.readStream(child.stdout);
      child.stderr?.on("data", (chunk) => this.rememberStderr(chunk));
      child.on("error", (error) => {
        this.fail(error.code === "ENOENT" ? "Neovim is not installed or not on PATH; install nvim (>= 0.9) to edit previews" : `Could not launch Neovim: ${safeText(error.message)}`);
      });
      child.on("close", (code, signal) => this.onSessionEnd(code, signal));
      this.readyTimer = setTimeout(() => this.fail("Neovim did not start drawing within 10 seconds"), 1e4);
      this.readyTimer.unref();
      void this.handshake().catch((error) => this.fail(error instanceof Error ? error.message : String(error)));
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }
  async handshake() {
    const info = await this.request("nvim_get_api_info", []);
    this.checkVersion(info);
    const channel = Array.isArray(info) && typeof info[0] === "number" ? info[0] : void 0;
    if (channel === void 0 || !Number.isSafeInteger(channel) || channel < 1) throw new Error("Neovim did not report a usable RPC channel");
    await this.request("nvim_exec_lua", [REGISTER_LUA, [channel]]);
    await this.attach();
  }
  input(data) {
    if (this.finished || !data) return;
    if (this.pasteBuffer !== void 0) {
      this.pasteBuffer += data;
      this.settlePaste();
      return;
    }
    const start = data.indexOf(PASTE_START);
    if (start < 0) {
      this.enqueue(translateKeys(data));
      return;
    }
    const before = data.slice(0, start);
    if (before) this.enqueue(translateKeys(before));
    this.pasteBuffer = data.slice(start + PASTE_START.length);
    this.settlePaste();
  }
  wheel(delta) {
    if (this.finished || !delta) return;
    const notches = Math.min(3, Math.max(1, Math.round(Math.abs(delta) / 3)));
    this.enqueue((delta > 0 ? "<ScrollWheelDown>" : "<ScrollWheelUp>").repeat(notches));
  }
  resize(cols, rows) {
    const next = { cols: Math.max(4, cols), rows: Math.max(2, rows) };
    if (next.cols === this.desired.cols && next.rows === this.desired.rows) return;
    this.desired = next;
    this.applyResize();
  }
  render(focused) {
    const rows = this.drawing && !this.finished ? this.grid.render(focused) : [];
    return { rows, mode: this.mode };
  }
  dispose() {
    if (this.finished) return;
    const child = this.child;
    if (!child) {
      this.finishLocally();
      return;
    }
    this.flushQueueTo(child);
    if (this._dirty) {
      void this.request("nvim_command", ["silent! preserve"]).catch(() => {
      });
      this.finishLocally();
      this.killTimer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
        }
        this.killTimer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
          }
        }, 250);
        this.killTimer.unref();
      }, 150);
      this.killTimer.unref();
    } else {
      this.finishLocally();
      try {
        child.kill("SIGTERM");
      } catch {
      }
      this.killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
      }, 300);
      this.killTimer.unref();
    }
    child.once("exit", () => clearTimeout(this.killTimer));
  }
  /** Close out client state once the child-facing teardown is arranged. */
  finishLocally() {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    this.rejectAll(new Error("Neovim session closed"));
    this.pasteBuffer = void 0;
  }
  flushQueueTo(child) {
    const items = this.inputQueue;
    this.inputQueue = [];
    for (const item of items) {
      const params = item.kind === "paste" ? [item.text, true, -1] : [item.bytes.toString("utf8")];
      try {
        child.stdin?.write((0, import_msgpack.encode)([0, this.nextId++, item.kind === "paste" ? "nvim_paste" : "nvim_input", params]));
      } catch {
      }
    }
  }
  /** Consume the msgpack-rpc stream through the maintained codec. */
  readStream(stdout) {
    void (async () => {
      try {
        const chunks = async function* (stream) {
          for await (const chunk of stream) yield chunk;
        };
        for await (const message of (0, import_msgpack.decodeMultiStream)(chunks(stdout))) {
          this.dispatch(message);
        }
      } catch (error) {
        if (error instanceof import_msgpack.DecodeError && !this.finished) {
          this.fail(`Neovim sent an invalid RPC stream: ${safeText(error.message)}`);
        }
      }
    })();
  }
  dispatch(message) {
    if (!Array.isArray(message) || message.length === 0) return;
    switch (message[0]) {
      case 1: {
        const id = message[1];
        const waiter = typeof id === "number" ? this.pending.get(id) : void 0;
        if (waiter) {
          this.pending.delete(id);
          if (message[2] !== null && message[2] !== void 0) waiter.reject(new Error(describe(message[2])));
          else waiter.resolve(message[3]);
        }
        return;
      }
      case 2: {
        const [method, params] = [message[1], message[2]];
        if (method === "redraw" && Array.isArray(params)) {
          this.markDrawing();
          this.handleRedraw(params);
        } else if (method === "pi_view_dirty") this.setDirty(params?.[0] === true);
        else if (method === "pi_view_exit") this.userExit = true;
        return;
      }
      default:
        return;
    }
  }
  handleRedraw(groups) {
    for (const group of groups) {
      if (!Array.isArray(group) || typeof group[0] !== "string") continue;
      const name = group[0];
      const tuples = group.slice(1);
      if (name === "flush") {
        this.options.onFlush();
        continue;
      }
      if (name === "mode_change") {
        const mode = Array.isArray(tuples[0]) ? tuples[0][0] : void 0;
        if (typeof mode === "string" && mode !== this.mode) {
          this.mode = mode;
          this.options.onFlush();
        }
        continue;
      }
      if (name === "busy_start") {
        this.grid.busy = true;
        continue;
      }
      if (name === "busy_stop") {
        this.grid.busy = false;
        this.options.onFlush();
        continue;
      }
      for (const tuple of tuples) {
        if (Array.isArray(tuple)) this.grid.handle(name, tuple);
      }
    }
  }
  request(method, params) {
    const child = this.child;
    if (this.finished || !child) return Promise.reject(new Error("Neovim session closed"));
    const id = this.nextId++;
    const { promise, resolve: resolve4, reject } = Promise.withResolvers();
    this.pending.set(id, { resolve: resolve4, reject });
    const frame = (0, import_msgpack.encode)([0, id, method, params]);
    child.stdin?.write(frame, (error) => {
      if (error) {
        this.pending.delete(id);
        reject(new Error(`Could not write to Neovim: ${safeText(error.message)}`));
      }
    });
    return promise;
  }
  rejectAll(error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }
  setDirty(dirty) {
    if (dirty === this._dirty) return;
    this._dirty = dirty;
    this.options.onDirty?.(dirty);
  }
  /** Queue notation or paste text; one FIFO keeps Neovim's input ordered. */
  enqueue(notation) {
    if (!notation) return;
    this.inputQueue.push({ kind: "keys", bytes: Buffer.from(notation, "utf8") });
    void this.pumpInput();
  }
  /** nvim_input may accept fewer bytes than queued; pump until drained. */
  async pumpInput() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.inputQueue.length > 0) {
        if (this.finished) {
          this.inputQueue.length = 0;
          return;
        }
        if (!this.child) {
          await delay(10);
          continue;
        }
        const item = this.inputQueue[0];
        if (item.kind === "paste") {
          this.inputQueue.shift();
          if (item.text) await this.request("nvim_paste", [item.text, true, -1]).catch(() => {
          });
          continue;
        }
        let written;
        try {
          written = await this.request("nvim_input", [item.bytes.toString("utf8")]);
        } catch {
          this.inputQueue.length = 0;
          return;
        }
        const consumed = typeof written === "number" ? written : item.bytes.length;
        if (consumed >= item.bytes.length) {
          this.inputQueue.shift();
        } else if (consumed > 0) {
          this.inputQueue[0] = { kind: "keys", bytes: item.bytes.subarray(consumed) };
        } else {
          await delay(5);
        }
      }
    } finally {
      this.pumping = false;
    }
  }
  /** Complete a bracketed paste at the end marker; flush stuck pastes late. */
  settlePaste() {
    const end = this.pasteBuffer?.indexOf(PASTE_END) ?? -1;
    if (end < 0) {
      this.pasteTimer ??= setTimeout(() => {
        const stuck = this.pasteBuffer;
        this.pasteBuffer = void 0;
        this.pasteTimer = void 0;
        if (stuck) {
          this.inputQueue.push({ kind: "paste", text: stuck });
          void this.pumpInput();
        }
      }, 3e3);
      this.pasteTimer.unref();
      return;
    }
    const payload = this.pasteBuffer.slice(0, end);
    const tail = this.pasteBuffer.slice(end + PASTE_END.length);
    this.pasteBuffer = void 0;
    clearTimeout(this.pasteTimer);
    this.pasteTimer = void 0;
    if (payload) {
      this.inputQueue.push({ kind: "paste", text: payload });
      void this.pumpInput();
    }
    if (tail) this.enqueue(translateKeys(tail));
  }
  applyResize() {
    if (!this.drawing || this.finished) return;
    if (this.desired.cols === this.sent.cols && this.desired.rows === this.sent.rows) return;
    const { cols, rows } = this.desired;
    void this.request("nvim_ui_try_resize", [cols, rows]).then(() => {
      this.sent = { cols, rows };
    }).catch(() => {
    });
  }
  async attach() {
    const { cols, rows } = this.desired;
    await this.request("nvim_ui_attach", [cols, rows, { rgb: true, ext_linegrid: true }]);
    this.sent = { cols, rows };
  }
  checkVersion(info) {
    const metadata = Array.isArray(info) ? info[1] : void 0;
    const version = metadata?.version;
    const major = version?.major, minor = version?.minor, patch = version?.patch;
    if (typeof major !== "number" || typeof minor !== "number" || typeof patch !== "number") {
      throw new Error("Neovim did not report a recognizable API version");
    }
    if (major * 1e4 + minor * 100 + patch < MINIMUM_VERSION) {
      throw new Error(`Neovim ${major}.${minor}.${patch} is too old; pi-view editing needs nvim >= 0.9 on PATH`);
    }
  }
  rememberStderr(chunk) {
    this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-500);
  }
  onSessionEnd(code, signal) {
    if (this.finished) return;
    if (!this.drawing && !this.userExit) {
      const detail = this.stderrTail.trim();
      const cause = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.fail(`Neovim exited during startup (${cause})${detail ? `: ${detail}` : ""}`);
      return;
    }
    this.finishLocally();
    if (this.userExit) this.options.onExit("quit");
    else {
      const detail = signal ? `Neovim terminated by signal ${signal}` : `Neovim exited with code ${code ?? "unknown"}`;
      this.options.onExit("crashed", detail);
    }
  }
  /** First screen output: the session is interactive, so stand down the guard. */
  markDrawing() {
    if (this.drawing) return;
    this.drawing = true;
    clearTimeout(this.readyTimer);
    this.readyTimer = void 0;
    this.options.onReady();
  }
  /** Terminal failure: report an actionable message, keep the preview alive. */
  fail(message) {
    const firstFailure = !this.finished;
    this.finished = true;
    this.clearTimers();
    this.rejectAll(new Error(message));
    this.pasteBuffer = void 0;
    try {
      this.child?.kill("SIGKILL");
    } catch {
    }
    if (firstFailure) this.options.onError(safeText(message));
  }
  clearTimers() {
    clearTimeout(this.readyTimer);
    clearTimeout(this.pasteTimer);
    clearTimeout(this.killTimer);
    this.readyTimer = void 0;
    this.pasteTimer = void 0;
    this.killTimer = void 0;
  }
};
function translateKeys(data) {
  if (!data || MOUSE_PACKET.test(data)) return "";
  const key = parseKey(data);
  if (key !== void 0) return notationFor(key);
  return literalNotation(data);
}
function notationFor(keyId) {
  const modifiers = keyId.split("+");
  const base = modifiers.pop() ?? "";
  if (modifiers.length === 0) {
    if (base === "space") return " ";
    if (base.length === 1) return base === "<" ? "<LT>" : base;
    const named = NOTATION_BY_KEY[base];
    return named ? `<${named}>` : "";
  }
  let inner = NOTATION_BY_KEY[base];
  if (!inner) {
    if (base.length !== 1) return "";
    if (modifiers.length === 1 && modifiers[0] === "shift") return base === "<" ? "<LT>" : base.toUpperCase();
    inner = base.toUpperCase();
  }
  const prefix = modifiers.map((modifier) => NOTATION_BY_MODIFIER[modifier] ?? modifier.toUpperCase()).join("-");
  return `<${prefix}-${inner}>`;
}
function literalNotation(text) {
  let out = "";
  for (const char of text) {
    if (char === "<") {
      out += "<LT>";
      continue;
    }
    if (char === "\r" || char === "\n") {
      out += "<CR>";
      continue;
    }
    if (char === "	") {
      out += "<Tab>";
      continue;
    }
    if (char === "\x1B") {
      out += "<Esc>";
      continue;
    }
    if (char === "\x7F") {
      out += "<BS>";
      continue;
    }
    const code = char.charCodeAt(0);
    if (code === 0) {
      out += "<C-@>";
      continue;
    }
    if (code <= 31 && char.length === 1) {
      out += `<C-${String.fromCharCode(64 + code)}>`;
      continue;
    }
    out += char;
  }
  return out;
}
function delay(ms) {
  const { promise, resolve: resolve4 } = Promise.withResolvers();
  const timer = setTimeout(resolve4, ms);
  timer.unref();
  return promise;
}
function describe(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(describe).filter(Boolean).join(": ");
  if (value === null || value === void 0) return "";
  return safeText(String(value));
}

// src/viewer.ts
function markdownSourceUnits(source) {
  const units = [];
  let content = "";
  const flush = () => {
    const text = content.replace(/\s+/g, " ").trim();
    if (text) units.push(text);
    content = "";
  };
  const walk = (tokens) => {
    for (const token of tokens) {
      if (token.type === "code") {
        flush();
        for (const line of token.text.split("\n")) {
          content = line;
          flush();
        }
      } else if (["br", "space", "hr", "html"].includes(token.type)) flush();
      else if (token.type === "list") {
        flush();
        for (const item of token.items) {
          walk(item.tokens);
          flush();
        }
      } else if (token.type === "table") {
        flush();
        for (const row of [token.header, ...token.rows]) {
          for (const cell of row) {
            walk(cell.tokens);
            flush();
          }
        }
      } else {
        if ("tokens" in token && Array.isArray(token.tokens)) walk(token.tokens);
        else if ("text" in token && typeof token.text === "string") content += token.text;
        if (token.type === "paragraph" || token.type === "heading" || token.type === "blockquote") flush();
      }
    }
  };
  for (const token of Yt(source)) {
    walk([token]);
    flush();
  }
  return units;
}
var HELP = `pi-view \u2014 local previews; nothing is sent to the model

/view <path> or /v <path>    Tab completes files and directories
/view or /v                Quick Open: recent session files and paths
Cmd+P / Ctrl+P on Windows   Quick Open above any dialog (if forwarded)
/view --diagnostics        Terminal capabilities and PDF dependencies

Esc / Ctrl+C               Close and restore the agent UI
Up/Down, j/k, PgUp/PgDn     Scroll text; arrows pan an image
Home / End                 Start / end of text
/                          Search text (or filter the file picker)
n / N                      Next / previous search match
w                          Toggle line wrapping
l                          Toggle source line numbers
s                          Markdown source / PDF extracted text
e                          Edit with Neovim (:w saves, :q! discards, :q returns)
Enter or i                 Focus the first visible Markdown image
b                          Return from an image/help/diagnostics
+ / -                      Zoom a focused image or PDF page
0 / 1                      Fit / actual raster size
[ / ] or PgUp/PgDn         Previous / next PDF page
Mouse wheel                Scroll text or change PDF pages; no image zoom
g                          Jump to a PDF page
r                          Reload (source file changes also reload)
R                          Ask to load remote Markdown images
o                          Browse the current file's directory
? / d                      Help / diagnostics

PNG, JPEG, static GIF, WebP and SVG; SVG is rasterized.
Images are bounded to 4096px per side; actual size uses that raster.
PDF requires Poppler. Scans have no searchable text without OCR.
Previews exclude HTML/webpages, animation, JavaScript and automatic remote fetching.
Quick Open: arrows select, Tab completes, Enter opens; Esc clears then closes.
PI_VIEW_SHORTCUT overrides Quick Open (for example: ctrl+alt+p).
Ghostty forwarding if needed: keybind = super+p=csi:112;9u
PI_VIEW_IMAGES=off forces text/path fallbacks.
Mouse support depends on the terminal; keyboard controls always work.`;
var PreviewViewer = class {
  constructor(tui, theme, done, path3, initial, onOpen) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.onOpen = onOpen;
    this.path = path3;
    this.detachMouse = attachMouse(tui, (delta) => this.wheel(delta));
    this.input.onSubmit = (value) => this.submitInput(value);
    if (initial === "help") this.panel = HELP;
    else if (initial === "diagnostics") void this.showDiagnostics();
    else void this.open(path3);
  }
  tui;
  theme;
  done;
  onOpen;
  document;
  abort = new AbortController();
  closed = false;
  loading = false;
  message = "";
  path;
  watcher;
  reloadTimer;
  detachMouse;
  offset = 0;
  matchRow;
  matchHit;
  horizontal = 0;
  width = 80;
  bodyHeight = 20;
  totalRows = 0;
  wrap = true;
  numbers = false;
  source = false;
  page = 1;
  pageWheelAt = 0;
  pageWheelDirection = 0;
  pdfSource;
  pdfTextLoading;
  focusImage;
  zoom = 1;
  actualSize = false;
  panX = 0.5;
  panY = 0.5;
  remoteAllowed = false;
  remotePrompt = false;
  panel;
  layout;
  frames = /* @__PURE__ */ new Map();
  images = /* @__PURE__ */ new Map();
  imageJobs = Promise.resolve();
  requestedImages = /* @__PURE__ */ new Set();
  visibleImages = [];
  input = new Input();
  inputMode;
  query = "";
  filter = "";
  picker;
  editor;
  _focused = false;
  get focused() {
    return this._focused;
  }
  set focused(value) {
    this._focused = value;
    this.input.focused = value && !!this.inputMode;
    if (!value) {
      this.detachMouse?.();
      this.detachMouse = void 0;
    } else if (!this.closed && !this.detachMouse) this.detachMouse = attachMouse(this.tui, (delta) => this.wheel(delta));
  }
  // True while an embedded editor session is starting or running: it owns
  // every preview key, including the host's global shortcut.
  get editing() {
    return !!this.editor;
  }
  redraw(clearLayout = false) {
    if (clearLayout) {
      this.layout = void 0;
      this.matchRow = void 0;
    }
    if (!this.closed) this.tui.requestRender();
  }
  invalidate() {
    this.layout = void 0;
    for (const frame of this.frames.values()) frame.component?.invalidate();
  }
  dispose() {
    this.editor?.dispose();
    this.editor = void 0;
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    this.stopWatching();
    clearTimeout(this.reloadTimer);
    this.detachMouse?.();
    this.detachMouse = void 0;
    this.clearFrames();
    this.images.clear();
  }
  clearFrames() {
    for (const frame of this.frames.values()) {
      frame.abort.abort();
      frame.component?.dispose();
      frame.retired?.dispose();
    }
    this.frames.clear();
  }
  async open(path3, reload = false) {
    clearTimeout(this.reloadTimer);
    this.abort.abort();
    const controller = this.abort = new AbortController();
    if (path3 !== this.path) this.stopWatching();
    this.clearFrames();
    this.images.clear();
    this.loading = true;
    this.message = "";
    if (!this.watcher) this.watchPath(path3);
    if (!reload) {
      this.document = void 0;
      this.picker = void 0;
      this.panel = void 0;
      this.offset = 0;
      this.horizontal = 0;
      this.source = false;
      this.page = 1;
      this.query = "";
      this.filter = "";
      this.focusImage = void 0;
      this.remoteAllowed = false;
      this.resetZoom();
    }
    this.pdfSource = void 0;
    this.path = path3;
    this.redraw(true);
    try {
      const info = await stat2(path3);
      if (controller.signal.aborted) return;
      if (info.isDirectory()) {
        this.stopWatching();
        const entries = await listDirectory(path3);
        if (controller.signal.aborted) return;
        this.picker = { directory: path3, entries, selected: 0 };
        if (entries.length >= MAX_LIST_ENTRIES) this.message = `Listing capped at ${MAX_LIST_ENTRIES} entries; open a specific path directly`;
        this.document = void 0;
      } else {
        const document = await loadDocument(path3, controller.signal);
        if (controller.signal.aborted) return;
        this.document = document;
        this.picker = void 0;
        if (!reload) this.onOpen?.(path3);
        if (document.kind === "pdf") {
          this.page = Math.min(this.page, document.pages);
          if (!capabilities().protocol) this.source = true;
        }
        if (document.kind === "image") this.images.set(path3, { image: document.image });
        if (this.source && document.kind === "pdf") void this.loadPdfText();
      }
    } catch (error) {
      if (!controller.signal.aborted) this.message = safeText(error.message);
    } finally {
      if (!controller.signal.aborted) {
        this.loading = false;
        this.redraw(true);
      }
    }
  }
  watchPath(path3) {
    const listener = () => {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => {
        if (!this.closed) void this.open(path3, true);
      }, 200);
    };
    this.watcher = { path: path3, listener };
    watchFile(path3, { interval: 250 }, listener);
  }
  stopWatching() {
    if (!this.watcher) return;
    unwatchFile(this.watcher.path, this.watcher.listener);
    this.watcher = void 0;
  }
  resetZoom() {
    this.zoom = 1;
    this.actualSize = false;
    this.panX = 0.5;
    this.panY = 0.5;
  }
  async showDiagnostics() {
    const cap = capabilities();
    this.panel = ["pi-view diagnostics", "", ...cap.details, "", "Checking PDF tools\u2026"].join("\n");
    this.offset = 0;
    this.clearFrames();
    this.redraw(true);
    const panel = this.panel;
    const media = await mediaDiagnostics();
    if (!this.closed && this.panel === panel) {
      this.panel = ["pi-view diagnostics", "", ...cap.details, "", ...media, "", "Images: sharp, static first frame; maximum source raster 4096px/side", "HTML/webpages and animation: disabled", "Remote Markdown images: permission required", "Preview content: never added to model context", "", "b: back \xB7 Esc: close"].join("\n");
      this.redraw(true);
    }
  }
  imageMode() {
    return !this.panel && !this.picker && (!!this.focusImage || this.document?.kind === "image" || this.document?.kind === "pdf" && !this.source);
  }
  editable() {
    return !this.loading && !this.panel && !this.picker && !this.imageMode() && (this.document?.kind === "text" || this.document?.kind === "markdown");
  }
  createEditor() {
    return new NvimEditor(this.path, {
      cols: this.width || 80,
      rows: this.bodyHeight || 20,
      onReady: () => {
        if (this.closed) return;
        this.message = "";
        this.redraw();
      },
      onFlush: () => this.redraw(),
      onError: (message) => {
        if (this.closed) return;
        this.editor = void 0;
        if (!this.watcher) this.watchPath(this.path);
        this.message = message;
        this.redraw(true);
      },
      onExit: (reason, detail) => {
        if (this.closed) return;
        this.editor = void 0;
        this.matchRow = void 0;
        this.matchHit = void 0;
        void this.open(this.path, true).then(() => {
          if (!this.closed && !this.editor && reason === "crashed" && detail && !this.message) {
            this.message = detail;
            this.redraw();
          }
        });
      },
      onDirty: () => this.redraw()
    });
  }
  startEditing() {
    if (this.closed || this.editor || !this.editable()) return;
    this.stopWatching();
    this.clearFrames();
    clearTimeout(this.reloadTimer);
    this.matchRow = void 0;
    this.matchHit = void 0;
    this.message = "Starting Neovim\u2026";
    this.editor = this.createEditor();
    this.editor.start();
    this.redraw(true);
  }
  requestClose() {
    if (!this.editor) return true;
    this.message = "Neovim session active \u2014 finish with :q or :wq (or :q! to discard)";
    this.redraw();
    return false;
  }
  wheel(delta) {
    if (this.closed || this.inputMode || this.remotePrompt || !delta) return;
    if (this.editor) {
      this.editor.wheel(delta);
      return;
    }
    if (this.imageMode()) {
      if (this.document?.kind === "pdf") {
        const direction = Math.sign(delta);
        const now = performance.now();
        if (direction === this.pageWheelDirection && now - this.pageWheelAt < 200) return;
        this.pageWheelAt = now;
        this.pageWheelDirection = direction;
        this.setPage(this.page + direction);
      }
      return;
    }
    if (this.picker && !this.panel) this.picker.selected = Math.max(0, Math.min(this.filteredEntries().length - 1, this.picker.selected + Math.sign(delta) * 3));
    else this.offset = Math.max(0, Math.min(Math.max(0, this.totalRows - this.bodyHeight), this.offset + Math.sign(delta) * 3));
    this.redraw();
  }
  setPage(page) {
    if (this.document?.kind !== "pdf") return;
    page = Math.max(1, Math.min(this.document.pages, page));
    if (page === this.page) return;
    this.page = page;
    this.resetZoom();
    this.redraw();
  }
  handleInput(data) {
    if (this.closed || isKeyRelease(data)) return;
    if (this.editor) {
      this.editor.input(data);
      return;
    }
    const raw = data;
    const key = parseKey2(data);
    if (key?.length === 1) data = key;
    else if (key && /^shift\+[a-z]$/.test(key)) data = key.slice(-1).toUpperCase();
    else if (key === "shift+=") data = "+";
    else if (key === "shift+/") data = "?";
    else if (key === "space") data = " ";
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.dispose();
      this.done();
      return;
    }
    if (this.remotePrompt) {
      this.remotePrompt = false;
      if (data.toLowerCase() === "y") {
        this.remoteAllowed = true;
        this.images.clear();
        this.clearFrames();
        this.redraw(true);
      } else this.redraw();
      return;
    }
    if (this.inputMode) {
      this.input.handleInput(raw);
      this.redraw();
      return;
    }
    if (data === "?") {
      this.panel = HELP;
      this.offset = 0;
      this.clearFrames();
      this.redraw(true);
      return;
    }
    if (data === "d") {
      void this.showDiagnostics();
      return;
    }
    if (data === "b") {
      this.panel = void 0;
      this.focusImage = void 0;
      this.offset = 0;
      this.resetZoom();
      if (!this.document && !this.picker) void this.open(this.path);
      this.redraw(true);
      return;
    }
    if (data === "r") {
      void this.open(this.path, true);
      return;
    }
    if (data === "o") {
      void this.open(this.picker?.directory ?? dirname3(this.path));
      return;
    }
    if (data === "R" && this.document?.kind === "markdown") {
      this.remotePrompt = true;
      this.redraw();
      return;
    }
    if (data === "/") {
      this.startInput(this.picker && !this.panel ? "filter" : "search");
      return;
    }
    if (this.picker && !this.panel) {
      const entries = this.filteredEntries();
      if (matchesKey(data, "enter") && entries[this.picker.selected]) void this.open(entries[this.picker.selected].path);
      else if (matchesKey(data, "backspace") || matchesKey(data, "left")) void this.open(dirname3(this.picker.directory));
      else if (matchesKey(data, "up") || data === "k") this.picker.selected = Math.max(0, this.picker.selected - 1);
      else if (matchesKey(data, "down") || data === "j") this.picker.selected = Math.min(entries.length - 1, this.picker.selected + 1);
      else if (matchesKey(data, "pageUp")) this.picker.selected = Math.max(0, this.picker.selected - this.bodyHeight);
      else if (matchesKey(data, "pageDown")) this.picker.selected = Math.min(entries.length - 1, this.picker.selected + this.bodyHeight);
      this.redraw();
      return;
    }
    if (data === "e" && this.editable()) {
      this.startEditing();
      return;
    }
    if (data === "s" && !this.panel && (this.document?.kind === "markdown" || this.document?.kind === "pdf")) {
      this.source = !this.source;
      this.focusImage = void 0;
      this.offset = 0;
      this.clearFrames();
      if (this.source && this.document.kind === "pdf" && this.pdfSource === void 0) void this.loadPdfText();
      this.redraw(true);
      return;
    }
    if (this.document?.kind === "pdf" && !this.panel) {
      if (data === "g") {
        this.startInput("page");
        return;
      }
      if (data === "[" || data === "]" || this.imageMode() && (matchesKey(data, "pageUp") || matchesKey(data, "pageDown"))) {
        this.setPage(this.page + (data === "[" || matchesKey(data, "pageUp") ? -1 : 1));
        return;
      }
    }
    if (this.imageMode()) {
      if (data === "+" || data === "=") this.zoom = Math.min(32, this.zoom * 1.2);
      else if (data === "-") this.zoom = Math.max(0.05, this.zoom / 1.2);
      else if (data === "0") this.resetZoom();
      else if (data === "1") {
        this.zoom = 1;
        this.actualSize = true;
      } else if (matchesKey(data, "left") || data === "h") this.panX = Math.max(0, this.panX - 0.1);
      else if (matchesKey(data, "right") || data === "l") this.panX = Math.min(1, this.panX + 0.1);
      else if (matchesKey(data, "up") || data === "k") this.panY = Math.max(0, this.panY - 0.1);
      else if (matchesKey(data, "down") || data === "j") this.panY = Math.min(1, this.panY + 0.1);
      this.redraw();
      return;
    }
    if ((matchesKey(data, "enter") || data === "i") && this.visibleImages.length) {
      this.focusImage = this.visibleImages[0];
      this.resetZoom();
      this.redraw();
      return;
    }
    if (data === "w") {
      this.wrap = !this.wrap;
      this.horizontal = 0;
      this.redraw(true);
      return;
    }
    if (data === "l") {
      this.numbers = !this.numbers;
      this.redraw(true);
      return;
    }
    if (data === "n" || data === "N") {
      this.findMatch(data === "N" ? -1 : 1);
      return;
    }
    if (matchesKey(data, "up") || data === "k") this.offset--;
    else if (matchesKey(data, "down") || data === "j") this.offset++;
    else if (matchesKey(data, "pageUp")) this.offset -= this.bodyHeight;
    else if (matchesKey(data, "pageDown") || data === " ") this.offset += this.bodyHeight;
    else if (matchesKey(data, "home")) this.offset = 0;
    else if (matchesKey(data, "end")) this.offset = Math.max(0, this.totalRows - this.bodyHeight);
    else if (matchesKey(data, "left")) this.horizontal = Math.max(0, this.horizontal - 8);
    else if (matchesKey(data, "right")) this.horizontal = Math.min(1e5, this.horizontal + 8);
    this.offset = Math.max(0, Math.min(Math.max(0, this.totalRows - this.bodyHeight), this.offset));
    this.redraw();
  }
  startInput(mode) {
    this.inputMode = mode;
    this.input.setValue(mode === "filter" ? this.filter : mode === "search" ? this.query : "");
    this.input.handleInput("\x1B[F");
    this.input.focused = this.focused;
    this.redraw();
  }
  submitInput(value) {
    const mode = this.inputMode;
    this.inputMode = void 0;
    this.input.focused = false;
    value = safeText(value).replace(/\n/g, "");
    if (mode === "filter") {
      this.filter = value;
      if (this.picker) this.picker.selected = 0;
    }
    if (mode === "search") {
      this.query = value;
      this.findMatch(1, true);
    }
    if (mode === "page" && this.document?.kind === "pdf") {
      const page = Number(value);
      if (Number.isInteger(page) && page >= 1 && page <= this.document.pages) this.setPage(page);
      else this.message = `Choose a page from 1 to ${this.document.pages}`;
    }
    this.redraw();
  }
  async loadPdfText() {
    const controller = this.abort;
    if (this.pdfTextLoading === controller) return;
    this.pdfTextLoading = controller;
    this.message = "Extracting PDF text\u2026";
    this.redraw();
    try {
      const source = await pdfText(this.path, controller.signal);
      if (controller.signal.aborted) return;
      this.pdfSource = source || "No text layer found. Scanned PDFs require OCR (not included).";
      this.message = "";
      this.redraw(true);
    } catch (error) {
      if (!controller.signal.aborted) {
        this.message = safeText(error.message);
        this.redraw();
      }
    } finally {
      if (this.pdfTextLoading === controller) this.pdfTextLoading = void 0;
    }
  }
  filteredEntries() {
    return this.picker?.entries.filter((entry) => entry.name.toLowerCase().includes(this.filter.toLowerCase())) ?? [];
  }
  textLines(text, width, code = false) {
    const language = this.document && getLanguageFromPath(this.document.path);
    const lines = code && text.length <= 1e5 ? highlightCode(text, language) : text.split("\n");
    const digits = String(lines.length).length;
    const rows = [];
    const units = [];
    for (const [index, line] of lines.entries()) {
      const prefix = this.numbers ? this.theme.fg("dim", `${String(index + 1).padStart(digits)} \u2502 `) : "";
      const indent = this.numbers ? digits + 3 : 0;
      const contentWidth = Math.max(1, width - indent);
      const expanded = line.replace(/\t/g, "    ");
      const plain = stripVTControlCharacters2(expanded);
      const wrapped = this.wrap ? wrapTextWithAnsi(expanded, contentWidth) : [expanded];
      const unit = { content: plain, spans: [] };
      let position = 0;
      for (const [partIndex, part] of wrapped.entries()) {
        const visible = stripVTControlCharacters2(part);
        const start = plain.startsWith(visible, position) ? position : plain.startsWith(visible, position + 1) ? position + 1 : Math.max(0, plain.indexOf(visible, position));
        unit.spans.push({ row: rows.length, start, end: start + visible.length });
        rows.push((partIndex === 0 ? prefix : " ".repeat(indent)) + part);
        position = start + visible.length;
      }
      units.push(unit);
    }
    return { lines: rows, units };
  }
  getLayout(width) {
    const key = `${width}|${this.bodyHeight}|${this.source}|${this.wrap}|${this.numbers}|${this.panel ?? ""}|${this.pdfSource ?? ""}`;
    if (this.layout?.key === key) return this.layout;
    let blocks = [];
    if (this.panel) blocks = [{ kind: "text", ...this.textLines(this.panel, width) }];
    else if (this.document?.kind === "markdown" && !this.source) {
      const theme = getMarkdownTheme();
      const highlight = theme.highlightCode;
      theme.highlightCode = (code, lang) => code.length <= 1e5 && highlight ? highlight(code, lang) : code.split("\n");
      const renderWidth = this.wrap ? width : Math.min(4096, this.document.source.split("\n").reduce((max, line) => Math.max(max, visibleWidth2(line)), width));
      blocks = this.document.blocks.map((block) => block.kind === "image" ? { kind: "image", target: block.target, alt: block.alt, rows: !capabilities().protocol || !this.remoteAllowed && /^https?:\/\//i.test(block.target) ? 1 : Math.max(2, Math.min(12, this.bodyHeight - 1)) } : this.markdownBlock(new Markdown(block.text, 0, 0, theme).render(renderWidth), block.text));
    } else if (this.document?.kind === "text" || this.document?.kind === "markdown") {
      blocks = [{ kind: "text", ...this.textLines(this.document.source, width, true) }];
    } else if (this.document?.kind === "pdf" && this.source) {
      blocks = [{ kind: "text", ...this.textLines(this.pdfSource ?? "Extracting text\u2026", width) }];
    }
    this.layout = { key, blocks };
    return this.layout;
  }
  // Match source-derived text forward, preserving hard boundaries and the spaces
  // dropped by wrapping.
  // Unaligned decorations stay row-local; native span metadata would
  // allow cross-row search there without guessing or rescanning the source.
  markdownBlock(rows, source) {
    const sourceUnits = markdownSourceUnits(source);
    const units = [];
    let unit = 0, position = 0;
    let open2;
    let openUnit = 0, start = 0, end = 0;
    const flush = () => {
      if (!open2) return;
      open2.content = sourceUnits[openUnit].slice(start, end);
      units.push(open2);
      open2 = void 0;
    };
    for (const [row, raw] of rows.entries()) {
      const plain = stripVTControlCharacters2(raw).trim();
      if (!plain) {
        flush();
        continue;
      }
      while (unit < sourceUnits.length && position >= sourceUnits[unit].length) {
        unit++;
        position = 0;
      }
      const sourceText = sourceUnits[unit];
      const piece = plain.replace(/^(?:[│>]\s*)+/, "").replace(/^(?:[•*+-]|\d+[.)])\s+/, "");
      const at = position + (sourceText?.[position] === " " ? 1 : 0);
      if (piece && sourceText?.startsWith(piece, at)) {
        if (open2 && openUnit !== unit) flush();
        if (!open2) {
          open2 = { content: "", spans: [] };
          openUnit = unit;
          start = at;
        }
        end = at + piece.length;
        open2.spans.push({ row, start: at - start, end: end - start });
        position = end;
      } else {
        flush();
        units.push({ content: plain, spans: [{ row, start: 0, end: plain.length }] });
      }
    }
    flush();
    return { kind: "text", lines: rows, units };
  }
  searchState() {
    const layout = this.getLayout(this.width);
    if (!layout.search || layout.search.query !== this.query) {
      const matches = [];
      if (this.query.trim()) {
        const pattern = new RegExp(this.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
        let cursor = 0;
        for (const block of layout.blocks) {
          const units = block.kind === "image" ? [{ content: `[${block.target}]`, spans: [{ row: 0, start: 0, end: block.target.length + 2 }] }] : block.units ?? [];
          for (const unit of units) {
            let first = 0;
            for (const hit of unit.content.matchAll(pattern)) {
              const end = hit.index + hit[0].length;
              while (first < unit.spans.length && unit.spans[first].end <= hit.index) first++;
              if (first === unit.spans.length || unit.spans[first].start >= end) continue;
              let last = first;
              while (last + 1 < unit.spans.length && unit.spans[last + 1].start < end) last++;
              const row = cursor + unit.spans[first].row;
              const endRow = cursor + unit.spans[last].row;
              const previous = matches.at(-1);
              if (!previous || previous.row !== row || previous.endRow !== endRow) matches.push({ row, endRow });
            }
          }
          cursor += block.kind === "text" ? block.lines.length : block.rows;
        }
      }
      layout.search = { query: this.query, matches };
    }
    return layout.search;
  }
  findMatch(direction, includeCurrent = false) {
    if (!this.query) return;
    const { matches } = this.searchState();
    if (!matches.length) {
      this.message = `No match: ${this.query}`;
      this.redraw();
      return;
    }
    let index;
    if (!includeCurrent && this.matchHit?.list === matches) {
      index = (this.matchHit.index + direction + matches.length) % matches.length;
    } else {
      const row = this.matchRow ?? this.offset;
      index = direction > 0 ? matches.findIndex((match2) => includeCurrent ? match2.row >= row : match2.row > row) : matches.findLastIndex((match2) => match2.row < row);
      if (index === -1) index = direction > 0 ? 0 : matches.length - 1;
    }
    const match = matches[index];
    this.matchHit = { list: matches, index };
    this.matchRow = match.row;
    this.offset = match.row;
    this.message = "";
    this.redraw();
  }
  getImage(target) {
    let entry = this.images.get(target);
    if (entry?.image) return Promise.resolve(entry.image);
    if (entry?.error) return Promise.reject(new Error(entry.error));
    if (entry?.promise) return entry.promise;
    entry = { abort: new AbortController() };
    this.images.set(target, entry);
    const source = entry;
    const signal = AbortSignal.any([this.abort.signal, entry.abort.signal]);
    const path3 = this.path;
    const page = this.document?.kind === "pdf" ? this.page : void 0;
    const allowRemote = this.remoteAllowed;
    const promise = this.imageJobs.then(() => {
      signal.throwIfAborted();
      return page !== void 0 && target === `pdf:${page}` ? loadPdfPage(path3, page, signal) : loadImage(target, dirname3(path3), allowRemote, signal);
    });
    source.promise = promise.then((image) => {
      source.image = image;
      source.promise = void 0;
      const completed = [...this.images].filter(([, entry2]) => entry2.image);
      for (const [key] of completed.slice(0, Math.max(0, completed.length - 4))) this.images.delete(key);
      return image;
    }, (error) => {
      source.error = safeText(error.message);
      source.promise = void 0;
      throw error;
    });
    this.imageJobs = source.promise.catch(() => {
    });
    return source.promise;
  }
  imageLines(target, width, fullRows, top, rows, focused, used) {
    this.requestedImages.add(target);
    const cap = capabilities();
    const label = safeText(target.startsWith("data:") ? "embedded image" : target).replace(/[\n\t]/g, " ");
    if (!cap.protocol || width < 5) return [truncateToWidth(this.theme.fg("muted", `[${safeText(label)}] \u2014 terminal images unavailable; d: diagnostics`), width), ...Array(rows - 1).fill("")];
    const key = [target, width, fullRows, top, rows, cap.protocol, cap.cellWidth, cap.cellHeight, focused].join("|");
    const transform = focused ? `${this.zoom}|${this.actualSize}|${this.panX}|${this.panY}` : "fit";
    used.add(key);
    let frame = this.frames.get(key);
    if (!frame) {
      frame = { abort: new AbortController() };
      this.frames.set(key, frame);
    }
    if (frame.rendered !== transform && !frame.pending) {
      const current = frame;
      if (this.message === current.error) this.message = "";
      current.error = void 0;
      current.pending = transform;
      const signal = AbortSignal.any([this.abort.signal, current.abort.signal]);
      const options = {
        widthPx: Math.max(1, Math.floor((width - 2) * cap.cellWidth)),
        heightPx: Math.max(1, Math.floor(fullRows * cap.cellHeight)),
        zoom: focused ? this.zoom : 1,
        actualSize: focused && this.actualSize,
        panX: focused ? this.panX : 0.5,
        panY: focused ? this.panY : 0.5,
        cropTopPx: Math.floor(top * cap.cellHeight),
        cropHeightPx: Math.max(1, Math.floor(rows * cap.cellHeight))
      };
      void this.getImage(target).then((image) => renderRaster(image, options, signal)).then((png) => {
        if (signal.aborted || this.closed) return;
        const component = createTerminalImage(png, width - 2, rows, label, this.tui);
        current.retired = current.component;
        current.component = component;
        current.rendered = transform;
      }).catch((error) => {
        if (!signal.aborted && !this.closed) {
          current.error = safeText(error.message);
          current.rendered = transform;
          this.message = current.error;
        }
      }).finally(() => {
        current.pending = void 0;
        if (!signal.aborted) this.redraw();
      });
    }
    if (frame.component) {
      const lines = frame.component.render(width);
      if (frame.retired) {
        const retired = frame.retired;
        frame.retired = void 0;
        queueMicrotask(() => retired.dispose());
      }
      return [...lines.slice(0, rows), ...Array(Math.max(0, rows - lines.length)).fill("")];
    }
    const status = frame.error ? ` \u2014 ${frame.error}` : " \u2014 loading\u2026";
    return [truncateToWidth(this.theme.fg("muted", `[${safeText(label)}]${status}`.replace(/[\n\t]/g, " ")), width), ...Array(rows - 1).fill("")];
  }
  frame(title, body, status, width) {
    const border = this.theme.fg("borderMuted", "\u2500".repeat(width));
    return [
      this.theme.fg("accent", truncateToWidth(safeText(title).replace(/[\n\t]/g, " "), width)),
      border,
      ...body.slice(0, this.bodyHeight),
      border,
      truncateToWidth(status.replace(/[\n\t]/g, " "), width)
    ];
  }
  render(width) {
    width = Math.max(1, width);
    if (this.tui.terminal.rows < 6) return [truncateToWidth(this.editor ? "pi-view \xB7 enlarge terminal \xB7 Neovim active \u2014 finish with :q or :wq" : "pi-view \xB7 enlarge terminal \xB7 Esc: close", width)];
    this.requestedImages.clear();
    this.width = Math.max(1, width);
    this.bodyHeight = Math.max(1, this.tui.terminal.rows - 5);
    const used = /* @__PURE__ */ new Set();
    let body = [];
    this.visibleImages = [];
    const document = this.document;
    let title = this.picker ? this.picker.directory : this.path;
    if (this.panel) title = "pi-view";
    if (this.loading) body = ["Loading\u2026"];
    else if (this.editor) {
      this.editor.resize(width, this.bodyHeight);
      const view = this.editor.render(this.focused);
      body = view.rows.map((line) => truncateToWidth(line, width, ""));
      title += ` \xB7 nvim${this.editor.dirty ? " \xB7 modified" : ""}${view.mode && view.mode !== "normal" ? ` \xB7 ${view.mode}` : ""}`;
    } else if (this.picker && !this.panel) {
      const entries = this.filteredEntries();
      const start = Math.max(0, this.picker.selected - this.bodyHeight + 1);
      body = entries.slice(start, start + this.bodyHeight).map((entry, i) => {
        const line = `${start + i === this.picker.selected ? ">" : " "} ${safeText(entry.name).replace(/[\n\t]/g, " ")}${entry.directory ? "/" : ""}`;
        return truncateToWidth(start + i === this.picker.selected ? this.theme.fg("accent", line) : line, width);
      });
      if (!entries.length) body = [truncateToWidth(this.filter ? "No matching files; / changes filter" : "Empty directory; Backspace goes to parent", width)];
      title += this.filter ? ` \xB7 filter: ${this.filter}` : "";
    } else if (this.imageMode()) {
      const target = this.focusImage ?? (document?.kind === "pdf" ? `pdf:${this.page}` : this.path);
      body = this.imageLines(target, width, this.bodyHeight, 0, this.bodyHeight, true, used);
      title += ` \xB7 ${this.actualSize ? "actual" : "fit"} \xD7${this.zoom.toFixed(2)}`;
      if (document?.kind === "pdf") title += ` \xB7 page ${this.page}/${document.pages}`;
    } else {
      const { blocks } = this.getLayout(width);
      this.totalRows = blocks.reduce((sum, block) => sum + (block.kind === "text" ? block.lines.length : block.rows), 0);
      this.offset = Math.max(0, Math.min(Math.max(0, this.totalRows - this.bodyHeight), this.offset));
      const highlighted = /* @__PURE__ */ new Set();
      if (this.query) {
        for (const match of this.searchState().matches) {
          for (let row = match.row; row <= match.endRow; row++) highlighted.add(row);
        }
      }
      let cursor = 0;
      for (const block of blocks) {
        const count = block.kind === "text" ? block.lines.length : block.rows;
        const start = Math.max(0, this.offset - cursor);
        const end = Math.min(count, this.offset + this.bodyHeight - cursor);
        if (end > start) {
          if (block.kind === "image") {
            this.visibleImages.push(block.target);
            body.push(...this.imageLines(block.target, width, count, start, end - start, false, used));
          } else {
            body.push(...block.lines.slice(start, end).map((line, i) => {
              let shown = this.wrap ? truncateToWidth(line, width, "") : sliceByColumn(line, this.horizontal, width);
              if (highlighted.has(cursor + start + i)) shown = this.theme.bg("selectedBg", shown);
              return shown;
            }));
          }
        }
        cursor += count;
        if (cursor >= this.offset + this.bodyHeight) break;
      }
      if (this.totalRows) title += ` \xB7 ${this.offset + 1}/${this.totalRows}${this.source ? " \xB7 source" : ""}`;
      if (this.query && this.matchRow !== void 0) title += ` \xB7 match ${this.matchRow + 1}`;
    }
    for (const [key, frame] of this.frames) if (!used.has(key)) {
      frame.abort.abort();
      frame.component?.dispose();
      frame.retired?.dispose();
      this.frames.delete(key);
    }
    for (const [target, source] of this.images) {
      if (source.promise && !this.requestedImages.has(target)) {
        source.abort?.abort();
        this.images.delete(target);
      }
    }
    body.push(...Array(Math.max(0, this.bodyHeight - body.length)).fill(""));
    if (this.editor) return this.frame(title, body, this.message || ":w save \xB7 :wq/:q return \xB7 :q! discard \xB7 keys go to Neovim", width);
    let status = this.remotePrompt ? "Fetch remote Markdown images? Requests may reveal your IP. y: allow \xB7 any other key: deny" : this.message || (this.imageMode() ? `+/-: zoom \xB7 arrows: pan${document?.kind === "pdf" ? " \xB7 wheel: pages" : ""} \xB7 0: fit \xB7 1: actual \xB7 b: back \xB7 Esc: close` : this.picker && !this.panel ? "\u2191\u2193: choose \xB7 Enter: open \xB7 Backspace: parent \xB7 /: filter \xB7 Esc: close" : `${this.editable() ? "e: edit \xB7 " : ""}\u2191\u2193 wheel: scroll \xB7 /: search \xB7 n/N: matches \xB7 s: source/text \xB7 i: image \xB7 ?: help \xB7 Esc: close`);
    if (this.inputMode) status = `${this.inputMode}: ${this.input.render(Math.max(1, width - this.inputMode.length - 2))[0] ?? ""}`;
    return this.frame(title, body, status, width);
  }
};

// src/quick-open.ts
import { stat as stat3 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { relative, sep as sep2 } from "node:path";
import { Input as Input2, matchesKey as matchesKey2, truncateToWidth as truncateToWidth2 } from "@earendil-works/pi-tui";
var QuickOpen = class {
  constructor(tui, theme, cwd, recent, done) {
    this.tui = tui;
    this.theme = theme;
    this.cwd = cwd;
    this.done = done;
    this.input.onSubmit = () => {
      void this.choose();
    };
    void recent.then((paths) => {
      if (this.closed) return;
      this.recent = paths.slice(0, 20);
      this.loading = false;
      if (!this.input.getValue()) this.refresh();
      else this.tui.requestRender();
    }, (error) => {
      if (this.closed) return;
      this.loading = false;
      this.message = safeText(error.message);
      this.refresh();
    });
  }
  tui;
  theme;
  cwd;
  done;
  input = new Input2();
  recent = [];
  candidates = [];
  selected = 0;
  loading = true;
  message = "";
  closed = false;
  version = 0;
  _focused = false;
  detachMouse;
  get focused() {
    return this._focused;
  }
  set focused(value) {
    this._focused = value;
    this.input.focused = value;
    if (!value) {
      this.detachMouse?.();
      this.detachMouse = void 0;
    } else if (!this.closed && !this.detachMouse) this.detachMouse = attachMouse(this.tui, (delta) => {
      this.selected = Math.max(0, Math.min(this.candidates.length - 1, this.selected + Math.sign(delta)));
      this.tui.requestRender();
    });
  }
  invalidate() {
    this.input.invalidate();
  }
  dispose() {
    this.closed = true;
    this.version++;
    this.detachMouse?.();
    this.detachMouse = void 0;
  }
  displayPath(path3) {
    const local = relative(this.cwd, path3);
    if (local && local !== ".." && !local.startsWith(`..${sep2}`) && !local.startsWith(sep2)) return local;
    const home = homedir2();
    if (path3.startsWith(`${home}${sep2}`)) return `~/${path3.slice(home.length + 1)}`;
    return path3;
  }
  refresh() {
    const value = this.input.getValue();
    this.candidates = value.length === 0 ? this.recent.map((path3) => ({ path: path3, value: serializeValue(path3), directory: false })) : (completePath(value, this.cwd) ?? []).flatMap((item) => {
      try {
        return [{ path: resolvePath(item.value, this.cwd), value: item.value, directory: item.label.endsWith("/") }];
      } catch {
        return [];
      }
    });
    this.selected = value.length ? -1 : this.candidates.length ? 0 : -1;
    this.version++;
    if (!this.closed) this.tui.requestRender();
  }
  setValue(value) {
    this.input.setValue(safeText(value).replace(/[\n\t]/g, " "));
    this.input.handleInput("\x1B[F");
    this.message = "";
    this.refresh();
  }
  async choose() {
    if (this.closed) return;
    const version = ++this.version;
    const candidate = this.selected >= 0 ? this.candidates[this.selected] : void 0;
    const typed = this.input.getValue();
    if (!candidate && !typed) return;
    try {
      const path3 = candidate?.path ?? resolvePath(typed, this.cwd);
      const info = await stat3(path3);
      if (this.closed || version !== this.version) return;
      if (info.isDirectory()) {
        if (candidate?.directory) this.setValue(candidate.value);
        else this.setValue(serializeValue(path3, true));
        return;
      }
      if (!info.isFile()) throw new Error("Choose a regular file");
      this.dispose();
      this.done(path3);
    } catch (error) {
      if (!this.closed && version === this.version) {
        this.message = safeText(error.message);
        this.tui.requestRender();
      }
    }
  }
  handleInput(data) {
    if (this.closed) return;
    if (matchesKey2(data, "escape")) {
      if (this.input.getValue().length) this.setValue("");
      else {
        this.dispose();
        this.done(void 0);
      }
      return;
    }
    if (matchesKey2(data, "ctrl+c")) {
      this.dispose();
      this.done(void 0);
      return;
    }
    if (matchesKey2(data, "up") || matchesKey2(data, "down")) {
      const length = this.candidates.length;
      if (length) {
        this.selected = matchesKey2(data, "down") ? Math.min(length - 1, this.selected + 1) : this.selected < 0 ? length - 1 : Math.max(0, this.selected - 1);
      }
      this.tui.requestRender();
      return;
    }
    if (matchesKey2(data, "tab")) {
      const candidate = this.candidates[this.selected < 0 ? 0 : this.selected];
      if (candidate) this.setValue(candidate.value);
      return;
    }
    if (matchesKey2(data, "enter")) {
      void this.choose();
      return;
    }
    const before = this.input.getValue();
    this.input.handleInput(data);
    const cleaned = safeText(this.input.getValue()).replace(/[\n\t]/g, " ");
    if (cleaned !== this.input.getValue()) this.input.setValue(cleaned);
    if (this.input.getValue() !== before) {
      this.message = "";
      this.refresh();
    } else this.tui.requestRender();
  }
  render(width) {
    width = Math.max(1, width);
    const inner = Math.max(1, width - 4);
    const visible = Math.max(1, Math.min(5, this.tui.terminal.rows - 8));
    const start = Math.max(0, this.selected - visible + 1);
    const text = this.input.getValue();
    const header = text.length ? "Matching paths" : "Recent files in this session";
    const rows = this.candidates.slice(start, start + visible).map((item, index) => {
      const selected = start + index === this.selected;
      const label = `${selected ? ">" : " "} ${safeText(this.displayPath(item.path)).replace(/[\n\t]/g, " ")}${item.directory ? "/" : ""}`;
      return selected ? this.theme.fg("accent", label) : label;
    });
    if (!rows.length) rows.push(this.loading && !text ? "Loading recent files\u2026" : text ? "No suggestions \u2014 Enter opens the typed path" : "No recent files \u2014 type a path to open");
    while (rows.length < visible) rows.push("");
    const footer = this.message || `\u2191\u2193 select \xB7 Tab complete \xB7 Enter open \xB7 Esc ${text ? "clear" : "close"}`;
    const count = this.candidates.length ? ` \xB7 ${this.selected < 0 ? "\u2013" : this.selected + 1}/${this.candidates.length}` : "";
    const lines = [
      this.theme.fg("borderAccent", `\u256D${"\u2500".repeat(Math.max(0, width - 2))}\u256E`),
      this.theme.bold("Quick Open"),
      this.input.render(inner)[0] ?? "",
      this.theme.fg("muted", `${header}${count}`),
      ...rows,
      this.theme.fg(this.message ? "error" : "dim", footer.replace(/[\n\t]/g, " ")),
      this.theme.fg("borderAccent", `\u2570${"\u2500".repeat(Math.max(0, width - 2))}\u256F`)
    ];
    return lines.map((line, index) => this.theme.bg(
      "customMessageBg",
      truncateToWidth2(index === 0 || index === lines.length - 1 ? line : `  ${line}`, width, "", true)
    ));
  }
};

// src/recents.ts
import { lstat, realpath, stat as stat4 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import * as path2 from "node:path";
var MAX_RECENT_FILES = 20;
var MAX_ENTRIES = 2e3;
var MAX_CANDIDATES = 1e3;
var MAX_TEXT_CHARS = 262144;
var MAX_ARG_DEPTH = 2;
var MAX_ARRAY_ITEMS = 64;
var ARG_KEYS = ["path", "file", "filePath", "file_path"];
var VIEW_OPEN_TYPE = "pi-view-open";
var MENTION_RE = /\[[^[\]\n]*\]\(([^()\s]+)\)|`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|([^\s'"`()[\]<>|,;]+)/g;
var TRAILING_PUNCT_RE = /[.,;:!?)\]}>'"]/;
var WIN_DRIVE_RE = /^[A-Za-z]:[\\/]/;
var SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
var EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,11}$/;
function cleanMention(raw) {
  const text = raw.trim();
  let cursor = text.length;
  while (cursor > 0 && TRAILING_PUNCT_RE.test(text[cursor - 1])) cursor--;
  let cut = cursor;
  while (cursor > 0) {
    const end = cursor;
    while (cursor > 0 && text.charCodeAt(cursor - 1) >= 48 && text.charCodeAt(cursor - 1) <= 57) cursor--;
    if (cursor === end) break;
    if (text[cursor - 1] === "L") cursor--;
    const separator = text[cursor - 1];
    if (separator === ":" || separator === "#") cut = --cursor;
    else if (separator === "-") cursor--;
    else break;
  }
  while (cut > 0 && TRAILING_PUNCT_RE.test(text[cut - 1])) cut--;
  return text.slice(0, cut).trim();
}
function scanTextMentions(text, out) {
  if (text.length > MAX_TEXT_CHARS) text = text.slice(-MAX_TEXT_CHARS);
  for (const m2 of text.matchAll(MENTION_RE)) {
    const raw = m2[1] ?? m2[2] ?? m2[3] ?? m2[4] ?? m2[5];
    if (raw === void 0) continue;
    const s = cleanMention(raw);
    if (s === "") continue;
    const bare = m2[5] !== void 0;
    if (bare && (s.startsWith("-") || !/[\\/]/.test(s) && !EXT_RE.test(s))) continue;
    out.push(s);
  }
}
function argMentions(args, depth, out) {
  if (depth > MAX_ARG_DEPTH || typeof args !== "object" || args === null || Array.isArray(args)) return;
  const obj = args;
  for (const key of ARG_KEYS) {
    const v2 = obj[key];
    if (typeof v2 === "string") out.push(v2);
    else if (Array.isArray(v2)) {
      const items = v2.length > MAX_ARRAY_ITEMS ? v2.slice(0, MAX_ARRAY_ITEMS) : v2;
      for (const item of items) {
        if (typeof item === "string") out.push(item);
        else argMentions(item, depth + 1, out);
      }
    } else if (typeof v2 === "object" && v2 !== null) argMentions(v2, depth + 1, out);
  }
}
function pushContentMentions(content, out) {
  if (typeof content === "string") {
    scanTextMentions(content, out);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b2 = block;
    if (b2.type === "toolCall") argMentions(b2.arguments, 0, out);
    else if (typeof b2.text === "string") scanTextMentions(b2.text, out);
  }
}
function entryMentions(entry) {
  if (typeof entry !== "object" || entry === null) return [];
  const e = entry;
  if (e.type === "custom") {
    if (e.customType !== VIEW_OPEN_TYPE) return [];
    const data = e.data;
    const p = typeof data === "object" && data !== null ? data.path : void 0;
    return typeof p === "string" ? [p] : [];
  }
  if (e.type === "compaction" || e.type === "branch_summary") {
    const out2 = [];
    if (typeof e.summary === "string") scanTextMentions(e.summary, out2);
    return out2.reverse();
  }
  if (e.type !== "message") return [];
  const msg = e.message;
  if (typeof msg !== "object" || msg === null) return [];
  const m2 = msg;
  const out = [];
  if (typeof m2.command === "string") scanTextMentions(m2.command, out);
  if (typeof m2.output === "string") scanTextMentions(m2.output, out);
  if (typeof m2.fullOutputPath === "string") out.push(m2.fullOutputPath);
  pushContentMentions(m2.content, out);
  return out.reverse();
}
function toAbsolutePath(raw, cwd) {
  const s = raw;
  if (s === "") return null;
  if (WIN_DRIVE_RE.test(s)) return path2.resolve(s);
  const scheme = SCHEME_RE.exec(s);
  if (scheme) {
    const name = scheme[0].slice(0, -1).toLowerCase();
    if (name === "file") {
      try {
        return fileURLToPath3(s);
      } catch {
        return null;
      }
    }
    if (name.length === 1) return path2.resolve(cwd, s);
    return null;
  }
  const expanded = s === "~" ? homedir3() : s.startsWith("~/") ? path2.join(homedir3(), s.slice(2)) : s;
  return path2.resolve(cwd, expanded);
}
async function recentFiles(entries, cwd) {
  const out = [];
  const seenForms = /* @__PURE__ */ new Map();
  const seenReal = /* @__PURE__ */ new Set();
  let budget = MAX_CANDIDATES;
  const start = Math.max(0, entries.length - MAX_ENTRIES);
  for (let i = entries.length - 1; i >= start; i--) {
    const entry = entries[i];
    const exact = entry?.type === "custom" && entry.customType === VIEW_OPEN_TYPE;
    for (const raw of entryMentions(entry)) {
      const literal = exact || !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw) ? path2.resolve(cwd, raw) : toAbsolutePath(raw, cwd);
      const forms = exact ? [literal] : [literal, toAbsolutePath(cleanMention(raw), cwd)];
      for (const abs of forms) {
        if (abs === null) continue;
        if (seenForms.has(abs)) {
          if (seenForms.get(abs)) break;
          continue;
        }
        if (budget-- <= 0) return out;
        let info;
        try {
          info = await lstat(abs);
        } catch (error) {
          const code = error.code;
          const missing = code === "ENOENT" || code === "ENOTDIR" || code === "ENAMETOOLONG";
          seenForms.set(abs, !missing);
          if (!missing) break;
          continue;
        }
        seenForms.set(abs, true);
        if (info.isSymbolicLink()) {
          try {
            info = await stat4(abs);
          } catch {
            break;
          }
        }
        if (!info.isFile()) break;
        const rp = await realpath(abs).catch(() => null);
        if (rp === null) break;
        if (!seenReal.has(rp)) {
          seenReal.add(rp);
          out.push(abs);
          if (out.length >= MAX_RECENT_FILES) return out;
        }
        break;
      }
    }
  }
  return out;
}

// src/index.ts
var fullscreen = { fullscreen: true };
var overlayClaim = { render: () => [], invalidate: () => {
} };
function closeOwned(tui, handle, done) {
  if (isOmpHost()) {
    done();
    return;
  }
  handle?.hide();
  const claim = tui.showOverlay(overlayClaim, { nonCapturing: true });
  try {
    done();
  } finally {
    claim.hide();
  }
}
function piView(pi) {
  const shortcut = process.env.PI_VIEW_SHORTCUT?.trim().toLowerCase() || (process.platform === "win32" ? "ctrl+p" : "super+p");
  const modifiers = shortcut.split("+");
  const key = modifiers.pop();
  if (modifiers.some((modifier) => !["ctrl", "alt", "shift", "super"].includes(modifier)) || !(/^[a-z0-9]$/.test(key) || Object.values(Key).some((value) => typeof value === "string" && value.toLowerCase() === key))) {
    throw new Error(`Invalid PI_VIEW_SHORTCUT "${safeText(shortcut)}"; use a key such as ctrl+alt+p.`);
  }
  let cwd = process.cwd();
  let quickPending = false;
  let providerInstalled = false;
  let lifetime = 0;
  let detachShortcut;
  let closePreview;
  let closeQuick;
  let activeViewer;
  const completions = (args) => args.startsWith("--") ? ["--help", "--diagnostics"].filter((value) => value.startsWith(args)).map((value) => ({ value, label: value })) : completePath(args, cwd);
  const recordOpen = (path3) => {
    try {
      pi.appendEntry("pi-view-open", { path: path3 });
    } catch {
    }
  };
  async function showPreview(ctx, path3, initial) {
    if (closePreview && !closePreview()) {
      ctx.ui.notify("Neovim session active \u2014 finish with :q or :wq (or :q! to discard), then try again", "warning");
      return;
    }
    let viewer;
    let handle;
    let localClose;
    try {
      await ctx.ui.custom((tui, theme, _keys, done) => {
        let ended = false;
        localClose = (force = false) => {
          if (ended) return true;
          if (!force && viewer && !viewer.requestClose()) return false;
          ended = true;
          viewer?.dispose();
          if (closePreview === localClose) closePreview = void 0;
          closeOwned(tui, handle, done);
          return true;
        };
        viewer = new PreviewViewer(tui, theme, localClose, path3, initial, recordOpen);
        closePreview = localClose;
        activeViewer = viewer;
        return viewer;
      }, {
        overlay: true,
        overlayOptions: { ...fullscreen, width: "100%", maxHeight: "100%", anchor: "top-left", row: 0, col: 0 },
        onHandle: (received) => {
          handle = received;
        }
      });
    } finally {
      viewer?.dispose();
      if (closePreview === localClose) closePreview = void 0;
      if (activeViewer === viewer) activeViewer = void 0;
    }
  }
  async function showQuick(ctx) {
    if (quickPending || !ctx.hasUI) return;
    quickPending = true;
    const requested = lifetime;
    let quick;
    let handle;
    let picked;
    try {
      picked = await ctx.ui.custom((tui, theme, _keys, done) => {
        let ended = false;
        const finish = (path3) => {
          if (ended) return;
          ended = true;
          quick?.dispose();
          closeQuick = void 0;
          closeOwned(tui, handle, () => done(path3));
        };
        closeQuick = () => finish();
        quick = new QuickOpen(tui, theme, ctx.cwd, recentFiles(ctx.sessionManager.getBranch(), ctx.cwd), finish);
        return quick;
      }, {
        overlay: true,
        // Borrow the preview's alternate screen only when one is already open;
        // a standalone picker must leave the normal agent viewport behind it.
        // Nested pickers start below the preview's image-control row.
        overlayOptions: { ...closePreview ? fullscreen : {}, width: "80%", maxHeight: "90%", anchor: "top-center", row: closePreview ? 3 : 2 },
        onHandle: (received) => {
          handle = received;
        }
      });
    } finally {
      quick?.dispose();
      closeQuick = void 0;
      quickPending = false;
    }
    if (picked && lifetime !== requested) picked = void 0;
    if (picked) await showPreview(ctx, picked);
  }
  pi.on("session_start", (_event, ctx) => {
    lifetime++;
    cwd = ctx.cwd;
    closePreview?.(true);
    closeQuick?.();
    detachShortcut?.();
    if (!ctx.hasUI) return;
    detachShortcut = ctx.ui.onTerminalInput((data) => {
      if (!matchesKey3(data, shortcut)) return;
      if (activeViewer?.editing) return;
      if (!isKeyRelease2(data)) void showQuick(ctx).catch((error) => ctx.ui.notify(safeText(error.message), "error"));
      return { consume: true };
    });
    if (!providerInstalled && typeof ctx.ui.addAutocompleteProvider === "function") {
      providerInstalled = true;
      ctx.ui.addAutocompleteProvider((current) => ({
        triggerCharacters: current.triggerCharacters,
        async getSuggestions(lines, row, col, options) {
          const match = /^\/(?:view|v) (.*)$/.exec((lines[row] ?? "").slice(0, col));
          if (match) {
            const items = completions(match[1]);
            return items?.length ? { items, prefix: match[1] } : null;
          }
          return current.getSuggestions(lines, row, col, options);
        },
        applyCompletion: current.applyCompletion.bind(current),
        shouldTriggerFileCompletion: current.shouldTriggerFileCompletion?.bind(current)
      }));
    }
  });
  pi.on("session_shutdown", () => {
    lifetime++;
    detachShortcut?.();
    closeQuick?.();
    closePreview?.(true);
    stopImageWorker();
  });
  for (const name of ["view", "v"]) {
    pi.registerCommand(name, {
      description: "Preview a file or leave blank to trigger Quick Open",
      getArgumentCompletions: completions,
      handler: async (args, ctx) => {
        cwd = ctx.cwd;
        if (!ctx.hasUI) {
          ctx.ui.notify("/view needs an interactive terminal session", "warning");
          return;
        }
        try {
          const option = args.trim();
          if (!option) {
            await showQuick(ctx);
            return;
          }
          const initial = option === "--diagnostics" ? "diagnostics" : option === "--help" ? "help" : void 0;
          await showPreview(ctx, initial ? ctx.cwd : resolvePath(args, ctx.cwd), initial);
        } catch (error) {
          ctx.ui.notify(safeText(error.message), "error");
        }
      }
    });
  }
}
export {
  piView as default
};

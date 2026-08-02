// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
const VERSION_NEEDED = 20;
const UTF8_NAME_FLAG = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const MAX_ENTRIES = 0xffff;
const MAX_OFFSET = 0xffffffff;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function supportsCompression() {
  return typeof CompressionStream === 'function';
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ZIP stores MS-DOS local time: seconds in two-second units, years from 1980.
function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

export async function createZipBlob(entries, now = new Date()) {
  if (!supportsCompression()) throw new Error('This browser cannot create compressed archives.');
  if (entries.length > MAX_ENTRIES) throw new Error(`A ZIP archive cannot hold more than ${MAX_ENTRIES} files.`);

  const { time, date } = dosDateTime(now);
  const encoder = new TextEncoder();
  const parts = [];
  const directory = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const deflated = await deflateRaw(data);
    // Never let an entry grow: incompressible payloads are stored verbatim.
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? METHOD_STORED : METHOD_DEFLATED;
    const crc = crc32(data);

    const header = new DataView(new ArrayBuffer(LOCAL_HEADER_SIZE));
    header.setUint32(0, LOCAL_SIGNATURE, true);
    header.setUint16(4, VERSION_NEEDED, true);
    header.setUint16(6, UTF8_NAME_FLAG, true);
    header.setUint16(8, method, true);
    header.setUint16(10, time, true);
    header.setUint16(12, date, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, body.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);
    header.setUint16(28, 0, true);
    parts.push(new Uint8Array(header.buffer), name, body);

    directory.push({ name, method, crc, compressedSize: body.length, size: data.length, offset });
    offset += LOCAL_HEADER_SIZE + name.length + body.length;
    if (offset > MAX_OFFSET) throw new Error('The archive is too large to write without ZIP64 support.');
  }

  const directoryOffset = offset;
  for (const item of directory) {
    const header = new DataView(new ArrayBuffer(CENTRAL_HEADER_SIZE));
    header.setUint32(0, CENTRAL_SIGNATURE, true);
    header.setUint16(4, VERSION_NEEDED, true);
    header.setUint16(6, VERSION_NEEDED, true);
    header.setUint16(8, UTF8_NAME_FLAG, true);
    header.setUint16(10, item.method, true);
    header.setUint16(12, time, true);
    header.setUint16(14, date, true);
    header.setUint32(16, item.crc, true);
    header.setUint32(20, item.compressedSize, true);
    header.setUint32(24, item.size, true);
    header.setUint16(28, item.name.length, true);
    header.setUint16(30, 0, true);
    header.setUint16(32, 0, true);
    header.setUint16(34, 0, true);
    header.setUint16(36, 0, true);
    header.setUint32(38, 0, true);
    header.setUint32(42, item.offset, true);
    parts.push(new Uint8Array(header.buffer), item.name);
    offset += CENTRAL_HEADER_SIZE + item.name.length;
  }

  const end = new DataView(new ArrayBuffer(END_RECORD_SIZE));
  end.setUint32(0, END_SIGNATURE, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, directory.length, true);
  end.setUint16(10, directory.length, true);
  end.setUint32(12, offset - directoryOffset, true);
  end.setUint32(16, directoryOffset, true);
  end.setUint16(20, 0, true);
  parts.push(new Uint8Array(end.buffer));

  return new Blob(parts, { type: 'application/zip' });
}

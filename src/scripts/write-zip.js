import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { posix, walkFiles } from "./lib.js";

function crc32(buffer) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buffer) >>> 0;
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function u16(value) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

function u32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

export function writeZip(zipPath, files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, abs } of files) {
    const data = fs.readFileSync(abs);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      compressed,
    ]);

    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);

  fs.writeFileSync(zipPath, Buffer.concat([...locals, centralDir, end]));
}

export function collectZipFiles(phpFile, assetsDir) {
  const files = [{ name: posix(path.basename(phpFile)), abs: phpFile }];
  for (const abs of walkFiles(assetsDir)) {
    const rel = posix(path.relative(path.dirname(assetsDir), abs));
    files.push({ name: rel, abs });
  }
  return files;
}

// Tiny vector-style calendar mark. Uses only Node built-ins, including PNG encoding.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const green = [44, 96, 69, 255];
const cream = [248, 248, 241, 255];
const clear = [0, 0, 0, 0];

function colorAt(x, y) {
  const dx = Math.max(18 - x, 0, x - 110);
  const dy = Math.max(18 - y, 0, y - 110);
  if (dx * dx + dy * dy > 196) return clear;
  if (y >= 32 && y <= 35 && x >= 23 && x <= 105) return cream;
  if (y >= 13 && y <= 25 && ((x >= 35 && x <= 40) || (x >= 88 && x <= 93)))
    return cream;
  if (y >= 53 && y <= 101 && x >= 40 && x <= 47) return cream;
  if (y >= 54 && y <= 61 && x >= 33 && x <= 47) return cream;
  if (y >= 96 && y <= 101 && x >= 33 && x <= 54) return cream;
  const outside = ((x - 79) / 17) ** 2 + ((y - 77) / 25) ** 2;
  const inside = ((x - 79) / 10) ** 2 + ((y - 77) / 18) ** 2;
  return outside <= 1 && inside >= 1 ? cream : green;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name, data) {
  const payload = Buffer.concat([Buffer.from(name), data]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([size, payload, crc]);
}

const directory = new URL("../public/icons/", import.meta.url);
mkdirSync(directory, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const channels = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const color = colorAt(
            ((x + (sx + 0.5) / 4) * 128) / size,
            ((y + (sy + 0.5) / 4) * 128) / size,
          );
          color.forEach((value, channel) => {
            channels[channel] += value / 16;
          });
        }
      }
      channels.forEach((value, channel) => {
        pixels[y * (size * 4 + 1) + 1 + x * 4 + channel] = Math.round(value);
      });
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(
    new URL(`${size}.png`, directory),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

// Tiny stack VM for make.fun's tiny-stack-vm-01 bounty: an exact interpreter of
// the kit ISA. Runs every /input/<id>/ instance, writes stdout.bin + exit.txt.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Opcode table: [values popped, values pushed, immediate bytes]. Missing = trap 5.
const T = {
  0x00: [0, 0, 0], 0x01: [0, 1, 1], 0x02: [0, 1, 4], 0x03: [1, 0, 0],
  0x04: [1, 2, 0], 0x05: [2, 2, 0], 0x06: [2, 3, 0], 0x07: [3, 3, 0],
  0x10: [2, 1, 0], 0x11: [2, 1, 0], 0x12: [2, 1, 0], 0x13: [2, 1, 0],
  0x14: [2, 1, 0], 0x15: [2, 1, 0], 0x16: [2, 1, 0], 0x17: [1, 1, 0],
  0x18: [2, 1, 0], 0x19: [2, 1, 0], 0x1a: [2, 1, 0], 0x1b: [1, 1, 0],
  0x1c: [2, 1, 0], 0x1d: [2, 1, 0], 0x1e: [2, 1, 0],
  0x20: [2, 1, 0], 0x21: [2, 1, 0], 0x22: [2, 1, 0],
  0x30: [0, 0, 2], 0x31: [1, 0, 2], 0x32: [1, 0, 2], 0x33: [0, 0, 2], 0x34: [0, 0, 0],
  0x40: [1, 1, 0], 0x41: [2, 0, 0],
  0x50: [1, 0, 0], 0x51: [1, 0, 0], 0x52: [0, 1, 0], 0x53: [1, 0, 0],
};

// Runs one program; returns [output bytes, exit code].
function run(prog, input) {
  const st = []; // data stack (signed 32-bit ints)
  const cs = []; // call stack of return addresses
  const mem = new Int32Array(256);
  const out = [];
  let pc = 0, steps = 0, ip = 0;
  for (;;) {
    if (steps >= 1000000) return [out, 10];
    if (pc < 0 || pc >= prog.length) return [out, 9];
    const op = prog[pc];
    const t = T[op];
    if (!t) return [out, 5];
    const imm = t[2];
    if (pc + 1 + imm > prog.length) return [out, 9];
    if (st.length < t[0]) return [out, 2];
    if (st.length - t[0] + t[1] > 256) return [out, 3];
    const next = pc + 1 + imm;
    let npc = next;
    steps++;
    switch (op) {
      case 0x00: return [out, 0];
      case 0x01: st.push((prog[pc + 1] << 24) >> 24); break;
      case 0x02: st.push(prog.readInt32LE(pc + 1)); break;
      case 0x03: st.pop(); break;
      case 0x04: st.push(st[st.length - 1]); break;
      case 0x05: { const a = st.pop(), b = st.pop(); st.push(a, b); break; }
      case 0x06: st.push(st[st.length - 2]); break;
      case 0x07: { const c = st.pop(), b = st.pop(), a = st.pop(); st.push(b, c, a); break; }
      case 0x10: { const b = st.pop(), a = st.pop(); st.push((a + b) | 0); break; }
      case 0x11: { const b = st.pop(), a = st.pop(); st.push((a - b) | 0); break; }
      case 0x12: { const b = st.pop(), a = st.pop(); st.push(Math.imul(a, b)); break; }
      case 0x13: { const b = st.pop(), a = st.pop(); if (b === 0) return [out, 4]; st.push(Math.trunc(a / b) | 0); break; }
      case 0x14: { const b = st.pop(), a = st.pop(); if (b === 0) return [out, 4]; st.push(a % b); break; }
      case 0x15: { const b = st.pop(), a = st.pop(); if (b === 0) return [out, 4]; st.push(((a >>> 0) / (b >>> 0)) | 0); break; }
      case 0x16: { const b = st.pop(), a = st.pop(); if (b === 0) return [out, 4]; st.push(((a >>> 0) % (b >>> 0)) | 0); break; }
      case 0x17: st.push((-st.pop()) | 0); break;
      case 0x18: { const b = st.pop(), a = st.pop(); st.push(a & b); break; }
      case 0x19: { const b = st.pop(), a = st.pop(); st.push(a | b); break; }
      case 0x1a: { const b = st.pop(), a = st.pop(); st.push(a ^ b); break; }
      case 0x1b: st.push(~st.pop()); break;
      case 0x1c: { const b = st.pop(), a = st.pop(); st.push(a << (b & 31)); break; }
      case 0x1d: { const b = st.pop(), a = st.pop(); st.push(a >> (b & 31)); break; }
      case 0x1e: { const b = st.pop(), a = st.pop(); st.push((a >>> (b & 31)) | 0); break; }
      case 0x20: { const b = st.pop(), a = st.pop(); st.push(a === b ? 1 : 0); break; }
      case 0x21: { const b = st.pop(), a = st.pop(); st.push(a < b ? 1 : 0); break; }
      case 0x22: { const b = st.pop(), a = st.pop(); st.push((a >>> 0) < (b >>> 0) ? 1 : 0); break; }
      case 0x30: npc = next + prog.readInt16LE(pc + 1); break;
      case 0x31: if (st.pop() === 0) npc = next + prog.readInt16LE(pc + 1); break;
      case 0x32: if (st.pop() !== 0) npc = next + prog.readInt16LE(pc + 1); break;
      case 0x33: { if (cs.length >= 64) return [out, 7]; cs.push(next); npc = prog.readUInt16LE(pc + 1); break; }
      case 0x34: { if (cs.length === 0) return [out, 8]; npc = cs.pop(); break; }
      case 0x40: { const a = st.pop(); if (a < 0 || a > 255) return [out, 6]; st.push(mem[a]); break; }
      case 0x41: { const a = st.pop(), v = st.pop(); if (a < 0 || a > 255) return [out, 6]; mem[a] = v; break; }
      case 0x50: { const v = st.pop(), s = String(v); if (out.length + s.length > 65536) return [out, 11]; for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); break; }
      case 0x51: { const v = st.pop(); if (out.length + 1 > 65536) return [out, 11]; out.push(v & 255); break; }
      case 0x52: st.push(ip < input.length ? input[ip++] : -1); break;
      case 0x53: return [out, st.pop() & 255];
    }
    pc = npc;
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  const dir = join(IN_DIR, id);
  if (!statSync(dir).isDirectory()) continue;
  const prog = readFileSync(join(dir, 'program.bin'));
  const input = existsSync(join(dir, 'input.bin')) ? readFileSync(join(dir, 'input.bin')) : Buffer.alloc(0);
  const [out, code] = run(prog, input);
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'stdout.bin'), Buffer.from(out));
  writeFileSync(join(OUT_DIR, id, 'exit.txt'), String(code) + '\n');
}

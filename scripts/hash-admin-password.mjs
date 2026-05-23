#!/usr/bin/env node
// scripts/hash-admin-password.mjs
//
// Generate a bcrypt hash to put in the BUNDLY_ADMIN_PASSWORD_HASH env var.
// Usage:
//   node scripts/hash-admin-password.mjs "your-strong-password-here"
// Or via npm:
//   npm run hash-admin-password -- "your-strong-password-here"
//
// Output: the bcrypt hash on stdout (one line). Copy it into your .env as
// BUNDLY_ADMIN_PASSWORD_HASH=<the hash>. The hash starts with $2a$ or $2b$.
//
// Notes:
//   - The plaintext is read from argv[2]. We deliberately do NOT support
//     reading from stdin or a prompt, simpler and easier to script.
//   - Cost factor is 12 (a common sweet spot for an admin login, ~200ms
//     per compare on a modern CPU).
//   - Run this offline. The plaintext will appear in your shell history;
//     clear it (`history -d <n>` on bash, `Clear-History` on PowerShell)
//     after you copy the hash.

import bcrypt from "bcryptjs";

const pw = process.argv[2];
if (!pw) {
  console.error("Usage: node scripts/hash-admin-password.mjs <password>");
  process.exit(2);
}
if (pw.length < 12) {
  console.error("Password must be at least 12 characters long.");
  process.exit(2);
}

const COST = 12;
const hash = await bcrypt.hash(pw, COST);
process.stdout.write(hash + "\n");

// Next's standalone output leaves static assets out on purpose; put them next to server.js.
import { cpSync } from "fs";
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
cpSync("public", ".next/standalone/public", { recursive: true });

import crypto from "node:crypto";

const key = crypto.randomBytes(32).toString("hex");
console.log("Generated MASTER_KEY (put this in your .env):\n");
console.log(`MASTER_KEY=${key}`);

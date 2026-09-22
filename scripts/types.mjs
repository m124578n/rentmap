// 產 worker-configuration.d.ts。wrangler types 會把 .dev.vars / .env 的機密也當成必填的 string 寫進 Env,
// 每台機器不同、又跟 src/worker/env.ts 的 optional 宣告衝突,所以產型別時先把這兩個檔移開。
import { execSync } from "node:child_process";
import fs from "node:fs";
const files = [".dev.vars", ".env"].filter((f) => fs.existsSync(f));
for (const f of files) fs.renameSync(f, f + ".__types_tmp");
try {
  execSync("npx wrangler types --include-runtime=false", { stdio: "inherit" });
} finally {
  for (const f of files) fs.renameSync(f + ".__types_tmp", f);
}

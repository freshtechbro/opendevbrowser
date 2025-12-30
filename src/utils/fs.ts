import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export function writeFileAtomic(
  filePath: string,
  content: string,
  options: { encoding?: BufferEncoding; mode?: number } = {}
): void {
  const { encoding = "utf-8", mode } = options;
  const dir = path.dirname(filePath);
  const hash = crypto.randomBytes(8).toString("hex");
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${hash}.tmp`);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const writeOptions: fs.WriteFileOptions = { encoding };
    if (mode !== undefined) {
      writeOptions.mode = mode;
    }
    fs.writeFileSync(tempPath, content, writeOptions);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      /* best-effort cleanup */
    }
    throw error;
  }
}

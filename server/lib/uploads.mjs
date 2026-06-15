import fs from "node:fs";
import path from "node:path";
import { contentType } from "./httpUtils.mjs";

export class UploadService {
  constructor(uploadDir) {
    this.uploadDir = path.resolve(uploadDir);
  }

  save(body) {
    const name = path.basename(String(body.name || "upload.bin")).replace(/[^\w.\-()\u4e00-\u9fff ]/g, "_");
    const mime = String(body.type || "application/octet-stream");
    const dataUrl = String(body.dataUrl || "");
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error("Invalid upload payload");
    }

    const buffer = Buffer.from(match[2], "base64");
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const dir = path.join(this.uploadDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, buffer);
    return this.toPublicAttachment({
      id,
      filePath,
      mime,
      size: buffer.length,
      kind: mime.startsWith("image/") ? "image" : "file"
    });
  }

  resolve(attachment) {
    const filePath = path.resolve(String(attachment.path || ""));
    if (!this.isUploadPath(filePath) || !fs.existsSync(filePath)) {
      return null;
    }
    return this.toPublicAttachment({
      id: String(attachment.id || ""),
      filePath,
      mime: String(attachment.mime || "application/octet-stream"),
      size: Number(attachment.size || 0),
      kind: String(attachment.kind || "").startsWith("image") ? "image" : "file"
    });
  }

  resolveMany(attachments) {
    return Array.isArray(attachments) ? attachments.map((item) => this.resolve(item)).filter(Boolean) : [];
  }

  serveDownload(res, filePath, allowedRoots) {
    const resolved = path.resolve(filePath || "");
    const roots = [this.uploadDir, ...allowedRoots.map((root) => path.resolve(root))];
    if (!roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": contentType(resolved),
      "content-disposition": `inline; filename="${encodeURIComponent(path.basename(resolved))}"`
    });
    fs.createReadStream(resolved).pipe(res);
  }

  toPublicAttachment({ id, filePath, mime, size, kind }) {
    return {
      id,
      name: path.basename(filePath),
      mime,
      size,
      kind,
      path: filePath,
      url: `/api/files?path=${encodeURIComponent(filePath)}`
    };
  }

  isUploadPath(filePath) {
    return filePath === this.uploadDir || filePath.startsWith(`${this.uploadDir}${path.sep}`);
  }
}

export function buildMessageText(text, attachments) {
  if (attachments.length === 0) {
    return text;
  }
  const lines = [text || "请查看我上传的附件。", "", "附件："];
  for (const attachment of attachments) {
    lines.push(`- ${attachment.name}: ${attachment.path}`);
  }
  return lines.join("\n");
}

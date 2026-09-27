"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 8000);

const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".xml": "application/xml; charset=utf-8"
};

function sendText(response, statusCode, message) {
    response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(message);
}

function resolveRequestPath(requestUrl) {
    const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
    const relativePath = `.${pathname}`;
    const resolvedPath = path.resolve(root, relativePath);
    const relativeToRoot = path.relative(root, resolvedPath);

    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        return null;
    }

    return resolvedPath;
}

const server = http.createServer((request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) {
        sendText(response, 405, "Method not allowed");
        return;
    }

    let filePath = resolveRequestPath(request.url);
    if (!filePath) {
        sendText(response, 403, "Forbidden");
        return;
    }

    fs.stat(filePath, (statError, stats) => {
        if (!statError && stats.isDirectory()) {
            filePath = path.join(filePath, "index.html");
        }

        fs.readFile(filePath, (readError, data) => {
            if (readError) {
                sendText(response, 404, "Not found");
                return;
            }

            const extension = path.extname(filePath).toLowerCase();
            response.writeHead(200, {
                "Content-Type": contentTypes[extension] || "application/octet-stream",
                "Cache-Control": "no-store"
            });

            response.end(request.method === "HEAD" ? undefined : data);
        });
    });
});

server.listen(port, "127.0.0.1", () => {
    console.log(`Marat Hudvagen: http://127.0.0.1:${port}`);
});

server.on("error", (error) => {
    console.error(`Не удалось запустить локальный сервер: ${error.message}`);
    process.exitCode = 1;
});

import { serve } from "https://deno.land/std/http/server.ts";
import { serveDir } from "https://deno.land/std/http/file_server.ts";

const port = 5000;

console.log(`HTTP webserver running at http://localhost:${port}`);

await serve((req) => {
  const url = new URL(req.url);
  // Add .html extension if no extension is provided
  if (!url.pathname.includes('.') && url.pathname !== '/') {
    url.pathname = `${url.pathname}.html`;
    req = new Request(url, req);
  }
  
  return serveDir(req, {
    fsRoot: "public",
    urlRoot: "",
    showDirListing: true,
    enableCors: true,
  });
}, { port });
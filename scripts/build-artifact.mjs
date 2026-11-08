// Builds dist/floorplan-walkthrough.html: the whole app as one page for a Claude
// artifact (claude.ai only allows scripts inline or from a few CDNs).
//   node scripts/build-artifact.mjs
// Local modules are wrapped in their own scope and wired together; three.js is
// imported from jsDelivr instead of ./vendor.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (f) => readFileSync(root + f, "utf8");
const THREE_VERSION = "0.160.0";
const cdn = (spec) => spec === "three"
  ? `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/+esm`
  : `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/${spec.replace("three/addons/", "")}/+esm`;

const ORDER = ["layout.js", "realistic.js", "chat.js", "app.js"]; // dependencies first
const external = new Map(); // import line -> true
const IMPORT = /import\s+([\s\S]*?)\s+from\s+"([^"]+)";\n?/g;

const modules = ORDER.map((file) => {
  let src = read(file);
  const wires = [];
  src = src.replace(IMPORT, (_, what, from) => {
    if (from.startsWith("./")) {
      wires.push(`const ${what.replace(/\s+as\s+/g, ": ")} = __mod[${JSON.stringify(from.slice(2))}];`);
    } else {
      external.set(`import ${what} from "${cdn(from)}";`, true);
    }
    return "";
  });
  const exported = [...src.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  src = src.replace(/^export\s+(?=(async\s+)?(const|let|function|class)\b)/gm, "");
  return `// ---- ${file} ----\n__mod[${JSON.stringify(file)}] = (() => {\n${wires.join("\n")}\n${src}\nreturn { ${exported.join(", ")} };\n})();`;
});

const html = read("index.html");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("<script type=\"module\""));
const title = html.match(/<title>(.*?)<\/title>/)[1];
const out = `<title>${title}</title>
<style>
${read("style.css")}
</style>
${body.trim()}
<script type="module">
${[...external.keys()].join("\n")}
const __mod = {};
${modules.join("\n\n")}
</script>
`;
mkdirSync(root + "dist", { recursive: true });
writeFileSync(root + "dist/floorplan-walkthrough.html", out);
console.log(`dist/floorplan-walkthrough.html: ${(out.length / 1024).toFixed(0)} KB, ${external.size} CDN imports`);

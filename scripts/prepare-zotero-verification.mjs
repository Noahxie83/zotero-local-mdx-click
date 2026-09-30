// Creates a fresh isolated profile. Does not launch Zotero or touch its normal profile.
import { zipSync } from 'fflate';
import { mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2]) throw new Error('Pass an explicit fresh verification directory.');
const base = path.resolve(process.argv[2]), profile = path.join(base, 'profile'), data = path.join(base, 'data');
try { await access(path.join(data, 'zotero.sqlite')); throw new Error('Use a fresh verification directory; a library already exists here.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(path.join(profile, 'extensions'), { recursive: true }); await mkdir(data, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(root, 'addon/manifest.json'), 'utf8'));
const config = { version: manifest.version, dataPath: data, pdfPath: path.join(base, 'sample.pdf'), reportPath: path.join(base, 'report.json') };
const files = {};
async function walk(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), name + '/');
    else files[name] = new Uint8Array(await readFile(path.join(dir, entry.name)));
  }
}
await walk(path.join(root, 'addon'));
const bootstrap = new TextDecoder().decode(files['bootstrap.js']).replace('await Zotero.LocalMDXClick.start();',
  'await Zotero.LocalMDXClick.start();\n  Services.scriptloader.loadSubScript(rootURI + "integration.js", pluginScope);\n  pluginScope.runZoteroVerification(' + JSON.stringify(config) + ');');
files['bootstrap.js'] = new TextEncoder().encode(bootstrap);
files['integration.js'] = new Uint8Array(await readFile(path.join(root, 'tests/zotero-integration.js')));
await writeFile(path.join(profile, 'extensions', manifest.applications.zotero.id + '.xpi'), zipSync(files));
const prefs = {
  'extensions.zotero.dataDir': data, 'extensions.zotero.useDataDir': true,
  'extensions.zotero.firstRun2': false, 'extensions.zotero.firstRunGuidance': false,
  'extensions.zotero.automaticScraperUpdates': false,
  'extensions.zoteroWinWordIntegration.skipInstallation': true, 'extensions.zoteroOpenOfficeIntegration.skipInstallation': true,
  'extensions.autoDisableScopes': 0, 'extensions.enabledScopes': 15, 'extensions.startupScanScopes': 15,
  'toolkit.telemetry.enabled': false, 'datareporting.healthreport.uploadEnabled': false,
};
await writeFile(path.join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
const text = 'BT /F1 20 Tf 72 720 Td (research sample) Tj ET';
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
let pdf = '%PDF-1.4\n', offsets = [0];
for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
pdf += offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile(config.pdfPath, pdf); console.log(JSON.stringify({ profile, ...config }));

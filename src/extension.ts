// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import mammoth from 'mammoth';
import jszip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

function ReplaceFlags(s: string){
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
};

async function LoadImages(zip: jszip): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) {
      continue;
    }
    const mime = MIME[path.split('.').pop()!.toLowerCase()];
    if (!mime) {
      continue;
    }
    map.set(path, `data:${mime};base64,${await file.async('base64')}`);
  }
  return map;
}

function RenderNodes(nodes: any[], images: Map<string, string>): string {
  return nodes.map(n => {
    if ('#text' in n) {
      return ReplaceFlags(String(n['#text']));
    }
    const tag = Object.keys(n).find(k => k !== ':@')!;
    const attrs = n[':@'] ?? {};
    const inner = RenderNodes(n[tag], images);
    switch (tag) {
      case 'text:h': return `<h2>${inner}</h2>`;
      case 'text:p': return `<p>${inner}</p>`;
      case 'text:s': return ' ';
      case 'text:tab': return '&emsp;';
      case 'text:line-break': return '<br>';
      case 'text:list': return `<ul>${inner}</ul>`;
      case 'text:list-item': return `<li>${inner}</li>`;
      case 'table:table': return `<table>${inner}</table>`;
      case 'table:table-row': return `<tr>${inner}</tr>`;
      case 'table:table-cell': return `<td>${inner}</td>`;
      case 'draw:frame': {
        const w = attrs['@_svg:width'];
        const style = w ? `display:inline-block;width:${ReplaceFlags(String(w))};max-width:100%` : 'display:inline-block;max-width:100%';
        return `<span style="${style}">${inner}</span>`;
      }
      case 'draw:image': {
        const href = String(attrs['@_xlink:href'] ?? '').replace(/^\.\//, '');
        const src = images.get(href);
        return src
          ? `<img src="${src}" style="width:100%;height:auto" alt="">`
          : `<em>[изображение: ${ReplaceFlags(href)}]</em>`;
      }
      case 'svg:title':
      case 'svg:desc':
      case 'office:annotation':
        return '';
      default: return inner;
    }
  }).join('');
}

function FindNode(nodes: any[], name: string): any[] | undefined {
  for (const n of nodes) {
    const tag = Object.keys(n).find(k => k !== ':@');
    if (!tag) {
      continue;
    }
    if (tag === name) {
      return n[tag];
    }
    const r = Array.isArray(n[tag]) ? FindNode(n[tag], name) : undefined;
    if (r) {
      return r;
    }
  }
}

async function OdtToHTML(data: Uint8Array): Promise<string>{
	const zip = await jszip.loadAsync(data);
	const xml = await zip.file('content.xml')!.async('string');

	const parsed = new XMLParser({
		preserveOrder: true,
		trimValues: false,
		ignoreAttributes: false, // нужно, чтобы читать xlink:href и svg:width
	}).parse(xml);
	const images = await LoadImages(zip);
	const body = FindNode(parsed, 'office:text') ?? parsed;
	return RenderNodes(body, images);
}

function Wrap(body: string): string { // make a ready HTML out of document body
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
<style>
  body { max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6;
         font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); }
  table { border-collapse: collapse; }
  td, th { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; }
  img { max-width: 100%; }
</style></head><body>${body}</body></html>`;
}

class DocProvider implements vscode.CustomReadonlyEditorProvider {
	openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): vscode.CustomDocument | Thenable<vscode.CustomDocument> {
		return {uri, dispose() {},};
	}
	async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel){
		
    webviewPanel.webview.options = { enableScripts: false };
		try {
      const data = await vscode.workspace.fs.readFile(document.uri);
      const html = document.uri.path.toLowerCase().endsWith('.odt')
      ? await OdtToHTML(data)
      : (await mammoth.convertToHtml({ buffer: Buffer.from(data) })).value;
      webviewPanel.webview.html = Wrap(html);
		} 
    catch (e) {
		  webviewPanel.webview.html = Wrap(`<p>Не удалось открыть файл: ${ReplaceFlags(String(e))}</p>`);
		}
  	}
} 

export function activate(context: vscode.ExtensionContext) {

	const disposable = vscode.window.registerCustomEditorProvider('docReader', new DocProvider(), {
      supportsMultipleEditorsPerDocument: true,
    });
	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

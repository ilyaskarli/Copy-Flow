import * as vscode from 'vscode'
import * as path from 'path'

let debounceTimer: NodeJS.Timeout | undefined
let lastButtonRange: vscode.Range | undefined
let isIgnoringSelectionChange = false

// Şık buton dekorasyon tasarımı
const copyButtonDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    contentText: ' 📋 Copy ',
    backgroundColor: '#007ACC',
    color: '#FFFFFF',
    margin: '0 0 0 10px',
    fontWeight: 'bold',
    textDecoration: 'none; padding: 2px 6px; border: 1px solid #005A9E; border-radius: 3px; cursor: pointer;'
  }
})

function toFilePath(doc: vscode.TextDocument, useAbsolutePath: boolean): string {
  const filePath = doc.uri.fsPath
  const folders = vscode.workspace.workspaceFolders || []

  if (useAbsolutePath) {
    return filePath
  }

  for (const f of folders) {
    const root = f.uri.fsPath
    if (filePath === root || filePath.startsWith(root + path.sep)) {
      const rel = path.relative(root, filePath)
      return rel.split(path.sep).join('/')
    }
  }
  return path.basename(filePath)
}

function formatLineRange(start: number, end: number, format: string): string {
  const lineInfo = format
    .replace('${start}', String(start))
    .replace('${end}', String(end))
    .replace('${line}', String(start))
  return lineInfo
}

function formatSelection(sel: vscode.Selection, useAbsolutePath: boolean, outputFormat: string): string {
  const editor = vscode.window.activeTextEditor
  if (!editor) return ''

  const doc = editor.document
  const filePath = toFilePath(doc, useAbsolutePath)
  const start = sel.start.line + 1
  const end = sel.end.line + 1

  const config = vscode.workspace.getConfiguration('copy-flow')
  const singleLineFormat = config.get('singleLineFormat', 'line ${line}')
  const multiLineFormat = config.get('multiLineFormat', 'line ${start}-${end}')

  const lineRangeText = sel.isEmpty || start === end
    ? formatLineRange(start, start, singleLineFormat)
    : formatLineRange(start, end, multiLineFormat)

  switch (outputFormat) {
    case 'labeled':
      return `File: ${filePath} (${lineRangeText})`
    case 'compact':
      return `${filePath}:${start}${start !== end ? '-' + end : ''}`
    case 'code-style':
      return `${filePath}:${start}${start !== end ? ':' + end : ''}`
    case 'natural':
      const rangeText = start === end ? `line ${start}` : `lines ${start}-${end}`
      return `at ${filePath}, ${rangeText}`
    default:
      return `File: ${filePath} (${lineRangeText})`
  }
}

async function copySelection(editor: vscode.TextEditor): Promise<void> {
  const config = vscode.workspace.getConfiguration('copy-flow')
  const outputFormat = config.get('outputFormat', 'labeled')
  const useAbsolutePath = config.get('useAbsolutePath', false)
  const showStatusMessage = config.get('showStatusMessage', true)

  const sels = editor.selections && editor.selections.length ? editor.selections : [editor.selection]
  const parts = sels.map(s => formatSelection(s, useAbsolutePath, outputFormat))
  const text = parts.join('\n')

  await vscode.env.clipboard.writeText(text)

  // Kopyalama yapıldığında butonu hemen temizle
  editor.setDecorations(copyButtonDecorationType, [])
  lastButtonRange = undefined

  if (showStatusMessage) {
    vscode.window.setStatusBarMessage(`Copied: ${text}`, 2000)
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Manuel kopyalama komutu
  const disposable = vscode.commands.registerCommand('copy-flow.copySelectionReference', async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    await copySelection(editor)
  })
  context.subscriptions.push(disposable)

  // Seçim değiştiğinde buton gösterme ve buton tıklamasını dinleme mantığı
  const onSelectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection(async (event) => {
    if (isIgnoringSelectionChange) return

    const editor = event.textEditor
    const selections = event.selections

    // 1. Tıklama Algılama: Sadece fare tıklamasıysa, seçim boşsa (tek imleç varsa) ve aktif buton varsa
    if (event.kind === vscode.TextEditorSelectionChangeKind.Mouse &&
        selections.length === 1 &&
        selections[0].isEmpty &&
        lastButtonRange) {
      const clickPos = selections[0].active
      // Tıklanan konum butonun olduğu konuma çok yakınsa (aynı satırda ve buton koordinatında)
      if (clickPos.line === lastButtonRange.end.line && 
          Math.abs(clickPos.character - lastButtonRange.end.character) <= 1) {
        
        isIgnoringSelectionChange = true
        await copySelection(editor)
        isIgnoringSelectionChange = false
        return
      }
    }

    // 2. Buton Gösterme: Gerçek bir seçim varsa (seçili metin varsa)
    const activeSelection = selections.find(s => !s.isEmpty)
    if (activeSelection) {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }

      debounceTimer = setTimeout(() => {
        // Butonu seçilen alanın en sonuna yerleştir
        const targetRange = new vscode.Range(activeSelection.end, activeSelection.end)
        editor.setDecorations(copyButtonDecorationType, [targetRange])
        lastButtonRange = targetRange
      }, 300) // Debounce 300ms
    } else {
      // Seçim yoksa ve butona tıklanmadıysa butonu kaldır
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      editor.setDecorations(copyButtonDecorationType, [])
      lastButtonRange = undefined
    }
  })
  context.subscriptions.push(onSelectionChangeDisposable)
}

export function deactivate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
}

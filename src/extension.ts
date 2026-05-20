import * as vscode from 'vscode'
import * as path from 'path'

let debounceTimer: NodeJS.Timeout | undefined

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

  if (showStatusMessage) {
    vscode.window.setStatusBarMessage(`Copied: ${text}`, 2000)
  }
}

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('copy-flow.copySelectionReference', async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    await copySelection(editor)
  })
  context.subscriptions.push(disposable)

  const onSelectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection((event) => {
    const config = vscode.workspace.getConfiguration('copy-flow')
    const autoCopy = config.get('autoCopyOnSelectionChange', false)
    if (!autoCopy) return

    // Eğer seçim boşsa (sadece imleç hareket ediyorsa ve seçili metin yoksa) kopyalama yapma
    const hasSelection = event.selections.some(sel => !sel.isEmpty)
    if (!hasSelection) return

    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(async () => {
      await copySelection(event.textEditor)
    }, 300)
  })
  context.subscriptions.push(onSelectionChangeDisposable)
}

export function deactivate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
}

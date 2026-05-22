import * as vscode from 'vscode'
import * as path from 'path'

let lastActiveSelection: vscode.Selection | undefined
let isIgnoringSelectionChange = false

// CodeLens Sağlayıcı Sınıfı
class CopyFlowCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>()
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event

  public refresh() {
    this._onDidChangeCodeLenses.fire()
  }

  provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document !== document) return []

    const selection = editor.selection
    if (selection && !selection.isEmpty) {
      const range = new vscode.Range(selection.start, selection.start)
      return [
        new vscode.CodeLens(range, {
          title: "📋 Copy Reference",
          command: "copy-flow.copySelectionReference"
        }),
        new vscode.CodeLens(range, {
          title: "📸 Copy Snapshot",
          command: "copy-flow.copySelectionSnapshot"
        })
      ]
    }
    return []
  }
}

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

async function copySelectionDirect(editor: vscode.TextEditor, sel: vscode.Selection, mode: 'reference' | 'snapshot'): Promise<void> {
  const doc = editor.document
  const useAbsolutePath = vscode.workspace.getConfiguration('copy-flow').get('useAbsolutePath', false)
  const showStatusMessage = vscode.workspace.getConfiguration('copy-flow').get('showStatusMessage', true)

  const filePath = toFilePath(doc, useAbsolutePath)
  const basename = path.basename(doc.uri.fsPath)
  const start = sel.start.line + 1
  const end = sel.end.line + 1
  const rangeText = start === end ? `line ${start}` : `line ${start}-${end}`

  // Kullanıcı formatı: [chat_view.dart](lib/views/chats/chat_view.dart) line 706-716
  const reference = `[${basename}](${filePath}) ${rangeText}`
  let textToCopy = reference

  if (mode === 'snapshot') {
    const code = doc.getText(sel)
    if (code.trim()) {
      textToCopy = `${reference}\n\`\`\`${doc.languageId}\n${code}\n\`\`\``
    }
  }

  await vscode.env.clipboard.writeText(textToCopy)

  // Seçimi sıfırla (Böylece CodeLens de hemen temizlenir)
  isIgnoringSelectionChange = true
  editor.selection = new vscode.Selection(editor.selection.active, editor.selection.active)
  lastActiveSelection = undefined
  isIgnoringSelectionChange = false

  if (showStatusMessage) {
    const modeName = mode === 'snapshot' ? 'Snapshot' : 'Reference'
    vscode.window.setStatusBarMessage(`Copied ${modeName}: ${basename} ${rangeText}`, 2000)
  }
}

export function activate(context: vscode.ExtensionContext) {
  const codeLensProvider = new CopyFlowCodeLensProvider()

  const handleCopyCommand = async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    
    if (editor.selection && !editor.selection.isEmpty) {
      await copySelectionDirect(editor, editor.selection, 'reference')
    } else if (lastActiveSelection) {
      await copySelectionDirect(editor, lastActiveSelection, 'reference')
    } else {
      await copySelectionDirect(editor, new vscode.Selection(editor.selection.active, editor.selection.active), 'reference')
    }
    codeLensProvider.refresh()
  }

  const handleSnapshotCommand = async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    
    if (editor.selection && !editor.selection.isEmpty) {
      await copySelectionDirect(editor, editor.selection, 'snapshot')
    } else if (lastActiveSelection) {
      await copySelectionDirect(editor, lastActiveSelection, 'snapshot')
    } else {
      await copySelectionDirect(editor, new vscode.Selection(editor.selection.active, editor.selection.active), 'snapshot')
    }
    codeLensProvider.refresh()
  }

  // Manuel kopyalama komutu (Alt + C - Yeni Komut ID'si)
  const disposable1 = vscode.commands.registerCommand('copy-flow.copySelectionReference', handleCopyCommand)
  context.subscriptions.push(disposable1)

  // Manuel kopyalama komutu (Alt + C - Eski Komut ID'si - Kullanıcı ayarlarındaki eski keybinding'ler için fallback)
  const disposable2 = vscode.commands.registerCommand('copy-line.copySelectionReference', handleCopyCommand)
  context.subscriptions.push(disposable2)

  // Snapshot komutu (Alt + S)
  const disposableSnapshot = vscode.commands.registerCommand('copy-flow.copySelectionSnapshot', handleSnapshotCommand)
  context.subscriptions.push(disposableSnapshot)

  // CodeLens Sağlayıcı Tescili
  const codeLensDisposable = vscode.languages.registerCodeLensProvider({ pattern: '**' }, codeLensProvider)
  context.subscriptions.push(codeLensDisposable)

  // Seçim değiştiğinde CodeLens tazeleme
  const onSelectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (isIgnoringSelectionChange) return

    const editor = event.textEditor
    const selections = event.selections
    const activeSelection = selections.find(s => !s.isEmpty)

    if (activeSelection) {
      lastActiveSelection = activeSelection
    } else {
      lastActiveSelection = undefined
    }

    codeLensProvider.refresh()
  })
  context.subscriptions.push(onSelectionChangeDisposable)
}

export function deactivate() {}

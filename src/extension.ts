import * as vscode from 'vscode'
import * as path from 'path'

let debounceTimer: NodeJS.Timeout | undefined
let lastButtonRange: vscode.Range | undefined
let isIgnoringSelectionChange = false

// Tema rengi ile tam uyumlu buton tasarımı (emoji kaldırıldı, sadece Copy)
const copyButtonDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    contentText: ' Copy ',
    backgroundColor: new vscode.ThemeColor('button.background'),
    color: new vscode.ThemeColor('button.foreground'),
    margin: '0 0 0 10px',
    fontWeight: 'bold',
    textDecoration: 'none; padding: 2px 6px; border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 3px; cursor: pointer;'
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

async function copySelectionWithOptions(editor: vscode.TextEditor): Promise<void> {
  const doc = editor.document
  const useAbsolutePath = vscode.workspace.getConfiguration('copy-flow').get('useAbsolutePath', false)
  const showStatusMessage = vscode.workspace.getConfiguration('copy-flow').get('showStatusMessage', true)

  const selections = editor.selections && editor.selections.length ? editor.selections : [editor.selection]
  const activeSelections = selections.filter(s => !s.isEmpty)
  const targets = activeSelections.length > 0 ? activeSelections : selections

  if (targets.length === 0) return

  // Kullanıcı formatı: [chat_view.dart](lib/views/chats/chat_view.dart) line 706-716
  const referenceParts = targets.map(sel => {
    const filePath = toFilePath(doc, useAbsolutePath)
    const basename = path.basename(doc.uri.fsPath)
    const start = sel.start.line + 1
    const end = sel.end.line + 1
    const rangeText = start === end ? `line ${start}` : `line ${start}-${end}`
    return {
      reference: `[${basename}](${filePath}) ${rangeText}`,
      code: doc.getText(sel)
    }
  })

  const sampleReference = referenceParts[0].reference

  // Seçenek paneli (Quick Pick)
  const items = [
    {
      label: 'Copy Reference Link',
      detail: sampleReference,
      action: 'reference'
    },
    {
      label: 'Copy Code Snapshot with Reference',
      detail: `${sampleReference} + Code Block`,
      action: 'snapshot'
    }
  ]

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select Copy Option'
  })

  if (!selected) return

  let textToCopy = ''
  if (selected.action === 'reference') {
    textToCopy = referenceParts.map(p => p.reference).join('\n')
  } else {
    textToCopy = referenceParts.map(p => {
      if (!p.code.trim()) {
        return p.reference
      }
      return `${p.reference}\n\`\`\`${doc.languageId}\n${p.code}\n\`\`\``
    }).join('\n\n')
  }

  await vscode.env.clipboard.writeText(textToCopy)

  // Kopyalama yapıldığında butonu hemen temizle
  editor.setDecorations(copyButtonDecorationType, [])
  lastButtonRange = undefined

  if (showStatusMessage) {
    vscode.window.setStatusBarMessage(`Copied to Clipboard!`, 2000)
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Manuel kopyalama komutu
  const disposable = vscode.commands.registerCommand('copy-flow.copySelectionReference', async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    await copySelectionWithOptions(editor)
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
        await copySelectionWithOptions(editor)
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

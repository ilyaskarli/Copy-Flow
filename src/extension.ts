import * as vscode from 'vscode'
import * as path from 'path'

let debounceTimer: NodeJS.Timeout | undefined
let lastCopyButtonRange: vscode.Range | undefined
let lastSnapshotButtonRange: vscode.Range | undefined
let lastActiveSelection: vscode.Selection | undefined
let isIgnoringSelectionChange = false

// Tema uyumlu, siyah renkli, mutlak konumlandırılmış (kod düzenini bozmayan) 'Copy' butonu
const copyButtonDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    contentText: 'Copy',
    backgroundColor: '#000000',
    color: '#FFFFFF',
    fontWeight: 'bold',
    textDecoration: 'none; padding: 2px 6px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; position: absolute; z-index: 100; margin-left: 10px;'
  }
})

// Tema uyumlu, siyah renkli, mutlak konumlandırılmış 'Snapshot' butonu (bir alt satırda durur)
const snapshotButtonDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    contentText: 'Snapshot',
    backgroundColor: '#000000',
    color: '#FFFFFF',
    fontWeight: 'bold',
    textDecoration: 'none; padding: 2px 6px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; position: absolute; z-index: 100; margin-left: 10px;'
  }
})

// Son satırda aynı satıra yan yana konumlandırmak için 'Snapshot' butonu
const snapshotButtonSameLineDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    contentText: 'Snapshot',
    backgroundColor: '#000000',
    color: '#FFFFFF',
    fontWeight: 'bold',
    textDecoration: 'none; padding: 2px 6px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; position: absolute; z-index: 100; margin-left: 70px;'
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

  // Kopyalama yapıldığında butonları hemen temizle
  editor.setDecorations(copyButtonDecorationType, [])
  editor.setDecorations(snapshotButtonDecorationType, [])
  editor.setDecorations(snapshotButtonSameLineDecorationType, [])
  lastCopyButtonRange = undefined
  lastSnapshotButtonRange = undefined
  lastActiveSelection = undefined

  if (showStatusMessage) {
    const modeName = mode === 'snapshot' ? 'Snapshot' : 'Reference'
    vscode.window.setStatusBarMessage(`Copied ${modeName}: ${basename} ${rangeText}`, 2000)
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Manuel kopyalama komutu (Alt + C)
  const disposable = vscode.commands.registerCommand('copy-flow.copySelectionReference', async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    
    if (editor.selection && !editor.selection.isEmpty) {
      await copySelectionDirect(editor, editor.selection, 'reference')
    } else if (lastActiveSelection) {
      await copySelectionDirect(editor, lastActiveSelection, 'reference')
    } else {
      await copySelectionDirect(editor, new vscode.Selection(editor.selection.active, editor.selection.active), 'reference')
    }
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
        lastCopyButtonRange) {
      const clickPos = selections[0].active
      
      // Tıklanan satır Copy butonunun olduğu satırsa -> Copy (Referans Link)
      if (clickPos.line === lastCopyButtonRange.end.line && 
          Math.abs(clickPos.character - lastCopyButtonRange.end.character) <= 1) {
        
        isIgnoringSelectionChange = true
        if (lastActiveSelection) {
          await copySelectionDirect(editor, lastActiveSelection, 'reference')
        }
        isIgnoringSelectionChange = false
        return
      }
      
      // Tıklanan satır Snapshot butonunun olduğu satırsa -> Snapshot
      if (lastSnapshotButtonRange && 
          clickPos.line === lastSnapshotButtonRange.end.line &&
          Math.abs(clickPos.character - lastSnapshotButtonRange.end.character) <= 1) {
        
        isIgnoringSelectionChange = true
        if (lastActiveSelection) {
          await copySelectionDirect(editor, lastActiveSelection, 'snapshot')
        }
        isIgnoringSelectionChange = false
        return
      }
    }

    // 2. Buton Gösterme: Gerçek bir seçim varsa (seçili metin varsa)
    const activeSelection = selections.find(s => !s.isEmpty)
    if (activeSelection) {
      lastActiveSelection = activeSelection // Seçilen alanı hafızaya al

      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }

      debounceTimer = setTimeout(() => {
        const doc = editor.document
        const targetRangeCopy = new vscode.Range(activeSelection.end, activeSelection.end)
        editor.setDecorations(copyButtonDecorationType, [targetRangeCopy])
        lastCopyButtonRange = targetRangeCopy

        // Bir alt satır varsa Snapshot'ı oraya absolute olarak yerleştir (böylece satırları kaydırmaz)
        const nextLine = activeSelection.end.line + 1
        if (nextLine < doc.lineCount) {
          const nextLineText = doc.lineAt(nextLine)
          const targetRangeSnapshot = new vscode.Range(
            new vscode.Position(nextLine, nextLineText.text.length),
            new vscode.Position(nextLine, nextLineText.text.length)
          )
          editor.setDecorations(snapshotButtonDecorationType, [targetRangeSnapshot])
          lastSnapshotButtonRange = targetRangeSnapshot
        } else {
          // Eğer dosyanın son satırıysa, aynı satırda yan yana yerleştir
          editor.setDecorations(snapshotButtonSameLineDecorationType, [targetRangeCopy])
          lastSnapshotButtonRange = targetRangeCopy
        }
      }, 300) // Debounce 300ms
    } else {
      // Seçim yoksa ve butonlara tıklanmadıysa butonları kaldır
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      editor.setDecorations(copyButtonDecorationType, [])
      editor.setDecorations(snapshotButtonDecorationType, [])
      editor.setDecorations(snapshotButtonSameLineDecorationType, [])
      lastCopyButtonRange = undefined
      lastSnapshotButtonRange = undefined
    }
  })
  context.subscriptions.push(onSelectionChangeDisposable)
}

export function deactivate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
}

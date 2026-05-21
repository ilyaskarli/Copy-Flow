import * as vscode from 'vscode'
import * as path from 'path'

let debounceTimer: NodeJS.Timeout | undefined
let lastCopyButtonRange: vscode.Range | undefined
let lastActiveSelection: vscode.Selection | undefined
let isIgnoringSelectionChange = false

// Tema uyumlu, siyah renkli, dikey olarak alt alta hizalanmış butonlar (kod düzenini bozmayan)
const verticalButtonsDecorationType = vscode.window.createTextEditorDecorationType({
  before: {
    contentText: 'Copy',
    backgroundColor: '#000000',
    color: '#FFFFFF',
    fontWeight: 'bold',
    textDecoration: 'none; padding: 2px 6px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; position: absolute; z-index: 100; margin-left: 10px; top: 0px;'
  },
  after: {
    contentText: 'Snapshot',
    backgroundColor: '#000000',
    color: '#FFFFFF',
    fontWeight: 'bold',
    textDecoration: 'none; padding: 2px 6px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; position: absolute; z-index: 100; margin-left: 10px; top: 24px;'
  }
})

// Son satırda aynı satıra yan yana konumlandırmak için butonlar
const sameLineButtonsDecorationType = vscode.window.createTextEditorDecorationType({
  before: {
    contentText: 'Copy',
    backgroundColor: '#000000',
    color: '#FFFFFF',
    fontWeight: 'bold',
    textDecoration: 'none; padding: 2px 6px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; position: absolute; z-index: 100; margin-left: 10px; top: 0px;'
  },
  after: {
    contentText: 'Snapshot',
    backgroundColor: '#000000',
    color: '#FFFFFF',
    fontWeight: 'bold',
    textDecoration: 'none; padding: 2px 6px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; position: absolute; z-index: 100; margin-left: 70px; top: 0px;'
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
  editor.setDecorations(verticalButtonsDecorationType, [])
  editor.setDecorations(sameLineButtonsDecorationType, [])
  lastCopyButtonRange = undefined
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
      const isLastLine = lastCopyButtonRange.end.line === editor.document.lineCount - 1
      
      // Tıklanan satır Copy butonunun olduğu satırsa -> Copy (Referans Link)
      if (clickPos.line === lastCopyButtonRange.end.line && 
          Math.abs(clickPos.character - lastCopyButtonRange.end.character) <= 3) {
        
        isIgnoringSelectionChange = true
        if (lastActiveSelection) {
          await copySelectionDirect(editor, lastActiveSelection, 'reference')
        }
        isIgnoringSelectionChange = false
        return
      }
      
      // Tıklanan satır bir alt satırsa ve son satır değilse -> Snapshot
      if (!isLastLine && clickPos.line === lastCopyButtonRange.end.line + 1) {
        const lineLen = editor.document.lineAt(clickPos.line).text.length
        const targetChar = lastCopyButtonRange.end.character
        const clickChar = clickPos.character
        
        // Klik karakteri hedef karaktere yakınsa veya bir alt satır daha kısaysa ve imleç o satırın sonuna caplenmişse
        if (Math.abs(clickChar - targetChar) <= 8 || (targetChar > lineLen && clickChar >= lineLen - 1)) {
          isIgnoringSelectionChange = true
          if (lastActiveSelection) {
            await copySelectionDirect(editor, lastActiveSelection, 'snapshot')
          }
          isIgnoringSelectionChange = false
          return
        }
      }

      // Eğer son satırsa ve Snapshot butonu yan yanaysa -> Snapshot
      if (isLastLine && clickPos.line === lastCopyButtonRange.end.line &&
          clickPos.character >= lastCopyButtonRange.end.character + 4 &&
          clickPos.character <= lastCopyButtonRange.end.character + 14) {
        
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
        lastCopyButtonRange = targetRangeCopy

        // Son satır değilse dikey hizalanmış (before/after birleşik) butonları göster
        if (activeSelection.end.line < doc.lineCount - 1) {
          editor.setDecorations(verticalButtonsDecorationType, [targetRangeCopy])
        } else {
          // Son satırsa yan yana hizalanmış butonları göster
          editor.setDecorations(sameLineButtonsDecorationType, [targetRangeCopy])
        }
      }, 300) // Debounce 300ms
    } else {
      // Seçim yoksa ve butonlara tıklanmadıysa butonları kaldır
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      editor.setDecorations(verticalButtonsDecorationType, [])
      editor.setDecorations(sameLineButtonsDecorationType, [])
      lastCopyButtonRange = undefined
    }
  })
  context.subscriptions.push(onSelectionChangeDisposable)
}

export function deactivate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
}

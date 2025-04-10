import {
  WorkspaceEdit,
  window,
  TextEdit,
  SnippetString,
  TextEditorEdit,
  env,
  workspace,
  ExtensionContext,
} from 'vscode'
import { CodeAction, TextDocumentIdentifier, LanguageClientOptions } from 'vscode-languageclient'
import { LanguageClient, ServerOptions } from 'vscode-languageclient/node'
import { denyListDarkColorThemes, denyListLightColorThemes } from './denyListColorThemes'
import { homedir } from 'os'
import { readdirSync } from 'fs'
import path from 'path'
export function isDebugOrTestSession(): boolean {
  return env.sessionId === 'someValue.sessionId'
}

export function checkForOtherPrismaExtension(): void {
  const files = readdirSync(path.join(homedir(), '.vscode/extensions')).filter(
    (file) =>
      file.toLowerCase().startsWith('prisma.prisma-') && !file.toLowerCase().startsWith('prisma.prisma-insider-'),
  )
  if (files.length !== 0) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    window.showInformationMessage(
      `You have both versions (Insider and Stable) of the Prisma VS Code extension enabled in your workspace. Please uninstall or disable one of them for a better experience.`,
    )
    console.log('Both versions (Insider and Stable) of the Prisma VS Code extension are enabled.')
  }
}

function showToastToSwitchColorTheme(currentTheme: string, suggestedTheme: string): void {
  // We do not want to block on this UI message, therefore disabling the linter here.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  window.showWarningMessage(
    `The VS Code Color Theme '${currentTheme}' you are using unfortunately does not fully support syntax highlighting. We suggest you switch to '${suggestedTheme}' which does fully support it and will give you a better experience.`,
  )
}

export function checkForMinimalColorTheme(): void {
  const colorTheme = workspace.getConfiguration('workbench').get('colorTheme')
  if (!colorTheme) {
    return
  }

  console.log(colorTheme)

  if (denyListDarkColorThemes.includes(colorTheme as string)) {
    showToastToSwitchColorTheme(colorTheme as string, 'Dark+ (Visual Studio)')
  }
  if (denyListLightColorThemes.includes(colorTheme as string)) {
    showToastToSwitchColorTheme(colorTheme as string, 'Light+ (Visual Studio)')
  }
}

/* This function is part of the workaround for https://github.com/prisma/language-tools/issues/311 */
export function isSnippetEdit(action: CodeAction, document: TextDocumentIdentifier): boolean {
  const changes = action.edit?.changes
  if (changes !== undefined && changes[document.uri]) {
    if (changes[document.uri].some((e) => e.newText.includes('{\n\n}\n'))) {
      return true
    }
  }
  return false
}

/* This function is part of the workaround for https://github.com/prisma/language-tools/issues/311 */
export function applySnippetWorkspaceEdit(): (edit: WorkspaceEdit) => Promise<void> {
  return async (edit: WorkspaceEdit) => {
    const [uri, edits] = edit.entries()[0]

    const editor = window.visibleTextEditors.find((it) => it.document.uri.toString() === uri.toString())
    if (!editor) return

    let editWithSnippet: TextEdit | undefined = undefined
    let lineDelta = 0
    await editor.edit((builder: TextEditorEdit) => {
      for (const indel of edits) {
        if (indel.newText.includes('$0')) {
          editWithSnippet = indel
        } else if (indel.newText.includes('{\n\n}')) {
          indel.newText = indel.newText.replace('{\n\n}', '{\n\t$0\n}')
          editWithSnippet = indel
        } else {
          if (!editWithSnippet) {
            lineDelta = (indel.newText.match(/\n/g) || []).length - (indel.range.end.line - indel.range.start.line)
          }
          builder.replace(indel.range, indel.newText)
        }
      }
    })
    if (editWithSnippet) {
      const snip = editWithSnippet as TextEdit
      const range = snip.range.with(
        snip.range.start.with(snip.range.start.line + lineDelta),
        snip.range.end.with(snip.range.end.line + lineDelta),
      )
      await editor.insertSnippet(new SnippetString(snip.newText), range)
    }
  }
}

export function createLanguageServer(
  serverOptions: ServerOptions,
  clientOptions: LanguageClientOptions,
): LanguageClient {
  return new LanguageClient('prisma', 'Prisma Language Server', serverOptions, clientOptions)
}
export const restartClient = async (
  context: ExtensionContext,
  client: LanguageClient,
  serverOptions: ServerOptions,
  clientOptions: LanguageClientOptions,
): Promise<LanguageClient> => {
  client?.diagnostics?.dispose()
  if (client) await client.stop()
  client = createLanguageServer(serverOptions, clientOptions)
  context.subscriptions.push(client.start())
  await client.onReady()
  return client
}

import * as vscode from 'vscode';
import { CommentParser, PaperReference } from './commentParser';
import { MetadataClient } from './arxivClient';
import { HoverProvider } from './hoverProvider';
import { BibliographyExporter } from './bibliographyExporter';
import { ZoteroSync } from './zoteroSync';
import { VersionTracker } from './versionTracker';
import { FileWatcher } from './fileWatcher';
import { PaperCodeLensProvider, PaperDecorationProvider, PaperStatusBarItem } from './codeLensProvider';
import { PdfPreviewManager } from './pdfPreview';

let commentParser: CommentParser;
let metadataClient: MetadataClient;
let hoverProvider: HoverProvider;
let bibliographyExporter: BibliographyExporter;
let zoteroSync: ZoteroSync;
let versionTracker: VersionTracker;
let fileWatcher: FileWatcher;
let codeLensProvider: PaperCodeLensProvider;
let decorationProvider: PaperDecorationProvider;
let statusBarItem: PaperStatusBarItem;
let pdfPreviewManager: PdfPreviewManager; // Declare pdfPreviewManager

export async function activate(context: vscode.ExtensionContext) {
    console.log('DevScholar is now active');

    const outputChannel = vscode.window.createOutputChannel('DevScholar'); // Initialize outputChannel

    // Initialize core modules
    commentParser = new CommentParser();
    metadataClient = new MetadataClient(context);
    hoverProvider = new HoverProvider(metadataClient);
    bibliographyExporter = new BibliographyExporter(metadataClient);
    zoteroSync = new ZoteroSync(context);
    versionTracker = new VersionTracker(context);
    fileWatcher = new FileWatcher(commentParser, 500);
    codeLensProvider = new PaperCodeLensProvider(commentParser, metadataClient);
    decorationProvider = new PaperDecorationProvider(commentParser);
    statusBarItem = new PaperStatusBarItem(commentParser);

    // Register hover provider
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('*', hoverProvider)
    );

    // Register CodeLens provider
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider('*', codeLensProvider)
    );

    // Register file watcher callbacks
    context.subscriptions.push(
        fileWatcher.onPapersChanged(async (uri, papers) => {
            codeLensProvider.refresh();
            await versionTracker.recordPaperReference(uri, papers);
        })
    );

    // Update decorations on editor change
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                decorationProvider.updateDecorations(editor);
                statusBarItem.update(editor.document);
            } else {
                statusBarItem.update();
            }
        })
    );

    // Update decorations on document change
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                decorationProvider.updateDecorations(editor);
            }
        })
    );

    // Initialize decorations for active editor
    if (vscode.window.activeTextEditor) {
        decorationProvider.updateDecorations(vscode.window.activeTextEditor);
        statusBarItem.update(vscode.window.activeTextEditor.document);
    }

    // ==================== Commands ====================

    // Parse current file
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.parseCurrentFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const papers = await fileWatcher.forceParse(editor.document);
            const metadata = await metadataClient.fetchMetadata(papers);

            if (metadata.length > 0) {
                const items = metadata.map(m => ({
                    label: m.title,
                    description: m.authors.slice(0, 2).join(', '),
                    detail: `${m.type} | ${m.published ? new Date(m.published).getFullYear() : 'n.d.'}`,
                    metadata: m
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `Found ${metadata.length} paper(s) - select to view details`
                });

                if (selected) {
                    await showPaperDetails(selected.metadata);
                }
            } else {
                vscode.window.showInformationMessage('No research papers found in this file');
            }
        })
    );

    // Export bibliography
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.exportBibliography', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            const papers = await commentParser.parseFile(editor.document);
            if (papers.length === 0) {
                vscode.window.showWarningMessage('No research papers found in this file');
                return;
            }

            const format = await vscode.window.showQuickPick(
                [
                    { label: 'BibTeX', value: 'bibtex', description: 'Standard LaTeX bibliography format' },
                    { label: 'APA', value: 'apa', description: 'American Psychological Association style' },
                    { label: 'Chicago', value: 'chicago', description: 'Chicago Manual of Style' }
                ],
                { placeHolder: 'Select bibliography format' }
            );
            if (!format) return;

            const bibliography = await bibliographyExporter.export(papers, format.value);
            await vscode.env.clipboard.writeText(bibliography);
            vscode.window.showInformationMessage(`${format.label} bibliography copied to clipboard (${papers.length} entries)`);
        })
    );

    // Sync with Zotero
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.syncWithZotero', async () => {
            const config = vscode.workspace.getConfiguration('devscholar');
            if (!config.get<boolean>('zoteroEnabled')) {
                const enable = await vscode.window.showWarningMessage(
                    'Zotero integration is not enabled. Would you like to configure it?',
                    'Configure', 'Cancel'
                );
                if (enable === 'Configure') {
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'devscholar.zotero');
                }
                return;
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const papers = await commentParser.parseFile(editor.document);
            if (papers.length === 0) {
                vscode.window.showWarningMessage('No papers to sync');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Syncing with Zotero...',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Fetching paper details...' });
                const metadata = await metadataClient.fetchMetadata(papers);

                if (metadata.length === 0) {
                    vscode.window.showWarningMessage('No metadata found for these papers. Cannot sync.');
                    return;
                }

                progress.report({ message: 'Sending to Zotero...' });
                await zoteroSync.syncPapers(metadata);
            });

            vscode.window.showInformationMessage(`Synced ${papers.length} papers with Zotero`);
        })
    );

    // Show version history
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.showVersionHistory', async () => {
            await versionTracker.showVersionHistory();
        })
    );

    // Show paper details (from CodeLens)
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.showPaperDetails', async (paper: PaperReference) => {
            const metadata = await metadataClient.fetchMetadata([paper]);
            if (metadata.length > 0) {
                await showPaperDetails(metadata[0]);
            }
        })
    );

    // Open paper (from CodeLens)
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.openPaper', async (paper: PaperReference) => {
            let url: string | undefined;
            if (paper.type === 'arxiv') {
                url = `https://arxiv.org/abs/${paper.id}`;
            } else if (paper.type === 'doi') {
                url = `https://doi.org/${paper.id}`;
            } else if (paper.type === 'semantic_scholar') {
                url = `https://www.semanticscholar.org/paper/${paper.id}`;
            }

            if (url) {
                await vscode.env.openExternal(vscode.Uri.parse(url));
            }
        })
    );

    // Copy citation
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.copyCitation', async (paper: PaperReference) => {
            const metadata = await metadataClient.fetchMetadata([paper]);
            if (metadata.length > 0) {
                const bibtex = await bibliographyExporter.export([paper], 'bibtex');
                await vscode.env.clipboard.writeText(bibtex);
                vscode.window.showInformationMessage('BibTeX citation copied to clipboard');
            }
        })
    );

    // Copy BibTeX from hover
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.copyBibtex', async (args: { id: string; type: string }) => {
            const paper: PaperReference = {
                id: args.id,
                type: args.type as any,
                lineNumber: 0,
                columnNumber: 0,
                rawText: ''
            };
            const bibtex = await bibliographyExporter.export([paper], 'bibtex');
            await vscode.env.clipboard.writeText(bibtex);
            vscode.window.showInformationMessage('BibTeX copied to clipboard');
        })
    );

    // Show all papers in file
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.showAllPapers', async (uri?: vscode.Uri) => {
            const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
            if (!targetUri) return;

            const document = await vscode.workspace.openTextDocument(targetUri);
            const papers = await commentParser.parseFile(document);
            const metadata = await metadataClient.fetchMetadata(papers);

            if (metadata.length === 0) {
                vscode.window.showInformationMessage('No papers found');
                return;
            }

            const items = metadata.map(m => ({
                label: m.title,
                description: m.authors.slice(0, 2).join(', '),
                detail: `${m.type} | ${m.id}`,
                metadata: m
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a paper to view details'
            });

            if (selected) {
                await showPaperDetails(selected.metadata);
            }
        })
    );

    // Show papers on line (for multiple papers)
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.showPapersOnLine', async (papers: PaperReference[]) => {
            const metadata = await metadataClient.fetchMetadata(papers);
            const items = metadata.map(m => ({
                label: m.title,
                description: `${m.type}:${m.id}`,
                metadata: m
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a paper'
            });

            if (selected) {
                await showPaperDetails(selected.metadata);
            }
        })
    );

    // Clear cache
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.clearCache', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'This will clear all cached paper metadata. Continue?',
                'Clear Cache', 'Cancel'
            );
            if (confirm === 'Clear Cache') {
                metadataClient.clearCache();
                vscode.window.showInformationMessage('Paper cache cleared');
            }
        })
    );

    // Show cache stats
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.showCacheStats', async () => {
            const stats = metadataClient.getCacheStats();
            vscode.window.showInformationMessage(
                `Cache: ${stats.memoryCount} papers in memory, ${stats.fileCount} papers on disk`
            );
        })
    );

    // Register disposables
    context.subscriptions.push(fileWatcher);
    context.subscriptions.push(decorationProvider);
    context.subscriptions.push(statusBarItem);
}

async function showPaperDetails(metadata: any): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        'paperDetails',
        metadata.title.substring(0, 50) + '...',
        vscode.ViewColumn.Beside,
        { enableScripts: true }
    );

    const year = metadata.published ? new Date(metadata.published).getFullYear() : 'N/A';
    const authors = metadata.authors.join(', ') || 'Unknown';
    const categories = metadata.categories?.join(', ') || 'N/A';

    panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: var(--vscode-font-family); padding: 20px; line-height: 1.6; }
                h1 { font-size: 1.5em; margin-bottom: 10px; }
                .meta { color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
                .section { margin-bottom: 20px; }
                .section-title { font-weight: bold; margin-bottom: 5px; }
                .links { margin-top: 20px; }
                .links a {
                    display: inline-block;
                    padding: 8px 16px;
                    margin-right: 10px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    text-decoration: none;
                    border-radius: 4px;
                }
                .links a:hover { background: var(--vscode-button-hoverBackground); }
                .abstract {
                    background: var(--vscode-editor-background);
                    padding: 15px;
                    border-radius: 4px;
                    border-left: 3px solid var(--vscode-activityBarBadge-background);
                }
                .badge {
                    display: inline-block;
                    padding: 2px 8px;
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    border-radius: 10px;
                    font-size: 0.85em;
                    margin-right: 5px;
                }
            </style>
        </head>
        <body>
            <h1>${escapeHtml(metadata.title)}</h1>
            <div class="meta">
                <span class="badge">${metadata.type.toUpperCase()}</span>
                <span class="badge">${year}</span>
                ${metadata.citationCount !== undefined ? `<span class="badge">${metadata.citationCount} citations</span>` : ''}
            </div>

            <div class="section">
                <div class="section-title">Authors</div>
                ${escapeHtml(authors)}
            </div>

            ${metadata.journal ? `
            <div class="section">
                <div class="section-title">Journal</div>
                ${escapeHtml(metadata.journal)}
            </div>
            ` : ''}

            ${metadata.categories && metadata.categories.length > 0 ? `
            <div class="section">
                <div class="section-title">Categories</div>
                ${categories}
            </div>
            ` : ''}

            ${metadata.summary ? `
            <div class="section">
                <div class="section-title">Abstract</div>
                <div class="abstract">${escapeHtml(metadata.summary)}</div>
            </div>
            ` : ''}

            <div class="links">
                ${metadata.pdfUrl ? `<a href="${metadata.pdfUrl}">PDF</a>` : ''}
                ${metadata.arxivUrl ? `<a href="${metadata.arxivUrl}">arXiv</a>` : ''}
                ${metadata.doiUrl ? `<a href="${metadata.doiUrl}">DOI</a>` : ''}
            </div>
        </body>
        </html>
    `;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function deactivate() {
    console.log('DevScholar deactivated');
}

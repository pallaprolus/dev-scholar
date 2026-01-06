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
import { CitationCompletionProvider } from './citationCompletionProvider';
import { PaperSearchPanel } from './paperSearchPanel';

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
let pdfPreviewManager: PdfPreviewManager;
let citationCompletionProvider: CitationCompletionProvider;
let paperSearchPanel: PaperSearchPanel;

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
    pdfPreviewManager = new PdfPreviewManager(context);
    citationCompletionProvider = new CitationCompletionProvider();
    paperSearchPanel = new PaperSearchPanel();

    // Register hover provider
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('*', hoverProvider)
    );

    // Register CodeLens provider
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider('*', codeLensProvider)
    );

    // Register Citation Completion provider (Click-to-Cite)
    // We register with ':' as trigger, but also handle typing via document change listener
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            '*',
            citationCompletionProvider,
            ':' // Initial trigger on ':'
        )
    );

    // Auto-trigger completion when typing in cite: pattern
    // This ensures the dropdown appears/updates as user types their search query
    let citeDebounceTimer: NodeJS.Timeout | undefined;
    let lastTriggerTime = 0;
    const MIN_TRIGGER_INTERVAL = 300; // Minimum ms between triggers

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || event.document !== editor.document) return;

            // Only process if there are content changes (not just cursor moves)
            if (event.contentChanges.length === 0) return;

            // Clear previous debounce
            if (citeDebounceTimer) {
                clearTimeout(citeDebounceTimer);
            }

            // Debounce the trigger
            citeDebounceTimer = setTimeout(() => {
                // Get current cursor position
                const position = editor.selection.active;
                const lineText = event.document.lineAt(position.line).text;
                const linePrefix = lineText.substring(0, position.character);

                // Check if we're in a cite: pattern with at least 3 characters of query
                const match = linePrefix.match(/(?:#cite:|@cite:|cite:)\s*(.+)$/i);
                if (match && match[1].trim().length >= 3) {
                    const now = Date.now();
                    // Avoid triggering too frequently
                    if (now - lastTriggerTime >= MIN_TRIGGER_INTERVAL) {
                        lastTriggerTime = now;
                        vscode.commands.executeCommand('editor.action.triggerSuggest');
                    }
                }
            }, 150); // 150ms debounce
        })
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

    // Search and cite papers (Click-to-Cite) - keyboard shortcut
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.searchPapers', async () => {
            const editor = vscode.window.activeTextEditor;
            const citation = await paperSearchPanel.show();

            if (citation && editor) {
                // Insert citation at cursor position
                await editor.edit(editBuilder => {
                    editBuilder.insert(editor.selection.active, citation);
                });
            }
        })
    );

    // Search and insert - triggered by @cite or cite: autocomplete
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.searchAndInsert', async (replaceRange?: vscode.Range) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const citation = await paperSearchPanel.show();

            if (citation) {
                await editor.edit(editBuilder => {
                    if (replaceRange) {
                        // Replace the trigger text (@cite or cite:) with the citation
                        editBuilder.replace(replaceRange, citation);
                    } else {
                        // Fallback: insert at cursor
                        editBuilder.insert(editor.selection.active, citation);
                    }
                });
            }
        })
    );

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

            // Check if Zotero is enabled
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

            // Check for API key (now stored securely)
            let apiKey = await zoteroSync.getApiKey();
            if (!apiKey) {
                const setup = await vscode.window.showWarningMessage(
                    'Zotero API key not found. Would you like to set it up now?',
                    'Enter API Key', 'Cancel'
                );
                if (setup === 'Enter API Key') {
                    const success = await zoteroSync.promptForApiKey();
                    if (!success) return;
                    apiKey = await zoteroSync.getApiKey();
                } else {
                    return;
                }
            }

            // Check for user ID
            const userId = config.get<string>('zoteroUserId');
            if (!userId) {
                const setup = await vscode.window.showWarningMessage(
                    'Zotero User ID not configured. Please set it in settings.',
                    'Open Settings', 'Cancel'
                );
                if (setup === 'Open Settings') {
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'devscholar.zoteroUserId');
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

            // Get linked collection (if any)
            const collectionKey = config.get<string>('zoteroCollection');

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
                await zoteroSync.syncPapers(metadata, collectionKey);
            });
        })
    );

    // Import from Zotero
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.importFromZotero', async () => {
            const config = vscode.workspace.getConfiguration('devscholar');

            // Check if Zotero is enabled
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

            // Check for API key
            const apiKey = await zoteroSync.getApiKey();
            if (!apiKey) {
                const setup = await vscode.window.showWarningMessage(
                    'Zotero API key not found. Would you like to set it up now?',
                    'Enter API Key', 'Cancel'
                );
                if (setup === 'Enter API Key') {
                    await zoteroSync.promptForApiKey();
                }
                return;
            }

            // Check for user ID
            const userId = config.get<string>('zoteroUserId');
            if (!userId) {
                vscode.window.showWarningMessage('Zotero User ID not configured. Please set it in settings.');
                return;
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            // Get linked collection
            const collectionKey = config.get<string>('zoteroCollection');

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Fetching papers from Zotero...',
                cancellable: false
            }, async (progress) => {
                try {
                    // Fetch items from Zotero
                    const items = collectionKey
                        ? await zoteroSync.fetchItemsFromCollection(collectionKey)
                        : await zoteroSync.fetchAllItems();

                    if (items.length === 0) {
                        vscode.window.showInformationMessage(
                            collectionKey
                                ? 'No papers found in linked collection'
                                : 'No papers found in Zotero library'
                        );
                        return;
                    }

                    // Convert to PaperMetadata for display
                    const papers = items.map(item => zoteroSync.mapFromZoteroItem(item));

                    // Show multi-select QuickPick
                    const quickPickItems = papers.map(p => ({
                        label: p.title,
                        description: p.authors.slice(0, 2).join(', '),
                        detail: `${p.type}:${p.id}`,
                        picked: false,
                        paper: p
                    }));

                    const selected = await vscode.window.showQuickPick(quickPickItems, {
                        canPickMany: true,
                        placeHolder: 'Select papers to insert as citations',
                        title: 'Import from Zotero'
                    });

                    if (!selected || selected.length === 0) return;

                    // Insert citations at cursor
                    const languageId = editor.document.languageId;
                    const citations = selected.map(s =>
                        zoteroSync.formatCitation(s.paper, languageId)
                    ).join('\n\n');

                    await editor.edit(editBuilder => {
                        editBuilder.insert(editor.selection.active, citations + '\n');
                    });

                    vscode.window.showInformationMessage(`Inserted ${selected.length} citation(s)`);
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to fetch from Zotero: ${error.message}`);
                }
            });
        })
    );

    // Link Zotero Collection
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.linkZoteroCollection', async () => {
            const config = vscode.workspace.getConfiguration('devscholar');

            // Check if Zotero is enabled and configured
            if (!config.get<boolean>('zoteroEnabled')) {
                vscode.window.showWarningMessage('Please enable Zotero integration first in settings.');
                return;
            }

            const apiKey = await zoteroSync.getApiKey();
            if (!apiKey) {
                const setup = await vscode.window.showWarningMessage(
                    'Zotero API key not found. Would you like to set it up now?',
                    'Enter API Key', 'Cancel'
                );
                if (setup === 'Enter API Key') {
                    await zoteroSync.promptForApiKey();
                }
                return;
            }

            try {
                const collection = await zoteroSync.promptForCollection();
                if (collection) {
                    // Save to workspace settings
                    await config.update('zoteroCollection', collection.key, vscode.ConfigurationTarget.Workspace);
                    await config.update('zoteroCollectionName', collection.name, vscode.ConfigurationTarget.Workspace);
                    vscode.window.showInformationMessage(`Linked to Zotero collection: ${collection.name}`);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to fetch collections: ${error.message}`);
            }
        })
    );

    // Set Zotero API Key (securely)
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.setZoteroApiKey', async () => {
            await zoteroSync.promptForApiKey();
        })
    );

    // Clear Zotero API Key
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.clearZoteroApiKey', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Are you sure you want to remove your Zotero API key?',
                'Remove', 'Cancel'
            );
            if (confirm === 'Remove') {
                await zoteroSync.deleteApiKey();
                vscode.window.showInformationMessage('Zotero API key removed.');
            }
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

    // Preview PDF
    context.subscriptions.push(
        vscode.commands.registerCommand('devscholar.previewPdf', async (paper: any) => {
            if (!paper) return;
            // Ensure we have full metadata
            let metadata = paper;
            // Check if it's a raw paper reference or partial object
            if (!paper.title && paper.id && paper.type) {
                // If passed just ID reference, fetch full metadata first
                const [fullMeta] = await metadataClient.fetchMetadata([{
                    id: paper.id,
                    type: paper.type,
                    lineNumber: 0,
                    columnNumber: 0,
                    rawText: ''
                }]);
                metadata = fullMeta;
            }

            if (metadata) {
                await pdfPreviewManager.preview(metadata);
            }
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

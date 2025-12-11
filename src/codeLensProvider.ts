import * as vscode from 'vscode';
import { CommentParser, PaperReference } from './commentParser';
import { MetadataClient, PaperMetadata } from './arxivClient';

export class PaperCodeLensProvider implements vscode.CodeLensProvider {
    private parser: CommentParser;
    private metadataClient: MetadataClient;
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor(parser: CommentParser, metadataClient: MetadataClient) {
        this.parser = parser;
        this.metadataClient = metadataClient;
    }

    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        const papers = await this.parser.parseFile(document);

        if (papers.length === 0) {
            return codeLenses;
        }

        // Group papers by line to avoid duplicate lenses
        const papersByLine = new Map<number, PaperReference[]>();
        for (const paper of papers) {
            const existing = papersByLine.get(paper.lineNumber) || [];
            existing.push(paper);
            papersByLine.set(paper.lineNumber, existing);
        }

        // Create CodeLens for each line with papers
        for (const [lineNumber, linePapers] of papersByLine) {
            const range = new vscode.Range(lineNumber, 0, lineNumber, 0);

            // Primary lens: show paper count/info
            if (linePapers.length === 1) {
                const paper = linePapers[0];
                const cached = this.metadataClient.getCached(paper.type, paper.id);

                if (cached) {
                    // Show paper title if cached
                    const shortTitle = this.truncateTitle(cached.title, 50);
                    codeLenses.push(new vscode.CodeLens(range, {
                        title: `$(book) ${shortTitle}`,
                        command: 'devscholar.showPaperDetails',
                        arguments: [paper]
                    }));
                } else {
                    // Show paper ID
                    codeLenses.push(new vscode.CodeLens(range, {
                        title: `$(book) ${paper.type}:${paper.id}`,
                        command: 'devscholar.showPaperDetails',
                        arguments: [paper]
                    }));
                }

                // Quick actions lens
                codeLenses.push(new vscode.CodeLens(range, {
                    title: '$(link-external) Open',
                    command: 'devscholar.openPaper',
                    arguments: [paper]
                }));

                codeLenses.push(new vscode.CodeLens(range, {
                    title: '$(eye) Preview PDF',
                    command: 'devscholar.previewPdf',
                    arguments: [paper]
                }));

                codeLenses.push(new vscode.CodeLens(range, {
                    title: '$(clippy) Copy Citation',
                    command: 'devscholar.copyCitation',
                    arguments: [paper]
                }));
            } else {
                // Multiple papers on same line
                codeLenses.push(new vscode.CodeLens(range, {
                    title: `$(library) ${linePapers.length} papers referenced`,
                    command: 'devscholar.showPapersOnLine',
                    arguments: [linePapers]
                }));
            }
        }

        // Add summary lens at top of file if there are papers
        if (papers.length > 0) {
            const topRange = new vscode.Range(0, 0, 0, 0);
            const uniqueCount = new Set(papers.map(p => `${p.type}:${p.id}`)).size;

            codeLenses.unshift(new vscode.CodeLens(topRange, {
                title: `$(references) ${uniqueCount} research paper${uniqueCount !== 1 ? 's' : ''} referenced`,
                command: 'devscholar.showAllPapers',
                arguments: [document.uri]
            }));
        }

        return codeLenses;
    }

    private truncateTitle(title: string, maxLength: number): string {
        if (title.length <= maxLength) return title;
        return title.substring(0, maxLength - 3) + '...';
    }
}

// Decoration provider for highlighting paper references
export class PaperDecorationProvider {
    private parser: CommentParser;
    private decorationType: vscode.TextEditorDecorationType;

    constructor(parser: CommentParser) {
        this.parser = parser;
        this.decorationType = vscode.window.createTextEditorDecorationType({
            textDecoration: 'underline',
            cursor: 'pointer',
            color: new vscode.ThemeColor('textLink.foreground'),
            overviewRulerColor: new vscode.ThemeColor('textLink.foreground'),
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });
    }

    async updateDecorations(editor: vscode.TextEditor): Promise<void> {
        const papers = await this.parser.parseFile(editor.document);
        const decorations: vscode.DecorationOptions[] = [];

        for (const paper of papers) {
            const range = this.parser.getReferenceRange(paper);
            decorations.push({
                range,
                hoverMessage: `${paper.type}: ${paper.id}`
            });
        }

        editor.setDecorations(this.decorationType, decorations);
    }

    dispose(): void {
        this.decorationType.dispose();
    }
}

// Status bar item for showing paper count
export class PaperStatusBarItem {
    private statusBarItem: vscode.StatusBarItem;
    private parser: CommentParser;

    constructor(parser: CommentParser) {
        this.parser = parser;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'devscholar.showAllPapers';
    }

    async update(document?: vscode.TextDocument): Promise<void> {
        if (!document) {
            this.statusBarItem.hide();
            return;
        }

        const papers = await this.parser.parseFile(document);
        const uniqueCount = new Set(papers.map(p => `${p.type}:${p.id}`)).size;

        if (uniqueCount > 0) {
            this.statusBarItem.text = `$(book) ${uniqueCount} paper${uniqueCount !== 1 ? 's' : ''}`;
            this.statusBarItem.tooltip = `${uniqueCount} research paper${uniqueCount !== 1 ? 's' : ''} referenced in this file`;
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}

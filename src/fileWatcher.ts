import * as vscode from 'vscode';
import { CommentParser, PaperReference } from './commentParser';

type PaperChangeCallback = (uri: vscode.Uri, papers: PaperReference[]) => void;

export class FileWatcher implements vscode.Disposable {
    private parser: CommentParser;
    private disposables: vscode.Disposable[] = [];
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private debounceMs: number;
    private callbacks: Set<PaperChangeCallback> = new Set();
    private documentPapers: Map<string, PaperReference[]> = new Map();

    constructor(parser: CommentParser, debounceMs: number = 500) {
        this.parser = parser;
        this.debounceMs = debounceMs;
        this.setupWatchers();
    }

    private setupWatchers(): void {
        // Watch for document changes (typing)
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                this.debouncedParse(event.document);
            })
        );

        // Watch for document open
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(document => {
                this.parseDocument(document);
            })
        );

        // Watch for document save
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(document => {
                // Immediate parse on save (no debounce)
                this.parseDocument(document);
            })
        );

        // Watch for document close (cleanup)
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument(document => {
                const key = document.uri.toString();
                this.documentPapers.delete(key);
                const timer = this.debounceTimers.get(key);
                if (timer) {
                    clearTimeout(timer);
                    this.debounceTimers.delete(key);
                }
            })
        );

        // Parse all currently open documents
        vscode.workspace.textDocuments.forEach(doc => {
            this.parseDocument(doc);
        });
    }

    private debouncedParse(document: vscode.TextDocument): void {
        const key = document.uri.toString();

        // Clear existing timer
        const existingTimer = this.debounceTimers.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new debounced timer
        const timer = setTimeout(() => {
            this.parseDocument(document);
            this.debounceTimers.delete(key);
        }, this.debounceMs);

        this.debounceTimers.set(key, timer);
    }

    private async parseDocument(document: vscode.TextDocument): Promise<void> {
        // Skip non-file schemes (e.g., git:, untitled:)
        if (document.uri.scheme !== 'file') {
            return;
        }

        // Skip binary files and very large files
        if (document.lineCount > 10000) {
            return;
        }

        try {
            const papers = await this.parser.parseFile(document);
            const key = document.uri.toString();
            const previousPapers = this.documentPapers.get(key) || [];

            // Check if papers changed
            if (this.papersChanged(previousPapers, papers)) {
                this.documentPapers.set(key, papers);
                this.notifyCallbacks(document.uri, papers);
            }
        } catch (error) {
            console.error(`Error parsing document ${document.uri.fsPath}:`, error);
        }
    }

    private papersChanged(previous: PaperReference[], current: PaperReference[]): boolean {
        if (previous.length !== current.length) {
            return true;
        }

        const previousIds = new Set(previous.map(p => `${p.type}:${p.id}`));
        const currentIds = new Set(current.map(p => `${p.type}:${p.id}`));

        for (const id of currentIds) {
            if (!previousIds.has(id)) {
                return true;
            }
        }

        return false;
    }

    private notifyCallbacks(uri: vscode.Uri, papers: PaperReference[]): void {
        this.callbacks.forEach(callback => {
            try {
                callback(uri, papers);
            } catch (error) {
                console.error('Error in paper change callback:', error);
            }
        });
    }

    // Register a callback for paper changes
    onPapersChanged(callback: PaperChangeCallback): vscode.Disposable {
        this.callbacks.add(callback);
        return {
            dispose: () => {
                this.callbacks.delete(callback);
            }
        };
    }

    // Get papers for a specific document
    getPapersForDocument(uri: vscode.Uri): PaperReference[] {
        return this.documentPapers.get(uri.toString()) || [];
    }

    // Get all papers across all open documents
    getAllPapers(): Map<string, PaperReference[]> {
        return new Map(this.documentPapers);
    }

    // Get total paper count
    getTotalPaperCount(): number {
        let count = 0;
        this.documentPapers.forEach(papers => {
            count += papers.length;
        });
        return count;
    }

    // Get unique papers (deduplicated by ID)
    getUniquePapers(): PaperReference[] {
        const seen = new Set<string>();
        const unique: PaperReference[] = [];

        this.documentPapers.forEach(papers => {
            papers.forEach(paper => {
                const key = `${paper.type}:${paper.id}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(paper);
                }
            });
        });

        return unique;
    }

    // Force re-parse a document
    async forceParse(document: vscode.TextDocument): Promise<PaperReference[]> {
        const papers = await this.parser.parseFile(document);
        const key = document.uri.toString();
        this.documentPapers.set(key, papers);
        this.notifyCallbacks(document.uri, papers);
        return papers;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.debounceTimers.forEach(timer => clearTimeout(timer));
        this.debounceTimers.clear();
        this.documentPapers.clear();
        this.callbacks.clear();
    }
}

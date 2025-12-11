import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PaperReference } from './commentParser';

// Structure for .paper-refs.json
interface PaperRefsFile {
    version: string;
    lastUpdated: string;
    papers: PaperEntry[];
    history: VersionHistoryEntry[];
}

interface PaperEntry {
    id: string;
    type: 'arxiv' | 'doi' | 'semantic_scholar' | 'openalex' | 'pmid' | 'ieee' | 'google_scholar';
    title: string;
    firstSeen: number;
    lastSeen: number;
    files: FileReference[];
    tags?: string[];
}

interface FileReference {
    path: string;
    lineNumber: number;
    context?: string;
}

interface VersionHistoryEntry {
    commitHash: string;
    timestamp: number;
    message?: string;
    papersAdded: string[];
    papersRemoved: string[];
    filesChanged: string[];
}

export class VersionTracker {
    private workspaceRoot: string | undefined;
    private paperRefsPath: string | undefined;
    private isGitRepo: boolean = false;

    constructor(context: vscode.ExtensionContext) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            this.workspaceRoot = workspaceFolder.uri.fsPath;
            this.paperRefsPath = path.join(this.workspaceRoot, '.paper-refs.json');
            this.isGitRepo = this.checkGitRepo();
        }
    }

    private checkGitRepo(): boolean {
        if (!this.workspaceRoot) return false;
        try {
            execSync('git rev-parse --is-inside-work-tree', {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
            return true;
        } catch {
            return false;
        }
    }

    private getGitInfo(): { hash: string; message: string } | null {
        if (!this.isGitRepo || !this.workspaceRoot) return null;
        try {
            const hash = execSync('git rev-parse HEAD', {
                cwd: this.workspaceRoot,
                encoding: 'utf-8'
            }).trim();
            const message = execSync('git log -1 --format=%s', {
                cwd: this.workspaceRoot,
                encoding: 'utf-8'
            }).trim();
            return { hash, message };
        } catch {
            return null;
        }
    }

    private loadPaperRefs(): PaperRefsFile {
        if (!this.paperRefsPath) {
            return this.createEmptyPaperRefs();
        }

        try {
            if (fs.existsSync(this.paperRefsPath)) {
                const data = fs.readFileSync(this.paperRefsPath, 'utf-8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading .paper-refs.json:', error);
        }

        return this.createEmptyPaperRefs();
    }

    private createEmptyPaperRefs(): PaperRefsFile {
        return {
            version: '1.0.0',
            lastUpdated: new Date().toISOString(),
            papers: [],
            history: []
        };
    }

    private savePaperRefs(refs: PaperRefsFile): void {
        if (!this.paperRefsPath) return;

        try {
            refs.lastUpdated = new Date().toISOString();
            fs.writeFileSync(this.paperRefsPath, JSON.stringify(refs, null, 2));
        } catch (error) {
            console.error('Error saving .paper-refs.json:', error);
        }
    }

    async recordPaperReference(fileUri: vscode.Uri, papers: PaperReference[]): Promise<void> {
        const config = vscode.workspace.getConfiguration('devscholar');
        const trackVersions = config.get<boolean>('trackGitVersions');

        if (!trackVersions || !this.workspaceRoot) return;

        const refs = this.loadPaperRefs();
        const relativePath = path.relative(this.workspaceRoot, fileUri.fsPath);
        const now = Date.now(); // Changed to number
        const gitInfo = this.getGitInfo();

        const previousPaperIds = new Set(
            refs.papers
                .filter(p => p.files.some(f => f.path === relativePath))
                .map(p => `${p.type}:${p.id}`)
        );

        const currentPaperIds = new Set<string>();
        const papersAdded: string[] = [];

        // Update papers
        for (const paper of papers) {
            const paperId = `${paper.type}:${paper.id}`;
            currentPaperIds.add(paperId);

            let entry = refs.papers.find(p => p.type === paper.type && p.id === paper.id);

            if (!entry) {
                // New paper
                entry = {
                    id: paper.id,
                    type: paper.type,
                    title: '', // Placeholder, will be populated on metadata fetch
                    files: [],
                    firstSeen: now,
                    lastSeen: now
                };
                refs.papers.push(entry);
                papersAdded.push(paperId);
            }

            // Update file reference
            if (entry) {
                const fileRefIndex = entry.files.findIndex(f => f.path === relativePath);
                const fileRef: FileReference = {
                    path: relativePath,
                    lineNumber: paper.lineNumber + 1, // Changed to lineNumber + 1
                    context: paper.context // Kept context, as it was not explicitly removed in the instruction
                };

                if (fileRefIndex >= 0) {
                    entry.files[fileRefIndex] = fileRef;
                } else {
                    entry.files.push(fileRef);
                }

                entry.lastSeen = now;
            }
        }

        // Find removed papers
        const papersRemoved: string[] = [];
        for (const paperId of previousPaperIds) {
            if (!currentPaperIds.has(paperId)) {
                papersRemoved.push(paperId);
                // Remove file reference from paper
                const [type, id] = paperId.split(':');
                const entry = refs.papers.find(p => p.type === type && p.id === id);
                if (entry) {
                    entry.files = entry.files.filter(f => f.path !== relativePath);
                }
            }
        }

        // Clean up papers with no file references
        refs.papers = refs.papers.filter(p => p.files.length > 0);

        // Record history entry if there are changes and we're in a git repo
        if (gitInfo && (papersAdded.length > 0 || papersRemoved.length > 0)) {
            // Check if we already have a history entry for this commit
            const existingEntry = refs.history.find(h => h.commitHash === gitInfo.hash);

            if (existingEntry) {
                // Merge changes
                existingEntry.papersAdded = [...new Set([...existingEntry.papersAdded, ...papersAdded])];
                existingEntry.papersRemoved = [...new Set([...existingEntry.papersRemoved, ...papersRemoved])];
                if (!existingEntry.filesChanged.includes(relativePath)) {
                    existingEntry.filesChanged.push(relativePath);
                }
            } else {
                refs.history.push({
                    commitHash: gitInfo.hash,
                    timestamp: now,
                    message: gitInfo.message,
                    papersAdded,
                    papersRemoved,
                    filesChanged: [relativePath]
                });
            }

            // Keep only last 100 history entries
            if (refs.history.length > 100) {
                refs.history = refs.history.slice(-100);
            }
        }

        this.savePaperRefs(refs);

        if (papersAdded.length > 0 || papersRemoved.length > 0) {
            console.log(`Paper refs updated: +${papersAdded.length} -${papersRemoved.length}`);
        }
    }

    async getVersionHistory(fileUri?: vscode.Uri): Promise<VersionHistoryEntry[]> {
        const refs = this.loadPaperRefs();

        if (fileUri && this.workspaceRoot) {
            const relativePath = path.relative(this.workspaceRoot, fileUri.fsPath);
            return refs.history.filter(h => h.filesChanged.includes(relativePath));
        }

        return refs.history;
    }

    // Get all tracked papers
    getAllPapers(): PaperEntry[] {
        return this.loadPaperRefs().papers;
    }

    // Get papers for a specific file
    getPapersForFile(fileUri: vscode.Uri): PaperEntry[] {
        if (!this.workspaceRoot) return [];

        const relativePath = path.relative(this.workspaceRoot, fileUri.fsPath);
        const refs = this.loadPaperRefs();

        return refs.papers.filter(p => p.files.some(f => f.path === relativePath));
    }

    // Get files that reference a specific paper
    getFilesForPaper(type: string, id: string): FileReference[] {
        const refs = this.loadPaperRefs();
        const paper = refs.papers.find(p => p.type === type && p.id === id);
        return paper?.files || [];
    }

    // Add tags to a paper
    async addTags(type: string, id: string, tags: string[]): Promise<void> {
        const refs = this.loadPaperRefs();
        const paper = refs.papers.find(p => p.type === type && p.id === id);

        if (paper) {
            paper.tags = [...new Set([...(paper.tags || []), ...tags])];
            this.savePaperRefs(refs);
        }
    }

    // Get history at a specific commit
    async getPapersAtCommit(commitHash: string): Promise<string[]> {
        const refs = this.loadPaperRefs();
        const allPaperIds = new Set<string>();

        // Start with all current papers
        refs.papers.forEach(p => allPaperIds.add(`${p.type}:${p.id}`));

        // Replay history backwards to that commit
        for (let i = refs.history.length - 1; i >= 0; i--) {
            const entry = refs.history[i];
            if (entry.commitHash === commitHash) {
                break;
            }
            // Undo this commit's changes
            entry.papersAdded.forEach(id => allPaperIds.delete(id));
            entry.papersRemoved.forEach(id => allPaperIds.add(id));
        }

        return Array.from(allPaperIds);
    }

    // Show version history in quick pick
    async showVersionHistory(): Promise<void> {
        const history = await this.getVersionHistory();

        if (history.length === 0) {
            vscode.window.showInformationMessage('No version history available');
            return;
        }

        const items = history.map(h => ({
            label: h.commitHash.substring(0, 7),
            description: h.message,
            detail: `+${h.papersAdded.length} -${h.papersRemoved.length} papers | ${new Date(h.timestamp).toLocaleDateString()}`,
            entry: h
        }));

        const selected = await vscode.window.showQuickPick(items.reverse(), {
            placeHolder: 'Select a commit to view paper changes'
        });

        if (selected) {
            const entry = selected.entry;
            const message = [
                `Commit: ${entry.commitHash}`,
                `Date: ${new Date(entry.timestamp).toLocaleString()}`,
                `Message: ${entry.message}`,
                '',
                `Papers Added: ${entry.papersAdded.length > 0 ? entry.papersAdded.join(', ') : 'None'}`,
                `Papers Removed: ${entry.papersRemoved.length > 0 ? entry.papersRemoved.join(', ') : 'None'}`,
                `Files Changed: ${entry.filesChanged.join(', ')}`
            ].join('\n');

            vscode.window.showInformationMessage(message, { modal: true });
        }
    }
}

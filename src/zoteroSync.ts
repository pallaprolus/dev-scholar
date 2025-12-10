import * as vscode from 'vscode';
import { PaperReference } from './commentParser';

export class ZoteroSync {
    private baseUrl = 'https://api.zotero.org';

    constructor(context: vscode.ExtensionContext) { }

    async syncPapers(papers: PaperReference[]): Promise<void> {
        const config = vscode.workspace.getConfiguration('devscholar');
        const apiKey = config.get<string>('zoteroApiKey');
        const userId = config.get<string>('zoteroUserId');

        if (!apiKey || !userId) {
            throw new Error('Zotero API key and user ID not configured');
        }

        console.log(`Syncing ${papers.length} papers with Zotero...`);
    }
}

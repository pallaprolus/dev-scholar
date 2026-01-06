import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';
import { PaperMetadata } from './arxivClient';

const ZOTERO_API_KEY_SECRET = 'devscholar.zoteroApiKey';

export interface ZoteroCollection {
    key: string;
    name: string;
    parentCollection?: string;
}

export interface ZoteroItem {
    key: string;
    version: number;
    data: {
        itemType: string;
        title: string;
        creators?: Array<{ creatorType: string; firstName?: string; lastName: string }>;
        abstractNote?: string;
        date?: string;
        DOI?: string;
        url?: string;
        publicationTitle?: string;
        volume?: string;
        pages?: string;
        tags?: Array<{ tag: string }>;
        extra?: string;
        collections?: string[];
    };
    meta?: {
        creatorSummary?: string;
        parsedDate?: string;
    };
}

export class ZoteroSync {
    private baseUrl = 'https://api.zotero.org';
    private axiosInstance: AxiosInstance;
    private secretStorage: vscode.SecretStorage;

    constructor(context: vscode.ExtensionContext) {
        this.secretStorage = context.secrets;
        this.axiosInstance = axios.create({
            timeout: 15000,
            headers: {
                'User-Agent': 'DevScholar-Extension/0.6.0'
            }
        });
    }

    // ==================== Authentication ====================

    async setApiKey(apiKey: string): Promise<void> {
        await this.secretStorage.store(ZOTERO_API_KEY_SECRET, apiKey);
    }

    async getApiKey(): Promise<string | undefined> {
        return await this.secretStorage.get(ZOTERO_API_KEY_SECRET);
    }

    async deleteApiKey(): Promise<void> {
        await this.secretStorage.delete(ZOTERO_API_KEY_SECRET);
    }

    async isConfigured(): Promise<boolean> {
        const apiKey = await this.getApiKey();
        const config = vscode.workspace.getConfiguration('devscholar');
        const userId = config.get<string>('zoteroUserId');
        return !!(apiKey && userId);
    }

    async promptForApiKey(): Promise<boolean> {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Zotero API key',
            placeHolder: 'Get your key from zotero.org/settings/keys',
            password: true,
            ignoreFocusOut: true
        });

        if (apiKey) {
            await this.setApiKey(apiKey);
            vscode.window.showInformationMessage('Zotero API key saved securely.');
            return true;
        }
        return false;
    }

    private async getAuthHeaders(): Promise<{ 'Zotero-API-Key': string; 'Content-Type': string } | null> {
        const apiKey = await this.getApiKey();
        if (!apiKey) return null;
        return {
            'Zotero-API-Key': apiKey,
            'Content-Type': 'application/json'
        };
    }

    private getUserId(): string | undefined {
        return vscode.workspace.getConfiguration('devscholar').get<string>('zoteroUserId');
    }

    // ==================== Collections ====================

    /**
     * Fetch all collections from user's Zotero library
     */
    async fetchCollections(): Promise<ZoteroCollection[]> {
        const headers = await this.getAuthHeaders();
        const userId = this.getUserId();

        if (!headers || !userId) {
            throw new Error('Zotero not configured');
        }

        try {
            const response = await this.axiosInstance.get(
                `${this.baseUrl}/users/${userId}/collections`,
                { headers }
            );

            return response.data.map((c: any) => ({
                key: c.key,
                name: c.data.name,
                parentCollection: c.data.parentCollection || undefined
            }));
        } catch (error: any) {
            if (error.response?.status === 403) {
                throw new Error('Zotero: Unauthorized. Check your API Key.');
            }
            throw error;
        }
    }

    /**
     * Create a new collection in Zotero
     */
    async createCollection(name: string): Promise<ZoteroCollection> {
        const headers = await this.getAuthHeaders();
        const userId = this.getUserId();

        if (!headers || !userId) {
            throw new Error('Zotero not configured');
        }

        const response = await this.axiosInstance.post(
            `${this.baseUrl}/users/${userId}/collections`,
            [{ name }],
            { headers }
        );

        const created = response.data.success;
        if (created && Object.keys(created).length > 0) {
            const key = created['0'];
            return { key, name };
        }

        throw new Error('Failed to create collection');
    }

    /**
     * Show QuickPick to select or create a collection
     */
    async promptForCollection(): Promise<ZoteroCollection | undefined> {
        const collections = await this.fetchCollections();

        const items: vscode.QuickPickItem[] = [
            { label: '$(add) Create New Collection...', description: 'Create a new Zotero collection for this workspace' },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            ...collections.map(c => ({
                label: c.name,
                description: c.key
            }))
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a Zotero collection to link with this workspace',
            title: 'Link Zotero Collection'
        });

        if (!selected) return undefined;

        if (selected.label.includes('Create New Collection')) {
            const name = await vscode.window.showInputBox({
                prompt: 'Enter collection name',
                placeHolder: 'e.g., ML-Research-Project',
                value: vscode.workspace.name || 'DevScholar'
            });

            if (name) {
                const newCollection = await this.createCollection(name);
                vscode.window.showInformationMessage(`Created Zotero collection: ${name}`);
                return newCollection;
            }
            return undefined;
        }

        return collections.find(c => c.name === selected.label);
    }

    // ==================== Fetch Items (Import) ====================

    /**
     * Fetch items from a specific collection
     */
    async fetchItemsFromCollection(collectionKey: string): Promise<ZoteroItem[]> {
        const headers = await this.getAuthHeaders();
        const userId = this.getUserId();

        if (!headers || !userId) {
            throw new Error('Zotero not configured');
        }

        const items: ZoteroItem[] = [];
        let start = 0;
        const limit = 50;

        while (true) {
            const response = await this.axiosInstance.get(
                `${this.baseUrl}/users/${userId}/collections/${collectionKey}/items`,
                {
                    headers,
                    params: {
                        start,
                        limit,
                        format: 'json',
                        itemType: '-attachment -note' // Exclude attachments and notes
                    }
                }
            );

            items.push(...response.data);

            const totalResults = parseInt(response.headers['total-results'] || '0');
            if (items.length >= totalResults) break;

            start += limit;
            // Rate limiting: ~3 req/sec
            await new Promise(r => setTimeout(r, 350));
        }

        return items;
    }

    /**
     * Fetch all items from user's library (no collection filter)
     */
    async fetchAllItems(): Promise<ZoteroItem[]> {
        const headers = await this.getAuthHeaders();
        const userId = this.getUserId();

        if (!headers || !userId) {
            throw new Error('Zotero not configured');
        }

        const items: ZoteroItem[] = [];
        let start = 0;
        const limit = 50;

        while (true) {
            const response = await this.axiosInstance.get(
                `${this.baseUrl}/users/${userId}/items`,
                {
                    headers,
                    params: {
                        start,
                        limit,
                        format: 'json',
                        itemType: '-attachment -note'
                    }
                }
            );

            items.push(...response.data);

            const totalResults = parseInt(response.headers['total-results'] || '0');
            if (items.length >= totalResults) break;

            start += limit;
            await new Promise(r => setTimeout(r, 350));
        }

        return items;
    }

    /**
     * Convert Zotero item to PaperMetadata
     */
    mapFromZoteroItem(item: ZoteroItem): PaperMetadata {
        const creators = item.data.creators || [];
        const authors = creators
            .filter(c => c.creatorType === 'author')
            .map(c => `${c.firstName ? c.firstName + ' ' : ''}${c.lastName}`.trim());

        // Extract DevScholar ID and type from extra field
        let id = item.data.DOI || item.key;
        let type: PaperMetadata['type'] = 'doi';

        const extraMatch = item.data.extra?.match(/DevScholar-ID:\s*(\S+)/);
        const typeMatch = item.data.extra?.match(/DevScholar-Source:\s*(\S+)/);

        if (extraMatch) {
            id = extraMatch[1];
        }
        if (typeMatch) {
            type = typeMatch[1] as PaperMetadata['type'];
        }

        // Try to detect type from URL
        if (item.data.url?.includes('arxiv.org')) {
            type = 'arxiv';
            const arxivMatch = item.data.url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
            if (arxivMatch) id = arxivMatch[1];
        }

        return {
            id,
            type,
            title: item.data.title,
            authors,
            summary: item.data.abstractNote || '',
            published: item.data.date || item.meta?.parsedDate,
            journal: item.data.publicationTitle,
            volume: item.data.volume,
            pages: item.data.pages,
            doi: item.data.DOI,
            doiUrl: item.data.DOI ? `https://doi.org/${item.data.DOI}` : undefined,
            arxivUrl: type === 'arxiv' ? `https://arxiv.org/abs/${id}` : undefined,
            pdfUrl: type === 'arxiv' ? `https://arxiv.org/pdf/${id}.pdf` : item.data.url,
            categories: item.data.tags?.map(t => t.tag),
            fetchedAt: Date.now()
        };
    }

    /**
     * Format a citation for insertion into code
     */
    formatCitation(paper: PaperMetadata, languageId: string): string {
        const commentPrefix = this.getCommentPrefix(languageId);
        const idStr = paper.type === 'arxiv' ? `arxiv:${paper.id}` :
            paper.type === 'doi' ? `doi:${paper.id}` :
                `${paper.type}:${paper.id}`;

        return `${commentPrefix} "${paper.title}"\n${commentPrefix} ${idStr}`;
    }

    private getCommentPrefix(languageId: string): string {
        const commentMap: Record<string, string> = {
            'python': '#',
            'javascript': '//',
            'typescript': '//',
            'java': '//',
            'c': '//',
            'cpp': '//',
            'csharp': '//',
            'go': '//',
            'rust': '//',
            'swift': '//',
            'kotlin': '//',
            'ruby': '#',
            'perl': '#',
            'r': '#',
            'shell': '#',
            'bash': '#',
            'powershell': '#',
            'sql': '--',
            'lua': '--',
            'haskell': '--',
            'latex': '%',
            'matlab': '%',
            'html': '<!--',
            'xml': '<!--',
            'css': '/*',
            'scss': '//',
            'yaml': '#',
            'toml': '#',
            'dockerfile': '#'
        };
        return commentMap[languageId] || '#';
    }

    // ==================== Export (Sync to Zotero) ====================

    /**
     * Sync papers to Zotero, optionally to a specific collection with workspace tag
     */
    async syncPapers(papers: PaperMetadata[], collectionKey?: string): Promise<void> {
        const headers = await this.getAuthHeaders();
        const userId = this.getUserId();

        if (!headers || !userId) {
            throw new Error('Zotero API key and user ID not configured');
        }

        // Get workspace name for tagging
        const workspaceName = vscode.workspace.name || 'DevScholar';
        const workspaceTag = `DevScholar:${workspaceName}`;

        let successCount = 0;
        let skipCount = 0;
        let failCount = 0;

        // First, fetch existing items to check for duplicates
        let existingItems: ZoteroItem[] = [];
        try {
            existingItems = collectionKey
                ? await this.fetchItemsFromCollection(collectionKey)
                : await this.fetchAllItems();
        } catch (e) {
            console.warn('Could not fetch existing items for duplicate check:', e);
        }

        for (const paper of papers) {
            try {
                // Check for existing item
                const existing = this.findExistingItem(paper, existingItems);
                if (existing) {
                    skipCount++;
                    continue; // Already exists, skip
                }

                // Map PaperMetadata to Zotero Item
                const zoteroItem = this.mapToZoteroItem(paper, collectionKey, workspaceTag);

                await this.axiosInstance.post(
                    `${this.baseUrl}/users/${userId}/items`,
                    [zoteroItem],
                    { headers }
                );
                successCount++;

                // Rate limiting
                await new Promise(r => setTimeout(r, 350));
            } catch (error: any) {
                console.error(`Failed to sync paper ${paper.title}:`, error);
                failCount++;
                if (error.response?.status === 403) {
                    vscode.window.showErrorMessage('Zotero: Unauthorized. Check your API Key and User ID.');
                    return;
                }
            }
        }

        const msg = [];
        if (successCount > 0) msg.push(`${successCount} synced`);
        if (skipCount > 0) msg.push(`${skipCount} already exist`);
        if (failCount > 0) msg.push(`${failCount} failed`);

        if (failCount > 0) {
            vscode.window.showWarningMessage(`Zotero: ${msg.join(', ')}`);
        } else {
            vscode.window.showInformationMessage(`Zotero: ${msg.join(', ')}`);
        }
    }

    /**
     * Find existing item by DevScholar ID or DOI
     */
    private findExistingItem(paper: PaperMetadata, items: ZoteroItem[]): ZoteroItem | undefined {
        return items.find(item => {
            // Check DevScholar ID in extra field
            const devIdMatch = item.data.extra?.match(/DevScholar-ID:\s*(\S+)/);
            if (devIdMatch && devIdMatch[1] === paper.id) {
                return true;
            }

            // Check DOI
            if (paper.doi && item.data.DOI === paper.doi) {
                return true;
            }

            // Check arXiv ID in URL
            if (paper.type === 'arxiv' && item.data.url?.includes(paper.id)) {
                return true;
            }

            return false;
        });
    }

    private mapToZoteroItem(paper: PaperMetadata, collectionKey?: string, workspaceTag?: string): any {
        const itemType = paper.journal ? 'journalArticle' : 'preprint';

        const creators = paper.authors.map(name => {
            const parts = name.split(' ');
            return {
                creatorType: 'author',
                firstName: parts.slice(0, -1).join(' '),
                lastName: parts[parts.length - 1] || parts[0]
            };
        });

        // Build tags array
        const tags = paper.categories?.map(tag => ({ tag })) || [];
        if (workspaceTag) {
            tags.push({ tag: workspaceTag });
        }

        const item: any = {
            itemType,
            title: paper.title,
            creators,
            abstractNote: paper.summary,
            publicationTitle: paper.journal || (paper.type === 'arxiv' ? 'arXiv' : ''),
            volume: paper.volume,
            pages: paper.pages,
            date: paper.published,
            url: paper.pdfUrl || paper.arxivUrl || paper.doiUrl,
            DOI: paper.doi,
            tags,
            extra: `DevScholar-Source: ${paper.type}\nDevScholar-ID: ${paper.id}`
        };

        // Add to collection if specified
        if (collectionKey) {
            item.collections = [collectionKey];
        }

        return item;
    }
}
